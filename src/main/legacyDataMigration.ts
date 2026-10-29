import Database from 'better-sqlite3'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { hostname } from 'os'
import { dirname, join } from 'path'
import { openDatabaseAtPath } from './db/database'

/**
 * One-time copy of pre-rename ("System Status") data into the canonical ("Network Status")
 * user-data directory. Electron-free so it can be tested against real SQLite files in temp dirs.
 * See docs/ARCHITECTURE.md → "Product identity and legacy data migration" for the design.
 *
 * Invariants: the legacy database is only ever read, through a read-only SQLite connection (SQLite
 * may create/update its `-shm` index and create an empty `-wal`; the database and existing WAL content
 * are never written, checkpointed or truncated); schema upgrades run only on the new copy; an existing
 * canonical database is never replaced; only a fully validated file gets the canonical database name.
 */

export const MIGRATION_RECORD_FILE_NAME = 'legacy-migration.json'
export const MIGRATION_STAGING_DIR_NAME = '.legacy-migration'
export const MIGRATION_TEMP_SUFFIX = '.migrating'

/** How long the read-only source connection waits for a lock before reporting the source as in use. */
const SOURCE_BUSY_TIMEOUT_MS = 2000

/**
 * Columns every System Status database has had since its first schema (they are created by the base
 * `CREATE TABLE` in `openDatabaseAtPath` and never added by a later migration). A source lacking them
 * is not a System Status database the inline migrations can upgrade, even if a table name matches.
 */
const REQUIRED_LEGACY_COLUMNS: Record<string, readonly string[]> = {
  devices: ['id', 'name', 'ip', 'subnet', 'gateway', 'mac_address', 'last_status', 'last_checked'],
  settings: ['key', 'value']
}

