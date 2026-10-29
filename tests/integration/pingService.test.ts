import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Controlled stand-in for the OS `ping` binary: each probe waits until the test answers it.
const pending: ((alive: boolean) => void)[] = []
vi.mock('ping', () => ({
  default: { sys: { probe: (_ip: string, cb: (alive: boolean) => void) => pending.push(cb) } }
}))

const { pingAllDevices } = await import('../../src/main/services/pingService')
const { applyUserSaveDevicePayload } = await import('../../src/main/services/equipmentMutationService')
const { listDevices } = await import('../../src/main/db/deviceRepository')
const { createTempDb } = await import('./helpers/tempDb')

let t: ReturnType<typeof createTempDb>

beforeEach(() => {
  pending.length = 0
  t = createTempDb()
  applyUserSaveDevicePayload(t.db, { name: 'A', ip: '192.168.50.20', subnet: '', gateway: '' })
})

afterEach(() => {
  t.dispose()
})

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('pingAllDevices cancellation', () => {
  it('persists the probe result while not cancelled', async () => {
    const round = pingAllDevices(t.db, listDevices(t.db, null))
    await flush()
    pending.shift()!(true)
    await round
    expect(listDevices(t.db, null)[0]!.lastStatus).toBe('online')
  })

  it('writes nothing and reports no transition for a probe that finishes after cancellation', async () => {
    let cancelled = false
    const round = pingAllDevices(t.db, listDevices(t.db, null), () => cancelled)
    await flush()
    cancelled = true // scheduler stopped (settings save, network change, quit)
    pending.shift()!(false)
    const results = await round
    expect(results[0]).toMatchObject({ offlineTransition: false, onlineTransition: false })
    expect(listDevices(t.db, null)[0]!.lastStatus).toBe('unknown')
  })

  it('does not start probes once cancelled', async () => {
    const results = await pingAllDevices(t.db, listDevices(t.db, null), () => true)
    expect(pending).toHaveLength(0)
    expect(results).toHaveLength(1)
  })
})
