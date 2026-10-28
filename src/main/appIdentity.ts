import { join, resolve } from 'path'

/**
 * Product identity. The app was named "System Status" before Phase 0B and is now "Network Status".
 * Electron-free (apart from the `app`-shaped parameter) so path resolution is unit-testable.
 */
export const PRODUCT_NAME = 'Network Status'

/** Canonical per-user data directory name under `appData`, and the database file inside it. */
export const USER_DATA_DIR_NAME = 'network-status'
export const DATABASE_FILE_NAME = 'network-status.db'

/**
 * Pre-rename identity. Kept ONLY so existing data can be found and migrated (read-only).
 * Electron derived `userData` from the package name `system-status`; the database file name was fixed.
 */
export const LEGACY_USER_DATA_DIR_NAME = 'system-status'
export const LEGACY_DATABASE_FILE_NAME = 'system-status.db'

/**
 * Windows AppUserModelID. Electron's implicit default was `electron.app.<package name>`, i.e.
 * `electron.app.system-status`. Windows keys notification settings and taskbar grouping by it, so it
 * is pinned explicitly to keep continuity now that the package name changed.
 */
export const WINDOWS_APP_USER_MODEL_ID = 'electron.app.system-status'

/** Test-only override for `<appData>` (parent of both the canonical and the legacy directory). */
export const APP_DATA_ROOT_OVERRIDE_ENV = 'NETWORK_STATUS_APP_DATA_ROOT'

export interface UserDataLayout {
  appDataRoot: string
  userDataDir: string
  databasePath: string
  legacyUserDataDir: string
  legacyDatabasePath: string
}

export function resolveUserDataLayout(
  defaultAppDataRoot: string,
  env: Record<string, string | undefined> = process.env
): UserDataLayout {
  const override = env[APP_DATA_ROOT_OVERRIDE_ENV]?.trim()
  const appDataRoot = override ? resolve(override) : defaultAppDataRoot
  const userDataDir = join(appDataRoot, USER_DATA_DIR_NAME)
  const legacyUserDataDir = join(appDataRoot, LEGACY_USER_DATA_DIR_NAME)
  return {
    appDataRoot,
    userDataDir,
    databasePath: join(userDataDir, DATABASE_FILE_NAME),
    legacyUserDataDir,
    legacyDatabasePath: join(legacyUserDataDir, LEGACY_DATABASE_FILE_NAME)
  }
}

export interface AppIdentityTarget {
  setName(name: string): void
  getPath(name: 'appData'): string
  setPath(name: 'userData', path: string): void
  setAppUserModelId(id: string): void
}

/**
 * Must run before `requestSingleInstanceLock()` and before anything reads `userData`, so every
 * component (Chromium profile, lock, database) agrees on one directory.
 */
export function applyAppIdentity(
  app: AppIdentityTarget,
  options: { env?: Record<string, string | undefined>; platform?: NodeJS.Platform } = {}
): UserDataLayout {
  app.setName(PRODUCT_NAME)
  if ((options.platform ?? process.platform) === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
  const layout = resolveUserDataLayout(app.getPath('appData'), options.env)
  app.setPath('userData', layout.userDataDir)
  return layout
}
