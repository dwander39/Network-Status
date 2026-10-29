import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE_FILE_NAME, LEGACY_DATABASE_FILE_NAME } from '../../src/main/appIdentity'
import { getDatabase, markUserDataPrepared, openDatabaseAtPath } from '../../src/main/db/database'
import { listDevices } from '../../src/main/db/deviceRepository'
import { insertEventLog, listEventLogs } from '../../src/main/db/eventLogRepository'
import { getMapLayoutBundle, upsertMapLayoutPositions } from '../../src/main/db/mapLayoutRepository'
import { createNetworkProfile, listNetworkProfiles } from '../../src/main/db/networkProfileRepository'
import { getSettings, saveSettings } from '../../src/main/db/settingsRepository'
import {
  isUserDataDirInUse,
  LegacyDataMigrationError,
  MIGRATION_RECORD_FILE_NAME,
  MIGRATION_STAGING_DIR_NAME,
  parseSingletonLockTarget,
  prepareUserDataDirectory,
  type LegacyMigrationFailureReason,
  type PrepareUserDataOptions
} from '../../src/main/legacyDataMigration'
import { applyUserSaveDevicePayload } from '../../src/main/services/equipmentMutationService'

const NET = '192.168.1.1|192.168.1.0/24'

let root: string
let legacyDir: string
let canonicalDir: string
let legacyDb: string
let canonicalDb: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'network-status-migration-test-'))
  legacyDir = join(root, 'system-status')
  canonicalDir = join(root, 'network-status')
  legacyDb = join(legacyDir, LEGACY_DATABASE_FILE_NAME)
  canonicalDb = join(canonicalDir, DATABASE_FILE_NAME)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function prepare(overrides: Partial<PrepareUserDataOptions> = {}) {
  return prepareUserDataDirectory({
    canonicalDir,
    canonicalDatabaseFileName: DATABASE_FILE_NAME,
    legacyDir,
    legacyDatabaseFileName: LEGACY_DATABASE_FILE_NAME,
    isLegacyInstanceRunning: () => false,
    now: () => new Date('2026-10-28T12:00:00.000Z'),
    ...overrides
  })
}

function expectFailure(fn: () => unknown, reason: LegacyMigrationFailureReason): LegacyDataMigrationError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(LegacyDataMigrationError)
    expect((e as LegacyDataMigrationError).reason).toBe(reason)
    return e as LegacyDataMigrationError
  }
  throw new Error(`expected LegacyDataMigrationError(${reason})`)
}

/** Populates a real app database the same way the app does (repositories + mutation service). */
function seedAppData(db: Database.Database, label: string): void {
  applyUserSaveDevicePayload(db, { name: `${label} Router`, ip: '192.168.1.1', subnet: '255.255.255.0', gateway: '192.168.1.1' })
  applyUserSaveDevicePayload(db, { name: `${label} NAS`, ip: '192.168.1.20', subnet: '255.255.255.0', gateway: '192.168.1.1' })
  saveSettings(db, { pingIntervalMs: 9000, listenAdapterNames: ['eth0'] })
  createNetworkProfile(db, { networkId: NET, name: `${label} Home`, gateway: '192.168.1.1', subnet: '192.168.1.0/24' })
  insertEventLog(db, { eventType: 'DEVICE_OFFLINE', networkId: NET, ipAddress: '192.168.1.20', message: `${label} event` })
  upsertMapLayoutPositions(db, NET, [{ nodeKey: 'gateway', x: 10, y: 20 }])
}

/**
 * Legacy data as left by a running/killed app: committed rows still only in an uncheckpointed `-wal`
 * (this is the shape of the real data observed in %APPDATA%\system-status during Phase 0B).
 */
function createLegacyWithUncheckpointedWal(label = 'Legacy'): void {
  const writerDir = join(root, 'writer')
  mkdirSync(writerDir, { recursive: true })
  const writerDb = join(writerDir, LEGACY_DATABASE_FILE_NAME)
  const db = openDatabaseAtPath(writerDb)
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.pragma('wal_autocheckpoint = 0')
  seedAppData(db, label)
  mkdirSync(legacyDir, { recursive: true })
  // Copy while the writer is idle but open, so the WAL has not been folded into the main file.
  for (const s of ['', '-wal']) copyFileSync(writerDb + s, legacyDb + s)
  db.close()
}

/** Legacy data cleanly closed (WAL checkpointed into the main file, no side files). */
function createLegacyCheckpointed(label = 'Legacy'): void {
  mkdirSync(legacyDir, { recursive: true })
  const db = openDatabaseAtPath(legacyDb)
  seedAppData(db, label)
  db.close()
}

function hashDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isFile()) out[name] = createHash('sha256').update(readFileSync(p)).digest('hex')
  }
  return out
}

/**
 * Legacy preservation contract (orchestrator-approved SQLite snapshot): the database file and any existing
 * WAL stay byte-identical; the only allowed changes are SQLite-managed sidecars — the `-shm` index may be
 * created or rewritten, and an empty `-wal` may be created where none existed.
 */
function expectLegacyPreserved(before: Record<string, string>): void {
  const after = hashDir(legacyDir)
  for (const [name, hash] of Object.entries(before)) {
    if (name.endsWith('-shm')) continue
    expect(after[name], `${name} must be unchanged`).toBe(hash)
  }
  for (const name of Object.keys(after).filter((n) => !(n in before))) {
    expect(name === LEGACY_DATABASE_FILE_NAME + '-shm' || name === LEGACY_DATABASE_FILE_NAME + '-wal', name).toBe(true)
    if (name.endsWith('-wal')) expect(statSync(join(legacyDir, name)).size, `${name} must be empty`).toBe(0)
  }
}

function openCanonical(): Database.Database {
  return openDatabaseAtPath(canonicalDb)
}

describe('prepareUserDataDirectory: fresh install', () => {
  it('reports fresh, creates nothing in the legacy location, and leaves the DB to normal init', () => {
    expect(prepare()).toEqual({ outcome: 'fresh' })
    expect(existsSync(legacyDir)).toBe(false)
    expect(existsSync(canonicalDb)).toBe(false)

    mkdirSync(canonicalDir, { recursive: true }) // as getDatabase() does
    const db = openCanonical()
    expect(listDevices(db, null)).toEqual([])
    db.close()
    expect(prepare()).toEqual({ outcome: 'canonical-existing', legacyDatabasePresent: false })
  })

  it('treats a legacy directory without a database (Chromium profile only) as fresh', () => {
    mkdirSync(join(legacyDir, 'Local Storage'), { recursive: true })
    expect(prepare()).toEqual({ outcome: 'fresh' })
    expect(existsSync(canonicalDb)).toBe(false)
  })
})