export type LegacyMigrationFailureReason =
  | 'legacy-in-use'
  | 'legacy-changed-during-snapshot'
  | 'legacy-unreadable'
  | 'legacy-invalid'
  | 'validation-failed'
  | 'canonical-missing'
  | 'install-unsupported'
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
  /** Non-overwriting install primitive; defaults to `fs.linkSync`. Replaceable only to simulate filesystems in tests. */
  installLink?: (existingPath: string, newPath: string) => void
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

  const tempDb = canonicalDb + MIGRATION_TEMP_SUFFIX
  try {
    mkdirSync(opts.canonicalDir, { recursive: true })
    removeMigrationArtifacts(opts.canonicalDir, canonicalDb)

    // Order: consistent snapshot → snapshot integrity → schema compatibility → upgrade the copy only
    // → validate → non-overwriting install → record. The legacy database is only ever read.
    const sourceCounts = snapshotLegacyDatabase(legacyDb, tempDb, opts.legacyDir)
    if (isRunning(opts.legacyDir)) throw inUseError()
    validateSnapshot(tempDb, sourceCounts, legacyDb)
    upgradeAndVerifySchema(tempDb, legacyDb)
    fsyncFile(tempDb)
    installWithoutOverwrite(tempDb, canonicalDb, opts.installLink ?? linkSync)

    const record: LegacyMigrationRecord = {
      migratedAt: (opts.now?.() ?? new Date()).toISOString(),
      fromProduct: 'System Status',
      sourceDatabasePath: legacyDb,
      databasePath: canonicalDb,
      tableRowCounts: sourceCounts
    }
    writeFileAtomic(recordPath, JSON.stringify(record, null, 2) + '\n')
    return { outcome: 'migrated', record }
  } catch (e) {
    // Only our own artifacts are cleaned up; the legacy directory and any canonical DB are never touched.
    // A validated copy that could not be installed is kept for inspection (removed on the next start).
    const keepValidatedCopy = e instanceof LegacyDataMigrationError && e.reason === 'install-unsupported'
    if (!keepValidatedCopy) {
      try {
        removeMigrationArtifacts(opts.canonicalDir, canonicalDb)
      } catch {
        /* keep the original error */
      }
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

/**
 * Transaction-consistent snapshot of the live legacy database via SQLite itself.
 *
 * - The source is opened READ-ONLY, so this connection can never write a page, checkpoint, truncate or
 *   delete the WAL (a read-write connection would checkpoint and delete the WAL when it closes last).
 *   SQLite may still create or rewrite the `-shm` index, and creates an empty `-wal` if none exists.
 * - `VACUUM INTO` runs in ONE read transaction; with WAL snapshot isolation the output is exactly one
 *   committed database state (all tables, all committed WAL frames, no uncommitted frames), including
 *   unknown tables and `user_version`.
 * - `PRAGMA data_version` before and after detects a commit by any other connection while the counts and
 *   snapshot were taken: that writer is live and its later commits would be lost, so the migration aborts.
 */
function snapshotLegacyDatabase(legacyDb: string, tempDb: string, legacyDir: string): Record<string, number> {
  let source: Database.Database
  try {
    source = new Database(legacyDb, { readonly: true, fileMustExist: true, timeout: SOURCE_BUSY_TIMEOUT_MS })
  } catch (e) {
    throw sourceAccessError(legacyDb, legacyDir, e)
  }
  try {
    const versionBefore = source.pragma('data_version', { simple: true })
    const integrity = source.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw unreadable(legacyDb, `integrity check reported: ${String(integrity)}`)
    const counts = tableRowCounts(source)
    source.prepare('VACUUM INTO ?').run(tempDb)
    if (source.pragma('data_version', { simple: true }) !== versionBefore) {
      throw new LegacyDataMigrationError(
        'legacy-changed-during-snapshot',
        `Another program changed the System Status data while it was being copied, so the copy was discarded.\n\n` +
          `Quit System Status (including its tray icon) and start Network Status again.\n` +
          `Data folder: ${legacyDir}`
      )
    }
    return counts
  } catch (e) {
    throw e instanceof LegacyDataMigrationError ? e : sourceAccessError(legacyDb, legacyDir, e)
  } finally {
    source.close()
  }
}

/** Maps SQLite failures on the read-only source connection to actionable, non-destructive errors. */
function sourceAccessError(legacyDb: string, legacyDir: string, e: unknown): LegacyDataMigrationError {
  const code = String((e as { code?: unknown }).code ?? '')
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return new LegacyDataMigrationError(
      'legacy-in-use',
      `The System Status data is locked by another program, so it cannot be copied safely.\n\n` +
        `Quit System Status (including its tray icon) and start Network Status again.\n` +
        `Data folder: ${legacyDir}`,
      e
    )
  }
  if (code.startsWith('SQLITE_READONLY')) {
    // e.g. a hot rollback journal or WAL recovery that needs write access: never done on the legacy file.
    return new LegacyDataMigrationError(
      'legacy-unreadable',
      `The System Status data needs recovery that Network Status will not perform on the original file:\n` +
        `${legacyDb}\n\nReason: ${errorMessage(e)}\nStart System Status once and quit it normally, then ` +
        `start Network Status again. The file was not changed.`,
      e
    )
  }
  if (code.startsWith('SQLITE_')) return unreadable(legacyDb, e)
  return new LegacyDataMigrationError(
    'io',
    `Copying System Status data to Network Status failed: ${errorMessage(e)}\n\nThe original data was not changed: ${legacyDir}`,
    e
  )
}

/** Integrity, row counts against the source snapshot, and the schema compatibility policy — all on the copy. */
function validateSnapshot(tempDb: string, expected: Record<string, number>, legacyDb: string): void {
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
    assertLegacySchemaCompatible(out, legacyDb)
  } finally {
    out.close()
  }
}

/**
 * Compatibility policy (no schema version table exists; every schema change is an idempotent inline
 * migration in `openDatabaseAtPath`):
 * - `PRAGMA user_version` must be 0 — the app never sets it, so anything else was written by a
 *   different or future schema owner the app cannot interpret.
 * - The core tables/columns present since the first schema must exist (`REQUIRED_LEGACY_COLUMNS`).
 * Older schemas missing later tables/columns are accepted; `upgradeAndVerifySchema` proves the real
 * migration path brings them to the current schema.
 */
