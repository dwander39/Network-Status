import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDeviceById, listDevices } from '../../src/main/db/deviceRepository'
import { saveDeviceGroup } from '../../src/main/db/groupRepository'
import {
  applyDiscoveryUpdate,
  applyUserSaveDevicePayload,
  deleteDevice,
  mutateDeviceFromSavePayload,
  updateDeviceStatus
} from '../../src/main/services/equipmentMutationService'
import { createTempDb, type TempDb } from './helpers/tempDb'

let t: TempDb

beforeEach(() => {
  t = createTempDb()
})

afterEach(() => {
  t.dispose()
})

const base = { subnet: '255.255.255.0', gateway: '192.168.1.1' }

describe('user device saves', () => {
  it('creates a device with trimmed fields and default status', () => {
    const d = applyUserSaveDevicePayload(t.db, { ...base, name: '  NAS  ', ip: ' 192.168.1.20 ' })
    expect(d).toMatchObject({
      name: 'NAS',
      ip: '192.168.1.20',
      lastStatus: 'unknown',
      deviceType: 'Unknown',
      macAddress: null
    })
    expect(getDeviceById(t.db, d.id)).toMatchObject({ name: 'NAS' })
  })

  it('updates an existing device in place', () => {
    const d = applyUserSaveDevicePayload(t.db, { ...base, name: 'NAS', ip: '192.168.1.20' })
    const u = applyUserSaveDevicePayload(t.db, { ...base, id: d.id, name: 'Backup NAS', ip: '192.168.1.21' })
    expect(u.id).toBe(d.id)
    expect(listDevices(t.db, null).map((x) => [x.name, x.ip])).toEqual([['Backup NAS', '192.168.1.21']])
  })

  it('rejects invalid fields without writing', () => {
    const r = mutateDeviceFromSavePayload(t.db, { name: '', ip: 'nope', subnet: '', gateway: '' })
    expect(r.success).toBe(false)
    expect(r.rejectedPatches.map((p) => p.fieldKey)).toEqual(['name', 'ip'])
    expect(listDevices(t.db, null)).toEqual([])
  })

  it('enforces IP uniqueness on create and update', () => {
    applyUserSaveDevicePayload(t.db, { ...base, name: 'A', ip: '192.168.1.30' })
    const b = applyUserSaveDevicePayload(t.db, { ...base, name: 'B', ip: '192.168.1.31' })
    expect(() => applyUserSaveDevicePayload(t.db, { ...base, name: 'C', ip: '192.168.1.30' })).toThrow(
      'A device with this IP already exists'
    )
    expect(() => applyUserSaveDevicePayload(t.db, { ...base, id: b.id, name: 'B', ip: '192.168.1.30' })).toThrow(
      'Another device already uses this IP'
    )
  })

  it('rejects updates to unknown ids and unknown groups', () => {
    expect(() => applyUserSaveDevicePayload(t.db, { ...base, id: 'missing', name: 'X', ip: '192.168.1.40' })).toThrow(
      'Device not found'
    )
    const r = mutateDeviceFromSavePayload(t.db, { ...base, name: 'X', ip: '192.168.1.40', groupId: 'no-such-group' })
    expect(r.success).toBe(false)
  })

  it('assigns and clears a list group (omitted groupId leaves it unchanged)', () => {
    const g = saveDeviceGroup(t.db, { name: 'Lighting' })
    const d = applyUserSaveDevicePayload(t.db, { ...base, name: 'Dimmer', ip: '192.168.1.50', groupId: g.id })
    expect(d.groupName).toBe('Lighting')
    const kept = applyUserSaveDevicePayload(t.db, { ...base, id: d.id, name: 'Dimmer 2', ip: '192.168.1.50' })
    expect(kept.groupId).toBe(g.id)
    const cleared = applyUserSaveDevicePayload(t.db, { ...base, id: d.id, name: 'Dimmer 2', ip: '192.168.1.50', groupId: null })
    expect(cleared.groupId).toBeNull()
  })

  it('deletes a device', async () => {
    const d = applyUserSaveDevicePayload(t.db, { ...base, name: 'Temp', ip: '192.168.1.60' })
    await deleteDevice(t.db, d.id, { source: 'user' })
    expect(getDeviceById(t.db, d.id)).toBeNull()
  })
})

describe('monitoring and discovery writes', () => {
  it('monitoring updates only status and last_checked', () => {
    const d = applyUserSaveDevicePayload(t.db, { ...base, name: 'Printer', ip: '192.168.1.70' })
    const ts = Date.parse('2026-01-02T03:04:05.000Z')
    const r = updateDeviceStatus(t.db, d.id, 'online', { source: 'monitoring', timestamp: ts })
    expect(r.success).toBe(true)
    expect(getDeviceById(t.db, d.id)).toMatchObject({
      name: 'Printer',
      lastStatus: 'online',
      lastChecked: '2026-01-02T03:04:05.000Z'
    })
  })

  it('monitoring refuses invalid statuses and missing devices', () => {
    const d = applyUserSaveDevicePayload(t.db, { ...base, name: 'Printer', ip: '192.168.1.70' })
    expect(updateDeviceStatus(t.db, d.id, 'exploded' as never, { source: 'monitoring' }).success).toBe(false)
    expect(updateDeviceStatus(t.db, 'missing', 'online', { source: 'monitoring' }).success).toBe(false)
  })

  it('discovery writes MAC/vendor onto the saved device with the same IP and ignores unknown IPs', () => {
    const d = applyUserSaveDevicePayload(t.db, { ...base, name: 'Camera', ip: '192.168.1.80' })
    const updated = applyDiscoveryUpdate(
      t.db,
      { lookupIp: '192.168.1.80' },
      { normalizedMac: 'aa:bb:cc:00:11:22', arpVendor: 'Acme' },
      { source: 'discovery' }
    )
    expect(updated).toMatchObject({ id: d.id, name: 'Camera', macAddress: 'aa:bb:cc:00:11:22', vendor: 'Acme' })
    expect(
      applyDiscoveryUpdate(
        t.db,
        { lookupIp: '192.168.1.99' },
        { normalizedMac: 'aa:bb:cc:00:11:23', arpVendor: null },
        { source: 'discovery' }
      )
    ).toBeNull()
  })
})

describe('listDevices network scoping', () => {
  it('returns rows for the requested network plus legacy untagged rows', () => {
    const tagged = applyUserSaveDevicePayload(t.db, { ...base, name: 'B tagged', ip: '192.168.1.90' })
    const other = applyUserSaveDevicePayload(t.db, { ...base, name: 'C other', ip: '192.168.1.91' })
    applyUserSaveDevicePayload(t.db, { ...base, name: 'A legacy', ip: '192.168.1.92' })
    const tag = t.db.prepare(`UPDATE devices SET network_id = ? WHERE id = ?`)
    tag.run('192.168.1.1|192.168.1.0/24', tagged.id)
    tag.run('10.0.0.1|10.0.0.0/24', other.id)

    expect(listDevices(t.db, '192.168.1.1|192.168.1.0/24').map((d) => d.name)).toEqual(['A legacy', 'B tagged'])
    expect(listDevices(t.db, null).map((d) => d.name)).toEqual(['A legacy', 'B tagged', 'C other'])
  })
})
