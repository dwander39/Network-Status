import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { getSettings, saveSettings } from '../../src/main/db/settingsRepository'
import { applyUserSaveDevicePayload } from '../../src/main/services/equipmentMutationService'
import { listDevices } from '../../src/main/db/deviceRepository'
import { createTempDb, type TempDb } from './helpers/tempDb'

let t: TempDb

beforeEach(() => {
  t = createTempDb()
})

afterEach(() => {
  t.dispose()
})

function tableNames(): string[] {
  return (
    t.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]
  ).map((r) => r.name)
}

describe('openDatabaseAtPath', () => {
  it('creates the full schema on a fresh file', () => {
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        'devices',
        'arp_entries',
        'settings',
        'dismissed_discovered_ips',
        'device_groups',
        'network_profiles',
        'alert_rules',
        'event_logs',
        'arp_mac_changes',
        'arp_mac_change_candidates'
      ])
    )
    expect(t.db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(t.db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('seeds default settings on first run', () => {
    expect(getSettings(t.db)).toEqual(DEFAULT_SETTINGS)
  })

  it('is idempotent on reopen and preserves existing data', () => {
    const before = tableNames()
    applyUserSaveDevicePayload(t.db, { name: 'Core switch', ip: '10.0.0.2', subnet: '', gateway: '' })
    saveSettings(t.db, { pingIntervalMs: 9000 })

    t.reopen()

    expect(tableNames()).toEqual(before)
    expect(listDevices(t.db, null).map((d) => d.name)).toEqual(['Core switch'])
    expect(getSettings(t.db).pingIntervalMs).toBe(9000)
  })
})

describe('settingsRepository', () => {
  it('round-trips every field', () => {
    const next = saveSettings(t.db, {
      pingIntervalMs: 7000,
      arpIntervalMs: 60000,
      notifyOnOffline: false,
      notifyOnNewDevice: false,
      listenAdapterNames: ['Ethernet', 'Wi-Fi'],
      arpTcpTouch: true,
      arpCacheMode: 'app_owned',
      arpEntryTtlMs: 120000,
      arpSubnetSweep: true,
      eventLogSeverityOverrides: { DEVICE_OFFLINE: 'critical' }
    })
    expect(getSettings(t.db)).toEqual(next)
  })

  it('treats a partial save as a merge', () => {
    saveSettings(t.db, { listenAdapterNames: ['Ethernet'] })
    saveSettings(t.db, { notifyOnOffline: false })
    const s = getSettings(t.db)
    expect(s.listenAdapterNames).toEqual(['Ethernet'])
    expect(s.notifyOnOffline).toBe(false)
  })

  it('clamps too-small intervals and tolerates corrupt stored values', () => {
    const put = t.db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
    put.run('pingIntervalMs', '10')
    put.run('arpIntervalMs', 'abc')
    put.run('listenAdapterNames', '{not json')
    put.run('eventLogSeverityOverrides', '{"DEVICE_OFFLINE":"loud","NOT_A_TYPE":"info","DEVICE_ONLINE":"warning"}')
    const s = getSettings(t.db)
    expect(s.pingIntervalMs).toBe(1000)
    expect(s.arpIntervalMs).toBe(DEFAULT_SETTINGS.arpIntervalMs)
    expect(s.listenAdapterNames).toEqual([])
    expect(s.eventLogSeverityOverrides).toEqual({ DEVICE_ONLINE: 'warning' })
  })
})
