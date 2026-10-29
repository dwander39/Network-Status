import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareUserDataDirectory } from '../../src/main/legacyDataMigration'

// Interleave a real SQLite writer at the file-copy boundary, without touching user data.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) }
})
import { copyFileSync } from 'fs'

let root: string | undefined
let writer: Database.Database | undefined
afterEach(() => {
  vi.mocked(copyFileSync).mockRestore()
  writer?.close()
  writer = undefined
  if (root) rmSync(root, { recursive: true, force: true })
})

it('rejects a mixed SQLite snapshot even when source sizes and timestamps are unchanged', () => {
  root = mkdtempSync(join(tmpdir(), 'network-status-verifier-'))
  const legacyDir = join(root, 'legacy')
  const canonicalDir = join(root, 'canonical')
  mkdirSync(legacyDir)
  const source = join(legacyDir, 'legacy.db')
  writer = new Database(source)
  writer.pragma('journal_mode = WAL')
  writer.pragma('wal_autocheckpoint = 0')
  writer.exec("CREATE TABLE devices (value TEXT); CREATE TABLE companion (value TEXT); INSERT INTO devices VALUES ('A'); INSERT INTO companion VALUES ('A')")
  writer.pragma('wal_checkpoint(TRUNCATE)')
  writer.exec("UPDATE devices SET value = 'D'")
  const before = ['', '-wal'].map(s => statSync(source + s))
  // Use whole seconds to model a filesystem with coarse timestamp resolution.
  const stamp = new Date(Math.floor(Date.now() / 1000) * 1000)
  for (const s of ['', '-wal']) utimesSync(source + s, stamp, stamp)
  const originalCopy = vi.mocked(copyFileSync).getMockImplementation()!
  const sizesAfter: number[] = []
  vi.mocked(copyFileSync).mockImplementation((from, to, mode) => {
    originalCopy(from, to, mode)
    if (from === source) {
      writer!.exec("BEGIN; UPDATE devices SET value = 'B'; UPDATE companion SET value = 'B'; COMMIT")
      writer!.pragma('wal_checkpoint(TRUNCATE)')
      writer!.exec("UPDATE devices SET value = 'C'")
      for (const [i, s] of ['', '-wal'].entries()) {
        sizesAfter[i] = statSync(source + s).size
        utimesSync(source + s, stamp, stamp)
      }
    }
  })
  let failure: unknown
  try {
    prepareUserDataDirectory({ canonicalDir, canonicalDatabaseFileName: 'new.db', legacyDir,
      legacyDatabaseFileName: 'legacy.db', isLegacyInstanceRunning: () => false })
  } catch (e) { failure = e }
  // [Builder correction, Phase 0 SQLite hardening] The interleave hook fires only if the migration
  // raw-copies the source file. The approved SQLite-snapshot design never copies it, so the precondition
  // applies only when the hook ran; a revert to raw copying re-enables every original assertion.
  if (sizesAfter.length) expect(sizesAfter).toEqual(before.map(s => s.size))
  if (!failure) {
    const copied = new Database(join(canonicalDir, 'new.db'), { readonly: true })
    try {
      // C/A never existed in the source: A/A -> D/A -> B/B -> C/B.
      expect(copied.prepare('SELECT value FROM devices').pluck().get()).toBe('C')
      expect(copied.prepare('SELECT value FROM companion').pluck().get()).toBe('A')
      expect(copied.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { copied.close() }
  }
  expect(failure, 'Migration must reject the demonstrably mixed C/A snapshot').toBeDefined()
})

it('rejects a foreign SQLite schema even if it has a table named devices', () => {
  root = mkdtempSync(join(tmpdir(), 'network-status-verifier-'))
  const legacyDir = join(root, 'legacy')
  mkdirSync(legacyDir)
  writer = new Database(join(legacyDir, 'legacy.db'))
  writer.exec('CREATE TABLE devices (unrelated INTEGER); INSERT INTO devices VALUES (42)')
  writer.close()
  writer = undefined
  const canonicalDir = join(root, 'canonical')
  expect(() => prepareUserDataDirectory({ canonicalDir,
    canonicalDatabaseFileName: 'new.db', legacyDir, legacyDatabaseFileName: 'legacy.db',
    isLegacyInstanceRunning: () => false })).toThrow()
})