describe('prepareUserDataDirectory: legacy migration', () => {
  it('migrates devices, settings, profiles, events and map data, including rows only in the WAL', () => {
    createLegacyWithUncheckpointedWal()
    expect(statSync(legacyDb + '-wal').size).toBeGreaterThan(0)

    const result = prepare()
    expect(result.outcome).toBe('migrated')

    const db = openCanonical()
    expect(listDevices(db, null).map((d) => d.name).sort()).toEqual(['Legacy NAS', 'Legacy Router'])
    expect(getSettings(db)).toMatchObject({ pingIntervalMs: 9000, listenAdapterNames: ['eth0'] })
    expect(listNetworkProfiles(db, null).map((p) => p.name)).toEqual(['Legacy Home'])
    expect(listEventLogs(db, {}).map((e) => e.message)).toContain('Legacy event')
    expect(getMapLayoutBundle(db, NET).positions.gateway).toMatchObject({ x: 10, y: 20 })
    db.close()
  })

  it('produces a self-contained canonical file (no dependency on a WAL side file)', () => {
    createLegacyWithUncheckpointedWal()
    prepare()
    expect(existsSync(canonicalDb + '-wal')).toBe(false)
    const ro = new Database(canonicalDb, { readonly: true })
    expect((ro.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n).toBe(2)
    ro.close()
  })

  it('the WAL fixture is meaningful: the legacy main file alone does not hold the devices', () => {
    createLegacyWithUncheckpointedWal()
    const mainOnly = join(root, 'main-only.db')
    copyFileSync(legacyDb, mainOnly)
    const db = new Database(mainOnly)
    const n = (db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n
    db.close()
    expect(n).toBe(0)
  })

  it('migrates a cleanly closed (checkpointed) legacy database', () => {
    createLegacyCheckpointed()
    expect(prepare().outcome).toBe('migrated')
    const db = openCanonical()
    expect(listDevices(db, null)).toHaveLength(2)
    db.close()
  })

  // Contract changed with the orchestrator-approved SQLite snapshot: previously the whole legacy directory
  // had to be byte-identical; now only SQLite's own `-shm` index may be added (see expectLegacyPreserved).
  it('keeps the legacy database and its WAL byte-identical and un-checkpointed (only -shm may appear)', () => {
    createLegacyWithUncheckpointedWal()
    const before = hashDir(legacyDir)
    prepare()
    expectLegacyPreserved(before)
    expect(readdirSync(legacyDir).sort()).toEqual(
      [LEGACY_DATABASE_FILE_NAME, LEGACY_DATABASE_FILE_NAME + '-shm', LEGACY_DATABASE_FILE_NAME + '-wal'].sort()
    )
    // The WAL was not folded into the main file: the main file alone still holds no devices.
    const mainOnly = join(root, 'main-only-after.db')
    copyFileSync(legacyDb, mainOnly)
    const db = new Database(mainOnly)
    expect((db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n).toBe(0)
    db.close()
  })

  it('applies schema upgrades only to the new copy, never to the legacy database', () => {
    mkdirSync(legacyDir, { recursive: true })
    const old = new Database(legacyDb)
    old.exec(`
      CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, ip TEXT NOT NULL UNIQUE,
        subnet TEXT NOT NULL DEFAULT '', gateway TEXT NOT NULL DEFAULT '', mac_address TEXT,
        last_status TEXT NOT NULL DEFAULT 'unknown', last_checked TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO devices (id, name, ip) VALUES ('d1', 'Old', '192.168.1.1');
    `)
    old.close()
    const before = hashDir(legacyDir)

    expect(prepare().outcome).toBe('migrated')
    expectLegacyPreserved(before)
    const legacy = new Database(legacyDb, { readonly: true })
    const legacyTables = legacy.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).pluck().all()
    const legacyDeviceCols = legacy.prepare(`SELECT name FROM pragma_table_info('devices')`).pluck().all()
    legacy.close()
    expect(legacyTables).toEqual(['devices', 'settings'])
    expect(legacyDeviceCols).not.toContain('network_id')
    const migrated = new Database(canonicalDb, { readonly: true })
    expect(migrated.prepare(`SELECT name FROM pragma_table_info('devices')`).pluck().all()).toContain('network_id')
    migrated.close()
  })

  it('writes a migration record whose row counts match the migrated database', () => {
    createLegacyWithUncheckpointedWal()
    const result = prepare()
    if (result.outcome !== 'migrated') throw new Error('expected migration')

    const record = JSON.parse(readFileSync(join(canonicalDir, MIGRATION_RECORD_FILE_NAME), 'utf8'))
    expect(record).toEqual(result.record)
    expect(record).toMatchObject({
      migratedAt: '2026-10-28T12:00:00.000Z',
      fromProduct: 'System Status',
      sourceDatabasePath: legacyDb,
      databasePath: canonicalDb
    })
    const ro = new Database(canonicalDb, { readonly: true })
    for (const [table, n] of Object.entries(record.tableRowCounts as Record<string, number>)) {
      expect((ro.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n).toBe(n)
    }
    ro.close()
    expect(record.tableRowCounts.devices).toBe(2)
    expect(record.tableRowCounts.network_profiles).toBe(1)
  })

  it('copies only the database: no staging, temp files or Chromium profile data remain', () => {
    createLegacyWithUncheckpointedWal()
    mkdirSync(join(legacyDir, 'Local Storage'))
    writeFileSync(join(legacyDir, 'Preferences'), '{}')
    writeFileSync(legacyDb + '-shm', Buffer.alloc(32768))
    prepare()
    expect(readdirSync(canonicalDir).sort()).toEqual([DATABASE_FILE_NAME, MIGRATION_RECORD_FILE_NAME].sort())
  })
})

describe('prepareUserDataDirectory: existing canonical data', () => {
  it('uses an existing canonical database untouched when no legacy data exists', () => {
    mkdirSync(canonicalDir, { recursive: true })
    const db = openCanonical()
    seedAppData(db, 'Canonical')
    db.close()
    const before = hashDir(canonicalDir)

    expect(prepare()).toEqual({ outcome: 'canonical-existing', legacyDatabasePresent: false })
    expect(hashDir(canonicalDir)).toEqual(before)
  })

  it('never replaces or merges into canonical data when both legacy and canonical exist', () => {
    createLegacyWithUncheckpointedWal('Legacy')
    mkdirSync(canonicalDir, { recursive: true })
    const db = openCanonical()
    applyUserSaveDevicePayload(db, { name: 'Only Canonical', ip: '10.0.0.5', subnet: '255.255.255.0', gateway: '10.0.0.1' })
    db.close()
    const before = hashDir(canonicalDir)

    expect(prepare()).toEqual({ outcome: 'canonical-existing', legacyDatabasePresent: true })
    expect(hashDir(canonicalDir)).toEqual(before)
    const after = openCanonical()
    expect(listDevices(after, null).map((d) => d.name)).toEqual(['Only Canonical'])
    after.close()
  })

  it('is idempotent across repeated launches and does not re-import later legacy changes', () => {
    createLegacyCheckpointed()
    expect(prepare().outcome).toBe('migrated')

    // Normal use after migration.
    const db = openCanonical()
    applyUserSaveDevicePayload(db, { name: 'Added After Migration', ip: '192.168.1.50', subnet: '255.255.255.0', gateway: '192.168.1.1' })
    db.close()
    // Stale legacy app writes later; must not leak in.
    const legacy = openDatabaseAtPath(legacyDb)
    applyUserSaveDevicePayload(legacy, { name: 'Late Legacy', ip: '192.168.1.60', subnet: '255.255.255.0', gateway: '192.168.1.1' })
    legacy.close()
    const record = readFileSync(join(canonicalDir, MIGRATION_RECORD_FILE_NAME), 'utf8')

    for (let i = 0; i < 3; i++) {
      expect(prepare()).toEqual({ outcome: 'canonical-existing', legacyDatabasePresent: true })
    }
    const after = openCanonical()
    expect(listDevices(after, null).map((d) => d.name).sort()).toEqual([
      'Added After Migration',
      'Legacy NAS',
      'Legacy Router'
    ])
    expect(listNetworkProfiles(after, null)).toHaveLength(1)
    after.close()
    expect(readFileSync(join(canonicalDir, MIGRATION_RECORD_FILE_NAME), 'utf8')).toBe(record)
  })

  it('refuses to start empty when a recorded migration exists but the canonical DB has gone missing', () => {
    createLegacyCheckpointed()
    prepare()
    rmSync(canonicalDb)
    const legacyBefore = hashDir(legacyDir)

    const err = expectFailure(() => prepare(), 'canonical-missing')
    expect(err.message).toContain(canonicalDb)
    expect(existsSync(canonicalDb)).toBe(false)
    expectLegacyPreserved(legacyBefore)
  })
})

describe('prepareUserDataDirectory: incomplete and failed migrations', () => {
  it('discards leftovers of an interrupted migration and migrates cleanly', () => {
    createLegacyWithUncheckpointedWal()
    mkdirSync(join(canonicalDir, MIGRATION_STAGING_DIR_NAME), { recursive: true })
    writeFileSync(join(canonicalDir, MIGRATION_STAGING_DIR_NAME, LEGACY_DATABASE_FILE_NAME), 'partial')
    writeFileSync(canonicalDb + '.migrating', 'partial copy, not a database')

    expect(prepare().outcome).toBe('migrated')
    expect(readdirSync(canonicalDir).sort()).toEqual([DATABASE_FILE_NAME, MIGRATION_RECORD_FILE_NAME].sort())
    const db = openCanonical()
    expect(listDevices(db, null)).toHaveLength(2)
    db.close()
  })

  it('does not treat a partial temp file as a valid destination on a fresh install', () => {
    mkdirSync(canonicalDir, { recursive: true })
    writeFileSync(canonicalDb + '.migrating', 'partial')
    expect(prepare()).toEqual({ outcome: 'fresh' })
    expect(existsSync(canonicalDb)).toBe(false)
    expect(existsSync(canonicalDb + '.migrating')).toBe(false)
  })

  it('refuses to migrate while the legacy app is running, creating nothing', () => {
    createLegacyWithUncheckpointedWal()
    const before = hashDir(legacyDir)
    const err = expectFailure(() => prepare({ isLegacyInstanceRunning: () => true }), 'legacy-in-use')
    expect(err.message).toMatch(/Quit System Status/)
    expect(existsSync(canonicalDb)).toBe(false)
    expectLegacyPreserved(before)
  })

  it('aborts and cleans up when the legacy app starts during the copy', () => {
    createLegacyWithUncheckpointedWal()
    let calls = 0
    expectFailure(() => prepare({ isLegacyInstanceRunning: () => ++calls > 1 }), 'legacy-in-use')
    expect(calls).toBe(2)
    expect(existsSync(canonicalDb)).toBe(false)
    expect(readdirSync(canonicalDir)).toEqual([])
  })

  it('never overwrites a canonical database that appears mid-migration', () => {
    createLegacyWithUncheckpointedWal()
    let calls = 0
    expectFailure(
      () =>
        prepare({
          isLegacyInstanceRunning: () => {
            if (++calls === 2) writeFileSync(canonicalDb, 'appeared concurrently')
            return false
          }
        }),
      'io'
    )
    expect(readFileSync(canonicalDb, 'utf8')).toBe('appeared concurrently')
    expect(existsSync(join(canonicalDir, MIGRATION_RECORD_FILE_NAME))).toBe(false)
  })

  it('rejects a legacy file that is not a SQLite database', () => {
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(legacyDb, 'this is not a database '.repeat(400))
    const before = hashDir(legacyDir)
    const err = expectFailure(() => prepare(), 'legacy-unreadable')
    expect(err.message).toContain(legacyDb)
    expect(existsSync(canonicalDb)).toBe(false)
    expectLegacyPreserved(before)
  })

  it('rejects a corrupted legacy database', () => {
    mkdirSync(legacyDir, { recursive: true })
    const db = openDatabaseAtPath(legacyDb)
    const ins = db.prepare(`INSERT INTO dismissed_discovered_ips (ip, dismissed_at) VALUES (?, ?)`)
    for (let i = 0; i < 3000; i++) ins.run(`10.${i >> 8}.${i & 255}.1`, 'x'.repeat(40))
    db.close()
    const bytes = readFileSync(legacyDb)
    expect(bytes.length).toBeGreaterThan(4096 * 8)
    bytes.fill(0xa5, 4096 * 2, 4096 * 6)
    writeFileSync(legacyDb, bytes)
    const before = hashDir(legacyDir)

    expectFailure(() => prepare(), 'legacy-unreadable')
    expect(existsSync(canonicalDb)).toBe(false)
    expect(readdirSync(canonicalDir)).toEqual([])
    expectLegacyPreserved(before)
  })

  it('rejects an empty legacy file instead of migrating an empty database', () => {
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(legacyDb, '')
    expectFailure(() => prepare(), 'legacy-invalid')
    expect(existsSync(canonicalDb)).toBe(false)
  })

  it('rejects a valid SQLite file that is not System Status data', () => {
    mkdirSync(legacyDir, { recursive: true })
    const db = new Database(legacyDb)
    db.exec('CREATE TABLE something_else (x INTEGER)')
    db.close()
    expectFailure(() => prepare(), 'legacy-invalid')
    expect(existsSync(canonicalDb)).toBe(false)
  })
})

describe('database open ordering', () => {
  it('getDatabase() refuses to open before user-data preparation, then defers to userData', () => {
    expect(() => getDatabase()).toThrow(/before user-data preparation/)
    markUserDataPrepared()
    // Past the gate it resolves userData; the test stub throws there, proving the gate was the blocker.
    expect(() => getDatabase()).toThrow(/electron stub: app\.getPath\('userData'\)/)
  })
})

describe('legacy instance detection', () => {
  it('parses Chromium SingletonLock targets, including hostnames with dashes', () => {
    expect(parseSingletonLockTarget('my-mac-1234')).toEqual({ host: 'my-mac', pid: 1234 })
    expect(parseSingletonLockTarget('host-0')).toBeNull()
    expect(parseSingletonLockTarget('nohyphen')).toBeNull()
    expect(parseSingletonLockTarget('host-abc')).toBeNull()
  })

  it('reports not in use when no lock exists', () => {
    mkdirSync(legacyDir, { recursive: true })
    expect(isUserDataDirInUse(legacyDir)).toBe(false)
  })

  it.runIf(process.platform === 'win32')('Windows: stale lockfile is not in use; a held lockfile is', async () => {
    mkdirSync(legacyDir, { recursive: true })
    const lockfile = join(legacyDir, 'lockfile')
    writeFileSync(lockfile, '')
    expect(isUserDataDirInUse(legacyDir)).toBe(false)

    // Hold it the way Chromium does: write access, read-only sharing.
    const holder: ChildProcess = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$f=[System.IO.File]::Open('${lockfile.replace(/'/g, "''")}','Open','Write','Read'); ` +
          `[Console]::Out.WriteLine('held'); [Console]::In.ReadLine() | Out-Null; $f.Close()`
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] }
    )
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout!.on('data', (d) => String(d).includes('held') && resolve())
        holder.on('exit', () => reject(new Error('lock holder exited early')))
      })
      expect(isUserDataDirInUse(legacyDir)).toBe(true)
      expect(readFileSync(lockfile).length).toBe(0)
    } finally {
      holder.stdin!.end('\n')
      await new Promise((r) => holder.on('exit', r))
    }
    expect(isUserDataDirInUse(legacyDir)).toBe(false)
  }, 20_000)
})
