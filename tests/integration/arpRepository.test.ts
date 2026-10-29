import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDismissedDiscovered,
  dismissDiscoveredIp,
  listArpEntries,
  listDiscoveredDevices,
  upsertArpBatch,
  type MacChangeConfirmedEvent
} from '../../src/main/db/arpRepository'
import { applyUserSaveDevicePayload } from '../../src/main/services/equipmentMutationService'
import { createTempDb, type TempDb } from './helpers/tempDb'

const NET_A = '192.168.1.1|192.168.1.0/24'
const NET_B = '10.0.0.1|10.0.0.0/24'

let t: TempDb

beforeEach(() => {
  t = createTempDb()
})

afterEach(() => {
  t.dispose()
})

const row = (ip: string, macAddress: string, vendor: string | null = null) => ({ ip, macAddress, vendor })

describe('upsertArpBatch', () => {
  it('normalizes MACs, drops malformed rows, and tags the network', () => {
    upsertArpBatch(t.db, [row('192.168.1.5', 'AA-BB-CC-DD-EE-FF'), row('192.168.1.6', 'junk')], '2026-01-01T00:00:00.000Z', {
      snapshotPrune: false,
      networkId: NET_A
    })
    expect(listArpEntries(t.db, NET_A)).toEqual([
      expect.objectContaining({ ip: '192.168.1.5', macAddress: 'aa:bb:cc:dd:ee:ff', lastSeen: '2026-01-01T00:00:00.000Z' })
    ])
  })

  it('snapshot prune removes missing rows for this network only', () => {
    const opts = (networkId: string) => ({ snapshotPrune: true, networkId })
    upsertArpBatch(t.db, [row('192.168.1.5', 'aa:aa:aa:aa:aa:01'), row('192.168.1.6', 'aa:aa:aa:aa:aa:02')], 't1', opts(NET_A))
    upsertArpBatch(t.db, [row('10.0.0.5', 'bb:bb:bb:bb:bb:01')], 't1', opts(NET_B))

    upsertArpBatch(t.db, [row('192.168.1.6', 'aa:aa:aa:aa:aa:02')], 't2', opts(NET_A))

    expect(listArpEntries(t.db, null).map((e) => e.ip)).toEqual(['10.0.0.5', '192.168.1.6'])
  })

  describe('MAC change confirmation', () => {
    const scan = (mac: string, onMacChangeConfirmed: (ev: MacChangeConfirmedEvent) => void): void =>
      upsertArpBatch(t.db, [row('192.168.1.5', mac, 'Acme')], new Date().toISOString(), {
        snapshotPrune: false,
        networkId: NET_A,
        onMacChangeConfirmed
      })
    const macChangeRows = (): number =>
      (t.db.prepare(`SELECT COUNT(*) AS c FROM arp_mac_changes`).get() as { c: number }).c

    // Regression: the first sighting overwrote arp_entries, so the candidate never reached a
    // second sighting and MAC changes (events + alert rules) could never fire.
    it('confirms once the new MAC is seen on a second scan', () => {
      const cb = vi.fn()
      scan('aa:aa:aa:aa:aa:01', cb)
      scan('aa:aa:aa:aa:aa:02', cb)
      expect(cb).not.toHaveBeenCalled()

      scan('aa:aa:aa:aa:aa:02', cb)
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith({
        ip: '192.168.1.5',
        oldMac: 'aa:aa:aa:aa:aa:01',
        newMac: 'aa:aa:aa:aa:aa:02',
        vendor: 'Acme'
      })
      expect(macChangeRows()).toBe(1)

      scan('aa:aa:aa:aa:aa:02', cb)
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('does not confirm a MAC that flaps back and forth on every scan', () => {
      const cb = vi.fn()
      for (const mac of ['01', '02', '01', '02', '01'].map((s) => `aa:aa:aa:aa:aa:${s}`)) scan(mac, cb)
      expect(cb).not.toHaveBeenCalled()
      expect(macChangeRows()).toBe(0)
    })

    it('never fires for a stable MAC', () => {
      const cb = vi.fn()
      for (let i = 0; i < 4; i++) scan('aa:aa:aa:aa:aa:01', cb)
      expect(cb).not.toHaveBeenCalled()
    })

    it('does not report a change when an unconfirmed MAC returns to the original identity', () => {
      const cb = vi.fn()
      for (const mac of ['01', '02', '01', '01'].map((s) => `aa:aa:aa:aa:aa:${s}`)) scan(mac, cb)
      expect(cb).not.toHaveBeenCalled()
      expect(macChangeRows()).toBe(0)
    })

    it('keeps the confirmed MAC/vendor and skips the discovery hook until a change is confirmed', () => {
      const onDiscoveryDeviceArpRow = vi.fn()
      const scanWith = (mac: string, vendor: string): void =>
        upsertArpBatch(t.db, [row('192.168.1.5', mac, vendor)], new Date().toISOString(), {
          snapshotPrune: false,
          networkId: NET_A,
          onDiscoveryDeviceArpRow
        })
      scanWith('aa:aa:aa:aa:aa:01', 'Acme')
      scanWith('aa:aa:aa:aa:aa:02', 'Other')
      expect(listArpEntries(t.db, NET_A)[0]).toMatchObject({ macAddress: 'aa:aa:aa:aa:aa:01', vendor: 'Acme' })
      expect(onDiscoveryDeviceArpRow).toHaveBeenCalledTimes(1)

      scanWith('aa:aa:aa:aa:aa:02', 'Other')
      expect(listArpEntries(t.db, NET_A)[0]).toMatchObject({ macAddress: 'aa:aa:aa:aa:aa:02', vendor: 'Other' })
      expect(onDiscoveryDeviceArpRow).toHaveBeenLastCalledWith(
        expect.objectContaining({ normalizedMac: 'aa:aa:aa:aa:aa:02' })
      )
    })

    it('confirms against the confirmed baseline when the candidate MAC changes (A,B,C,C → A→C)', () => {
      const cb = vi.fn()
      for (const mac of ['01', '02', '03', '03'].map((s) => `aa:aa:aa:aa:aa:${s}`)) scan(mac, cb)
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ oldMac: 'aa:aa:aa:aa:aa:01', newMac: 'aa:aa:aa:aa:aa:03' }))
      expect(macChangeRows()).toBe(1)
    })

    it('a stale candidate cannot confirm after the entry was pruned and reappears with a new baseline', () => {
      const cb = vi.fn()
      const opts = { snapshotPrune: true, networkId: NET_A, onMacChangeConfirmed: cb }
      upsertArpBatch(t.db, [row('192.168.1.5', 'aa:aa:aa:aa:aa:01')], 't1', opts)
      upsertArpBatch(t.db, [row('192.168.1.5', 'aa:aa:aa:aa:aa:02')], 't2', opts)
      upsertArpBatch(t.db, [row('192.168.1.9', 'aa:aa:aa:aa:aa:09')], 't3', opts) // .5 pruned
      upsertArpBatch(t.db, [row('192.168.1.5', 'aa:aa:aa:aa:aa:02')], 't4', opts) // new baseline, not a change
      upsertArpBatch(t.db, [row('192.168.1.5', 'aa:aa:aa:aa:aa:02')], 't5', opts)
      expect(cb).not.toHaveBeenCalled()
      expect(macChangeRows()).toBe(0)
    })
  })

  it('invokes the discovery hook for every persisted row', () => {
    const onDiscoveryDeviceArpRow = vi.fn()
    upsertArpBatch(t.db, [row('192.168.1.5', 'aa:aa:aa:aa:aa:01', 'Acme')], 't', {
      snapshotPrune: false,
      networkId: NET_A,
      onDiscoveryDeviceArpRow
    })
    expect(onDiscoveryDeviceArpRow).toHaveBeenCalledWith({
      lookupIp: '192.168.1.5',
      normalizedMac: 'aa:aa:aa:aa:aa:01',
      arpVendor: 'Acme'
    })
  })
})

describe('listDiscoveredDevices', () => {
  it('excludes saved-device IPs and dismissed IPs until dismissals are cleared', () => {
    applyUserSaveDevicePayload(t.db, { name: 'Router', ip: '192.168.1.1', subnet: '', gateway: '' })
    upsertArpBatch(
      t.db,
      [row('192.168.1.1', 'aa:aa:aa:aa:aa:01'), row('192.168.1.7', 'aa:aa:aa:aa:aa:07'), row('192.168.1.8', 'aa:aa:aa:aa:aa:08')],
      't',
      { snapshotPrune: false, networkId: NET_A }
    )
    expect(listDiscoveredDevices(t.db, NET_A).map((e) => e.ip).sort()).toEqual(['192.168.1.7', '192.168.1.8'])

    dismissDiscoveredIp(t.db, '192.168.1.8')
    expect(listDiscoveredDevices(t.db, NET_A).map((e) => e.ip)).toEqual(['192.168.1.7'])

    clearDismissedDiscovered(t.db)
    expect(listDiscoveredDevices(t.db, NET_A)).toHaveLength(2)
  })

  it('rejects dismissing an invalid IP', () => {
    expect(() => dismissDiscoveredIp(t.db, 'not-an-ip')).toThrow()
  })
})
