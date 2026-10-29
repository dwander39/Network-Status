import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync as copyFileSyncReal, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pass-through `copyFileSync`: if the migration ever raw-copies the source again, a test can interleave a
// real SQLite writer at that copy boundary (it never fires with the SQLite-snapshot design).
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) }
})
const { copyFileSync } = await import('fs')
const realCopy = (await vi.importActual<typeof import('fs')>('fs')).copyFileSync
const { openDatabaseAtPath } = await import('../../src/main/db/database')
const { listDevices } = await import('../../src/main/db/deviceRepository')
const { getSettings } = await import('../../src/main/db/settingsRepository')
const { applyUserSaveDevicePayload } = await import('../../src/main/services/equipmentMutationService')
const { LegacyDataMigrationError, prepareUserDataDirectory } = await import('../../src/main/legacyDataMigration')
const betterSqlitePath = createRequire(import.meta.url).resolve('better-sqlite3')

let root: string
let legacyDir: string
let canonicalDir: string
let legacyDb: string
let canonicalDb: string
let writer: Database.Database | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'network-status-consistency-test-'))
  legacyDir = join(root, 'system-status')
  canonicalDir = join(root, 'network-status')
  legacyDb = join(legacyDir, 'system-status.db')
  canonicalDb = join(canonicalDir, 'network-status.db')
  mkdirSync(legacyDir)
})

afterEach(() => {
  vi.mocked(copyFileSync).mockImplementation(realCopy)
  writer?.close()
  writer = undefined
  rmSync(root, { recursive: true, force: true })
})

const prepare = () =>
  prepareUserDataDirectory({
    canonicalDir,
    canonicalDatabaseFileName: 'network-status.db',
    legacyDir,
    legacyDatabaseFileName: 'system-status.db',
    isLegacyInstanceRunning: () => false
  })

function failureReason(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(LegacyDataMigrationError)
    return (e as InstanceType<typeof LegacyDataMigrationError>).reason
  }
  throw new Error('expected the migration to fail')
}

function freezeTimestamps(stamp: Date): void {
  for (const s of ['', '-wal']) utimesSync(legacyDb + s, stamp, stamp)
}

/** Real app schema with a writer left open (uncheckpointed WAL), as a running/killed legacy app leaves it. */
function openLegacyWriter(): Database.Database {
  const db = openDatabaseAtPath(legacyDb)
  applyUserSaveDevicePayload(db, { name: 'Router', ip: '192.168.1.1', subnet: '', gateway: '' })
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.pragma('wal_autocheckpoint = 0')
  db.prepare(`UPDATE devices SET name = 'Router v2'`).run()
  return db
}

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')