function assertLegacySchemaCompatible(db: Database.Database, legacyDb: string): void {
  const userVersion = db.pragma('user_version', { simple: true })
  if (userVersion !== 0) {
    throw incompatible(legacyDb, `unsupported schema version ${String(userVersion)}`)
  }
  const columns = tableColumns(db)
  for (const [table, required] of Object.entries(REQUIRED_LEGACY_COLUMNS)) {
    const have = columns[table]
    if (!have) throw incompatible(legacyDb, `missing table "${table}"`)
    const missing = required.filter((c) => !have.includes(c))
    if (missing.length) throw incompatible(legacyDb, `table "${table}" is missing column(s) ${missing.join(', ')}`)
  }
}

/**
 * Runs the application's own schema migrations on the temp copy and checks the result contains every
 * table and column of a freshly created database. Installs nothing if the upgrade fails.
 */
function upgradeAndVerifySchema(tempDb: string, legacyDb: string): void {
  let db: Database.Database
  try {
    db = openDatabaseAtPath(tempDb)
  } catch (e) {
    throw incompatible(legacyDb, `the schema upgrade failed: ${errorMessage(e)}`)
  }
  try {
    const actual = tableColumns(db)
    const missing: string[] = []
    for (const [table, cols] of Object.entries(referenceSchema())) {
      for (const c of cols) if (!actual[table]?.includes(c)) missing.push(`${table}.${c}`)
    }
    if (missing.length) throw incompatible(legacyDb, `after upgrade the schema still lacks ${missing.join(', ')}`)
    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') {
      throw new LegacyDataMigrationError(
        'validation-failed',
        `The upgraded Network Status database failed its integrity check (${String(integrity)}), so it was discarded.\n` +
          `The original data was not changed.`
      )
    }
  } finally {
    db.close()
  }
}

let cachedReferenceSchema: Record<string, string[]> | null = null

/** Current schema, derived from the same code that creates it, so it cannot drift. */
function referenceSchema(): Record<string, string[]> {
  if (!cachedReferenceSchema) {
    const ref = openDatabaseAtPath(':memory:')
    try {
      cachedReferenceSchema = tableColumns(ref)
    } finally {
      ref.close()
    }
  }
  return cachedReferenceSchema
}

function tableColumns(db: Database.Database): Record<string, string[]> {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[]
  const out: Record<string, string[]> = {}
  for (const { name } of tables) {
    out[name] = (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(name) as { name: string }[]).map((r) => r.name)
  }
  return out
}

function incompatible(legacyDb: string, detail: string): LegacyDataMigrationError {
  return new LegacyDataMigrationError(
    'legacy-invalid',
    `The System Status data file is not a database this version of Network Status can import (${detail}), ` +
      `so it was not imported:\n${legacyDb}\n\nThe file was not changed.`
  )
}

/**
 * Gives the validated temp file the canonical name without ever replacing an existing file. A hard link
 * is created atomically and fails with EEXIST if the name exists (temp and target share a directory, so
 * the same filesystem). There is deliberately no rename fallback: Node's rename replaces an existing
 * target. If the filesystem cannot hard-link, the migration stops and keeps the validated copy.
 */
function installWithoutOverwrite(
  tempDb: string,
  canonicalDb: string,
  link: (existingPath: string, newPath: string) => void
): void {
  try {
    link(tempDb, canonicalDb)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new LegacyDataMigrationError(
        'io',
        `A Network Status database appeared while migrating; it was left untouched:\n${canonicalDb}`,
        e
      )
    }
    throw new LegacyDataMigrationError(
      'install-unsupported',
      `The migrated data could not be installed without risking overwriting other data ` +
        `(${errorMessage(e)}). The data folder's drive may not support hard links (e.g. FAT32/exFAT).\n\n` +
        `The validated copy was kept at:\n${tempDb}\nThe original System Status data was not changed. ` +
        `Move the Network Status data folder to an NTFS drive, or contact support.`,
      e
    )
  }
  rmSync(tempDb)
  fsyncDirectory(dirname(canonicalDb))
}

/** Best-effort durability of the new directory entry; directories cannot be opened for fsync on Windows. */
function fsyncDirectory(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    /* unsupported on this platform */
  } finally {
    if (fd !== undefined) closeSync(fd)
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

/**
 * Removes only files this module creates (temp DB and its sidecars, temp record, and the staging dir
 * used by earlier builds) — never the canonical DB.
 */
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
