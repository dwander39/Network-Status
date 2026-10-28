import Database from 'better-sqlite3'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { hostname } from 'os'
import { basename, join } from 'path'

/**
 * One-time copy of pre-rename ("System Status") data into the canonical ("Network Status")
 * user-data directory. Electron-free so it can be tested against real SQLite files in temp dirs.
 * See docs/ARCHITECTURE.md → "Product identity and legacy data migration" for the design.
 *
 * Invariants: legacy files are only ever read; an existing canonical database is never replaced;
 * only a fully validated file is ever given the canonical database name.
 */

export const MIGRATION_RECORD_FILE_NAME = 'legacy-migration.json'
export const MIGRATION_STAGING_DIR_NAME = '.legacy-migration'
export const MIGRATION_TEMP_SUFFIX = '.migrating'

/** SQLite side files copied with the database. `-shm` is deliberately excluded (rebuilt from the WAL). */
const SQLITE_COPIED_SUFFIXES = ['', '-wal', '-journal'] as const

export type LegacyMigrationFailureReason =
  | 'legacy-in-use'
  | 'legacy-changed-during-copy'
  | 'legacy-unreadable'
  | 'legacy-invalid'
  | 'validation-failed'
  | 'canonical-missing'
  | 'io'

export class LegacyDataMigrationError extends Error {
  constructor(
    readonly reason: LegacyMigrationFailureReason,
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'LegacyDataMigrationError'
  }
}

export interface LegacyMigrationRecord {
  migratedAt: string
  fromProduct: 'System Status'
  sourceDatabasePath: string
  databasePath: string
  tableRowCounts: Record<string, number>
}

export type UserDataPreparationResult =
  | { outcome: 'fresh' }
  | { outcome: 'canonical-existing'; legacyDatabasePresent: boolean }
  | { outcome: 'migrated'; record: LegacyMigrationRecord }

export interface PrepareUserDataOptions {
  canonicalDir: string
  canonicalDatabaseFileName: string
  legacyDir: string
  legacyDatabaseFileName: string
  /** Defaults to probing the legacy Chromium single-instance lock. */
  isLegacyInstanceRunning?: (legacyDir: string) => boolean
  now?: () => Date
}

export function prepareUserDataDirectory(opts: PrepareUserDataOptions): UserDataPreparationResult {
  const canonicalDb = join(opts.canonicalDir, opts.canonicalDatabaseFileName)
  const legacyDb = join(opts.legacyDir, opts.legacyDatabaseFileName)
  const recordPath = join(opts.canonicalDir, MIGRATION_RECORD_FILE_NAME)

  if (existsSync(canonicalDb)) {
    removeMigrationArtifacts(opts.canonicalDir, canonicalDb)
    return { outcome: 'canonical-existing', legacyDatabasePresent: existsSync(legacyDb) }
  }

  if (existsSync(recordPath)) {
    throw new LegacyDataMigrationError(
      'canonical-missing',
      `Network Status data was migrated from System Status earlier, but the database file is missing:\n` +
        `${canonicalDb}\n\n` +
        `Nothing was changed. Restore that file from a backup, or delete\n${recordPath}\n` +
        `to import the original System Status data again` +
        (existsSync(legacyDb) ? ` (still present at ${legacyDb}).` : ` (no System Status data was found).`)
    )
  }

  if (!existsSync(legacyDb)) {
    if (existsSync(opts.canonicalDir)) removeMigrationArtifacts(opts.canonicalDir, canonicalDb)
    return { outcome: 'fresh' }
  }

  return migrateLegacyDatabase(opts, legacyDb, canonicalDb, recordPath)
}

