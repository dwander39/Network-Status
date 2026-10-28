import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabaseAtPath } from '../../../src/main/db/database'

export interface TempDb {
  db: Database.Database
  path: string
  /** Close and reopen the same file (exercises migrations on an existing schema). */
  reopen: () => Database.Database
  dispose: () => void
}

/** Fully migrated SQLite database in its own temp directory; never touches the user's real data. */
export function createTempDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'network-status-test-'))
  const path = join(dir, 'test.db')
  const handle: TempDb = {
    db: openDatabaseAtPath(path),
    path,
    reopen: () => {
      handle.db.close()
      handle.db = openDatabaseAtPath(path)
      return handle.db
    },
    dispose: () => {
      if (handle.db.open) handle.db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return handle
}
