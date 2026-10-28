import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_DATA_ROOT_OVERRIDE_ENV,
  applyAppIdentity,
  resolveUserDataLayout,
  type AppIdentityTarget
} from '../../src/main/appIdentity'

const APPDATA = join('C:', 'Users', 'u', 'AppData', 'Roaming')

describe('resolveUserDataLayout', () => {
  it('places canonical data in network-status and legacy data in system-status under appData', () => {
    expect(resolveUserDataLayout(APPDATA, {})).toEqual({
      appDataRoot: APPDATA,
      userDataDir: join(APPDATA, 'network-status'),
      databasePath: join(APPDATA, 'network-status', 'network-status.db'),
      legacyUserDataDir: join(APPDATA, 'system-status'),
      legacyDatabasePath: join(APPDATA, 'system-status', 'system-status.db')
    })
  })

  it('honours the isolated-testing override for both locations', () => {
    const layout = resolveUserDataLayout(APPDATA, { [APP_DATA_ROOT_OVERRIDE_ENV]: '  some/test-root ' })
    const root = resolve('some/test-root')
    expect(layout.userDataDir).toBe(join(root, 'network-status'))
    expect(layout.legacyUserDataDir).toBe(join(root, 'system-status'))
  })

  it('ignores a blank override', () => {
    expect(resolveUserDataLayout(APPDATA, { [APP_DATA_ROOT_OVERRIDE_ENV]: '  ' }).appDataRoot).toBe(APPDATA)
  })
})

function recordingApp(): { app: AppIdentityTarget; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    app: {
      setName: (n) => calls.push(`setName:${n}`),
      getPath: () => APPDATA,
      setPath: (k, p) => calls.push(`setPath:${k}:${p}`),
      setAppUserModelId: (id) => calls.push(`aumid:${id}`)
    }
  }
}

describe('applyAppIdentity', () => {
  it('sets the product name, keeps the legacy Windows AUMID, and pins userData to the canonical dir', () => {
    const { app, calls } = recordingApp()
    const layout = applyAppIdentity(app, { env: {}, platform: 'win32' })
    expect(calls).toEqual([
      'setName:Network Status',
      'aumid:electron.app.system-status',
      `setPath:userData:${join(APPDATA, 'network-status')}`
    ])
    expect(layout.userDataDir).toBe(join(APPDATA, 'network-status'))
  })

  it('does not set an AUMID off Windows', () => {
    const { app, calls } = recordingApp()
    applyAppIdentity(app, { env: {}, platform: 'darwin' })
    expect(calls.some((c) => c.startsWith('aumid:'))).toBe(false)
  })
})