function migrateLegacyDatabase(
  opts: PrepareUserDataOptions,
  legacyDb: string,
  canonicalDb: string,
  recordPath: string
): UserDataPreparationResult {
  const isRunning = opts.isLegacyInstanceRunning ?? isUserDataDirInUse
  const inUseError = (): LegacyDataMigrationError =>
    new LegacyDataMigrationError(
      'legacy-in-use',
      `System Status appears to be running, so its data cannot be copied safely.\n\n` +
        `Quit System Status (including its tray icon) and start Network Status again.\n` +
        `Data folder: ${opts.legacyDir}`
    )
  if (isRunning(opts.legacyDir)) throw inUseError()

  const stagingDir = join(opts.canonicalDir, MIGRATION_STAGING_DIR_NAME)
  const tempDb = canonicalDb + MIGRATION_TEMP_SUFFIX
  try {
    mkdirSync(opts.canonicalDir, { recursive: true })
    removeMigrationArtifacts(opts.canonicalDir, canonicalDb)
    mkdirSync(stagingDir, { recursive: true })

    const stagedDb = join(stagingDir, basename(legacyDb))
    const before = snapshotSqliteFiles(legacyDb)
    for (const suffix of Object.keys(before)) copyFileSync(legacyDb + suffix, stagedDb + suffix)
    if (!sameSnapshot(before, snapshotSqliteFiles(legacyDb))) {
      throw new LegacyDataMigrationError(
        'legacy-changed-during-copy',
        `System Status data changed while it was being copied, so the copy was discarded.\n\n` +
          `Quit System Status (including its tray icon) and start Network Status again.\n` +
          `Data folder: ${opts.legacyDir}`
      )
    }
    if (isRunning(opts.legacyDir)) throw inUseError()

    const sourceCounts = snapshotStagedDatabase(stagedDb, tempDb, legacyDb)
    validateMigratedDatabase(tempDb, sourceCounts)
    fsyncFile(tempDb)

    // Single-instance lock guarantees no other Network Status process; re-check anyway, never overwrite.
    if (existsSync(canonicalDb)) {
      throw new LegacyDataMigrationError(
        'io',
        `A Network Status database appeared while migrating; it was left untouched:\n${canonicalDb}`
      )
    }
    renameSync(tempDb, canonicalDb)

    const record: LegacyMigrationRecord = {
      migratedAt: (opts.now?.() ?? new Date()).toISOString(),
      fromProduct: 'System Status',
      sourceDatabasePath: legacyDb,
      databasePath: canonicalDb,
      tableRowCounts: sourceCounts
    }
    writeFileAtomic(recordPath, JSON.stringify(record, null, 2) + '\n')
    rmSync(stagingDir, { recursive: true, force: true })
    return { outcome: 'migrated', record }
  } catch (e) {
    // Only our own artifacts are cleaned up; the legacy directory and any canonical DB are never touched.
    try {
      removeMigrationArtifacts(opts.canonicalDir, canonicalDb)
    } catch {
      /* keep the original error */
    }
    if (e instanceof LegacyDataMigrationError) throw e
    throw new LegacyDataMigrationError(
      'io',
      `Copying System Status data to Network Status failed: ${errorMessage(e)}\n\n` +
        `The original data was not changed: ${opts.legacyDir}`,
      e
    )
  }
}

/** Opens the staged copy (replaying its WAL), validates it, and writes a consistent snapshot to `tempDb`. */
function snapshotStagedDatabase(stagedDb: string, tempDb: string, legacyDb: string): Record<string, number> {
  let staged: Database.Database
  try {
    staged = new Database(stagedDb, { fileMustExist: true })
  } catch (e) {
    throw unreadable(legacyDb, e)
  }
  try {
    let integrity: unknown
    try {
      integrity = staged.pragma('integrity_check', { simple: true })
    } catch (e) {
      throw unreadable(legacyDb, e)
    }
    if (integrity !== 'ok') throw unreadable(legacyDb, `integrity check reported: ${String(integrity)}`)

    const counts = tableRowCounts(staged)
    if (!('devices' in counts)) {
      throw new LegacyDataMigrationError(
        'legacy-invalid',
        `The System Status data file does not contain System Status data (no devices table), so it was not imported:\n` +
          `${legacyDb}\n\nThe file was not changed.`
      )
    }
    staged.prepare('VACUUM INTO ?').run(tempDb)
    return counts
  } finally {
    staged.close()
  }
}