describe('SQLite snapshot consistency', () => {
  // Revert detector: with any raw-copy strategy, the hook commits a multi-table transaction and
  // checkpoints at the copy boundary, which yields a state the source never held (cf. Codex's C/A case).
  it('migrates exactly one committed state; a raw copy interleaved with a writer would mix states', () => {
    writer = openLegacyWriter()
    const originalMode = writer.prepare(`SELECT value FROM settings WHERE key = 'arpCacheMode'`).pluck().get()
    const stamp = new Date(Math.floor(Date.now() / 1000) * 1000)
    freezeTimestamps(stamp)
    vi.mocked(copyFileSync).mockImplementation((from, to, mode) => {
      realCopy(from, to, mode)
      if (from !== legacyDb) return
      writer!.exec(`BEGIN; UPDATE devices SET name = 'Router v3'; UPDATE settings SET value = '"x"' WHERE key = 'arpCacheMode'; COMMIT`)
      writer!.pragma('wal_checkpoint(TRUNCATE)')
      writer!.prepare(`UPDATE devices SET name = 'Router v4'`).run()
      freezeTimestamps(stamp)
    })

    expect(prepare().outcome).toBe('migrated')
    const db = new Database(canonicalDb, { readonly: true })
    const pair = [
      db.prepare(`SELECT name FROM devices`).pluck().get(),
      db.prepare(`SELECT value FROM settings WHERE key = 'arpCacheMode'`).pluck().get()
    ]
    db.close()
    // Every state the source actually held; ['Router v4', original] never existed.
    expect([
      ['Router v2', originalMode],
      ['Router v3', '"x"'],
      ['Router v4', '"x"']
    ]).toContainEqual(pair)
  })

  it('includes every committed WAL transaction across related tables and excludes an open transaction', () => {
    writer = openLegacyWriter()
    writer.exec(`BEGIN;
      UPDATE devices SET name = 'Committed';
      INSERT INTO settings (key, value) VALUES ('consistencyProbe', '"committed"');
      COMMIT`)
    writer.exec(`BEGIN; UPDATE devices SET name = 'Uncommitted'; UPDATE settings SET value = '"uncommitted"' WHERE key = 'consistencyProbe'`)

    expect(prepare().outcome).toBe('migrated')
    writer.exec('ROLLBACK')
    const db = new Database(canonicalDb, { readonly: true })
    expect(db.prepare(`SELECT name FROM devices`).pluck().all()).toEqual(['Committed'])
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'consistencyProbe'`).pluck().get()).toBe('"committed"')
    db.close()
  })

  it('under concurrent multi-table commits from another process, never installs a mixed state and keeps the writer’s data', async () => {
    const setup = openDatabaseAtPath(legacyDb)
    applyUserSaveDevicePayload(setup, { name: 'n0', ip: '192.168.1.1', subnet: '', gateway: '' })
    setup.prepare(`INSERT INTO settings (key, value) VALUES ('consistencyProbe', '0')`).run()
    const pad = setup.prepare(`INSERT INTO dismissed_discovered_ips (ip, dismissed_at) VALUES (?, ?)`)
    setup.transaction(() => {
      for (let i = 0; i < 20000; i++) pad.run(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, 'x'.repeat(60))
    })()
    setup.close()

    // Separate process (real cross-process SQLite locking), committing both tables in one transaction.
    const script = `
      const D = require(${JSON.stringify(betterSqlitePath)})
      const db = new D(${JSON.stringify(legacyDb)}); db.pragma('busy_timeout = 5000')
      const a = db.prepare("UPDATE devices SET name = ?"), b = db.prepare("UPDATE settings SET value = ? WHERE key = 'consistencyProbe'")
      const tx = db.transaction((i) => { a.run('n' + i); b.run(String(i)) })
      process.stdout.write('ready\\n')
      let i = 0; const end = Date.now() + 4000
      while (Date.now() < end) tx(++i)
      db.close(); process.stdout.write('last=' + i + '\\n')`
    const child = spawn(process.execPath, ['-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', () => out.includes('ready') && resolve())
      child.on('exit', (code) => reject(new Error(`writer exited early (${code})`)))
    })

    const outcomes: string[] = []
    const deadline = Date.now() + 2500
    while (Date.now() < deadline) {
      rmSync(canonicalDir, { recursive: true, force: true })
      try {
        prepare()
        const db = new Database(canonicalDb, { readonly: true })
        const name = db.prepare(`SELECT name FROM devices`).pluck().get() as string
        const probe = db.prepare(`SELECT value FROM settings WHERE key = 'consistencyProbe'`).pluck().get() as string
        db.close()
        expect(name).toBe('n' + probe) // both tables from the same commit
        outcomes.push('migrated')
      } catch (e) {
        expect(e).toBeInstanceOf(LegacyDataMigrationError)
        const reason = (e as InstanceType<typeof LegacyDataMigrationError>).reason
        expect(['legacy-changed-during-snapshot', 'legacy-in-use']).toContain(reason)
        outcomes.push(reason)
      }
    }
    await new Promise((r) => child.on('exit', r))
    const last = Number(/last=(\d+)/.exec(out)?.[1])

    expect(outcomes.length).toBeGreaterThan(0)
    expect(outcomes).toContain('legacy-changed-during-snapshot') // the live writer was detected
    const legacy = new Database(legacyDb, { readonly: true })
    expect(legacy.prepare(`SELECT name FROM devices`).pluck().get()).toBe('n' + last) // no writer commit lost
    legacy.close()
  }, 20_000)

  it('reports a source locked by another connection as in use, creating nothing', () => {
    writer = new Database(legacyDb)
    writer.pragma('journal_mode = WAL')
    writer.pragma('locking_mode = EXCLUSIVE')
    writer.exec(`CREATE TABLE devices (id TEXT); INSERT INTO devices VALUES ('a')`)

    expect(failureReason(prepare)).toBe('legacy-in-use')
    expect(readdirSync(canonicalDir)).toEqual([])
    expect(existsSync(legacyDb + '-shm')).toBe(false) // our reader did not even get a shared index
  })

  it('refuses a source that needs hot-journal recovery instead of recovering the original file', () => {
    // A rollback-journal database with a hot journal, as left by a crash mid-transaction.
    const crashDir = join(root, 'crash')
    mkdirSync(crashDir)
    const crashDb = join(crashDir, 'system-status.db')
    const w = new Database(crashDb)
    w.pragma('journal_mode = DELETE')
    w.pragma('cache_size = 1')
    w.exec(`CREATE TABLE devices (id TEXT); CREATE TABLE settings (key TEXT, value TEXT)`)
    w.exec('BEGIN')
    const ins = w.prepare(`INSERT INTO devices VALUES (?)`)
    for (let i = 0; i < 3000; i++) ins.run('x'.repeat(200))
    copyFileSyncReal(crashDb, legacyDb)
    copyFileSyncReal(crashDb + '-journal', legacyDb + '-journal')
    w.exec('ROLLBACK')
    w.close()
    const before = [sha(legacyDb), sha(legacyDb + '-journal')]

    expect(failureReason(prepare)).toBe('legacy-unreadable')
    expect([sha(legacyDb), sha(legacyDb + '-journal')]).toEqual(before)
    expect(existsSync(canonicalDb)).toBe(false)
  })
})

describe('non-overwriting installation', () => {
  it('never overwrites a destination that appears immediately before installation', () => {
    writer = openLegacyWriter()
    expectFailureWith(
      () =>
        prepareWith({
          installLink: (from, to) => {
            writeFileSync(to, 'created by another process')
            linkSync(from, to)
          }
        }),
      'io'
    )
    expect(readFileSync(canonicalDb, 'utf8')).toBe('created by another process')
  })

  it('stops without a destructive fallback when the filesystem cannot hard-link, keeps the validated copy, and retries cleanly', () => {
    writer = openLegacyWriter()
    const unsupported = (): void => {
      throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' })
    }
    const err = expectFailureWith(() => prepareWith({ installLink: unsupported }), 'install-unsupported')
    expect(existsSync(canonicalDb)).toBe(false)
    const kept = canonicalDb + '.migrating'
    expect(err.message).toContain(kept)
    const copy = new Database(kept, { readonly: true })
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(copy.prepare(`SELECT name FROM devices`).pluck().all()).toEqual(['Router v2'])
    copy.close()

    // Next start on a filesystem that supports it: the leftover is discarded and the migration completes.
    expect(prepare().outcome).toBe('migrated')
    expect(existsSync(kept)).toBe(false)
  })
})

function prepareWith(extra: { installLink?: (a: string, b: string) => void }) {
  return prepareUserDataDirectory({
    canonicalDir,
    canonicalDatabaseFileName: 'network-status.db',
    legacyDir,
    legacyDatabaseFileName: 'system-status.db',
    isLegacyInstanceRunning: () => false,
    ...extra
  })
}

function expectFailureWith(fn: () => unknown, reason: string): InstanceType<typeof LegacyDataMigrationError> {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(LegacyDataMigrationError)
    expect((e as InstanceType<typeof LegacyDataMigrationError>).reason).toBe(reason)
    return e as InstanceType<typeof LegacyDataMigrationError>
  }
  throw new Error(`expected the migration to fail with ${reason}`)
}


describe('schema compatibility', () => {
  /** The earliest schema the inline migrations upgrade: the base tables, before any later migration. */
  function createOldestSupportedSchema(): void {
    const db = new Database(legacyDb)
    db.exec(`
      CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, ip TEXT NOT NULL UNIQUE,
        subnet TEXT NOT NULL DEFAULT '', gateway TEXT NOT NULL DEFAULT '', mac_address TEXT,
        last_status TEXT NOT NULL DEFAULT 'unknown', last_checked TEXT);
      CREATE TABLE arp_entries (id TEXT PRIMARY KEY, ip TEXT NOT NULL UNIQUE, mac_address TEXT NOT NULL,
        vendor TEXT, last_seen TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO devices (id, name, ip) VALUES ('d1', 'Old Router', '192.168.1.1');
      INSERT INTO settings VALUES ('pingIntervalMs', '7000');
    `)
    db.close()
  }

  it('migrates the oldest supported schema and upgrades it to the current schema', () => {
    createOldestSupportedSchema()
    expect(prepare().outcome).toBe('migrated')
    const db = openDatabaseAtPath(canonicalDb)
    expect(listDevices(db, null).map((d) => [d.name, d.deviceType])).toEqual([['Old Router', 'Unknown']])
    expect(getSettings(db).pingIntervalMs).toBe(7000)
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).pluck().all() as string[]).sort()
    expect(tables).toEqual(expect.arrayContaining(['event_logs', 'map_layout_positions', 'network_profiles']))
    db.close()
  })

  it('rejects a devices table without the System Status core columns', () => {
    const db = new Database(legacyDb)
    db.exec(`CREATE TABLE devices (id TEXT, name TEXT); CREATE TABLE settings (key TEXT, value TEXT)`)
    db.close()
    expect(failureReason(prepare)).toBe('legacy-invalid')
    expect(existsCanonical()).toBe(false)
  })

  it('rejects a database without the settings table', () => {
    createOldestSupportedSchema()
    const db = new Database(legacyDb)
    db.exec(`DROP TABLE settings`)
    db.close()
    expect(failureReason(prepare)).toBe('legacy-invalid')
  })

  it('rejects an unsupported (future/foreign) schema version', () => {
    createOldestSupportedSchema()
    const db = new Database(legacyDb)
    db.pragma('user_version = 7')
    db.close()
    expect(failureReason(prepare)).toBe('legacy-invalid')
    expect(existsCanonical()).toBe(false)
  })

  it('rejects a source whose known tables cannot be upgraded, installing nothing', () => {
    createOldestSupportedSchema()
    const db = new Database(legacyDb)
    // A known table with an incompatible shape: the real migration (index on network_id) cannot run.
    db.exec(`DROP TABLE arp_entries; CREATE TABLE arp_entries (unrelated INTEGER)`)
    db.close()
    expect(failureReason(prepare)).toBe('legacy-invalid')
    expect(readdirSync(canonicalDir)).toEqual([])
  })
})

function existsCanonical(): boolean {
  try {
    statSync(canonicalDb)
    return true
  } catch {
    return false
  }
}
