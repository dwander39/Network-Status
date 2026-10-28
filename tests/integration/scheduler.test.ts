import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PingRoundResult } from '../../src/main/services/pingService'

vi.mock('../../src/main/services/pingService', () => ({ pingAllDevices: vi.fn() }))
vi.mock('../../src/main/services/arpService', () => ({ scanArpCache: vi.fn(async () => {}) }))
vi.mock('../../src/main/services/networkAdapterService', () => ({
  listNetworkAdapters: () => [
    {
      name: 'Ethernet',
      addresses: [{ address: '192.168.50.10', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
    }
  ]
}))

const { pingAllDevices } = await import('../../src/main/services/pingService')
const { startScheduler } = await import('../../src/main/services/scheduler')
const { saveSettings } = await import('../../src/main/db/settingsRepository')
const { applyUserSaveDevicePayload } = await import('../../src/main/services/equipmentMutationService')
const { createTempDb } = await import('./helpers/tempDb')

const pingMock = vi.mocked(pingAllDevices)
let t: ReturnType<typeof createTempDb>
let stop: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  t = createTempDb()
  pingMock.mockReset()
  saveSettings(t.db, { pingIntervalMs: 1000, arpIntervalMs: 60_000, listenAdapterNames: ['Ethernet'] })
  applyUserSaveDevicePayload(t.db, { name: 'In LAN', ip: '192.168.50.20', subnet: '', gateway: '' })
  applyUserSaveDevicePayload(t.db, { name: 'Other LAN', ip: '10.9.9.9', subnet: '', gateway: '' })
})

afterEach(() => {
  stop?.()
  stop = null
  vi.useRealTimers()
  t.dispose()
})

describe('startScheduler ping loop', () => {
  it('only pings devices on the selected adapters’ subnets', async () => {
    pingMock.mockResolvedValue([])
    stop = startScheduler(t.db, null).stop
    await vi.advanceTimersByTimeAsync(0)
    expect(pingMock).toHaveBeenCalledTimes(1)
    expect(pingMock.mock.calls[0]![1].map((d) => d.ip)).toEqual(['192.168.50.20'])
  })

  // Regression: rounds slower than the interval used to start a new overlapping round every tick.
  it('skips ticks while a slow round is still running, then resumes', async () => {
    let finishRound: (r: PingRoundResult[]) => void = () => {}
    pingMock.mockImplementationOnce(() => new Promise((resolve) => (finishRound = resolve)))
    pingMock.mockResolvedValue([])

    stop = startScheduler(t.db, null).stop
    await vi.advanceTimersByTimeAsync(3500)
    expect(pingMock).toHaveBeenCalledTimes(1)

    finishRound([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(pingMock).toHaveBeenCalledTimes(2)
  })

  it('treats no selected adapters as monitoring disabled and marks devices offline', async () => {
    saveSettings(t.db, { listenAdapterNames: [] })
    stop = startScheduler(t.db, null).stop
    await vi.advanceTimersByTimeAsync(0)
    expect(pingMock).not.toHaveBeenCalled()
    const statuses = t.db.prepare(`SELECT DISTINCT last_status AS s FROM devices`).all() as { s: string }[]
    expect(statuses).toEqual([{ s: 'offline' }])
  })

  it('stops scheduling after stop()', async () => {
    pingMock.mockResolvedValue([])
    const handles = startScheduler(t.db, null)
    await vi.advanceTimersByTimeAsync(0)
    handles.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(pingMock).toHaveBeenCalledTimes(1)
  })
})