function validateMigratedDatabase(tempDb: string, expected: Record<string, number>): void {
  const out = new Database(tempDb, { readonly: true, fileMustExist: true })
  try {
    const integrity = out.pragma('integrity_check', { simple: true })
    const actual = tableRowCounts(out)
    const mismatch =
      integrity !== 'ok' ||
      Object.keys(actual).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([table, n]) => actual[table] !== n)
    if (mismatch) {
      throw new LegacyDataMigrationError(
        'validation-failed',
        `The copied Network Status database did not match the System Status data, so it was discarded.\n` +
          `Integrity: ${String(integrity)}. The original data was not changed.`
      )
    }
  } finally {
    out.close()
  }
}

function tableRowCounts(db: Database.Database): Record<string, number> {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[]
  const counts: Record<string, number> = {}
  for (const { name } of tables) {
    const quoted = '"' + name.replace(/"/g, '""') + '"'
    counts[name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get() as { n: number }).n
  }
  return counts
}

type FileSnapshot = Record<string, { size: number; mtimeMs: number }>

function snapshotSqliteFiles(dbPath: string): FileSnapshot {
  const snap: FileSnapshot = {}
  for (const suffix of SQLITE_COPIED_SUFFIXES) {
    try {
      const st = statSync(dbPath + suffix)
      snap[suffix] = { size: st.size, mtimeMs: st.mtimeMs }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  return snap
}

function sameSnapshot(a: FileSnapshot, b: FileSnapshot): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => b[k] && a[k].size === b[k].size && a[k].mtimeMs === b[k].mtimeMs)
}

/** Removes only files this module creates (staging dir, temp DB, temp record) — never the canonical DB. */
function removeMigrationArtifacts(canonicalDir: string, canonicalDb: string): void {
  rmSync(join(canonicalDir, MIGRATION_STAGING_DIR_NAME), { recursive: true, force: true })
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(canonicalDb + MIGRATION_TEMP_SUFFIX + suffix, { force: true })
  }
  rmSync(join(canonicalDir, MIGRATION_RECORD_FILE_NAME + MIGRATION_TEMP_SUFFIX), { force: true })
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = path + MIGRATION_TEMP_SUFFIX
  writeFileSync(tmp, content, 'utf8')
  fsyncFile(tmp)
  renameSync(tmp, path)
}

function fsyncFile(path: string): void {
  const fd = openSync(path, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function unreadable(legacyDb: string, cause: unknown): LegacyDataMigrationError {
  return new LegacyDataMigrationError(
    'legacy-unreadable',
    `The System Status data file could not be read as a valid database, so it was not imported:\n${legacyDb}\n\n` +
      `Reason: ${errorMessage(cause)}\nThe file was not changed. Restore it from a backup, or move it ` +
      `elsewhere to start Network Status with empty data.`,
    cause
  )
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Whether an Electron/Chromium process currently holds the single-instance lock of `userDataDir`.
 * Windows: Chromium keeps `lockfile` open for writing (delete-on-close) while running, so a stale
 * file can be opened for writing and a live one cannot. macOS/Linux: `SingletonLock` symlink → `host-pid`.
 * Only probes; never creates, modifies or deletes anything.
 */
export function isUserDataDirInUse(userDataDir: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') {
    const lockfile = join(userDataDir, 'lockfile')
    if (!existsSync(lockfile)) return false
    try {
      closeSync(openSync(lockfile, 'r+'))
      return false
    } catch (e) {
      return (e as NodeJS.ErrnoException).code !== 'ENOENT'
    }
  }
  const singletonLock = join(userDataDir, 'SingletonLock')
  try {
    lstatSync(singletonLock)
  } catch {
    return false
  }
  let target: string
  try {
    target = readlinkSync(singletonLock)
  } catch {
    return true
  }
  const parsed = parseSingletonLockTarget(target)
  if (!parsed) return true
  if (parsed.host !== hostname()) return true
  return isProcessAlive(parsed.pid)
}

/** Chromium writes `SingletonLock` as a symlink to `<hostname>-<pid>`; hostnames may contain `-`. */
export function parseSingletonLockTarget(target: string): { host: string; pid: number } | null {
  const i = target.lastIndexOf('-')
  if (i <= 0) return null
  const pid = Number(target.slice(i + 1))
  if (!Number.isInteger(pid) || pid <= 0) return null
  return { host: target.slice(0, i), pid }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
