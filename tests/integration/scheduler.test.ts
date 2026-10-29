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
const { startScheduler, createSchedulerController } = await import('../../src/main/services/scheduler')
const { EventLogService } = await import('../../src/main/services/eventLogService')
const { listEventLogs } = await import('../../src/main/db/eventLogRepository')
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

  it('does not overlap a replacement scheduler with a stopped but unfinished round', async () => {
    let finishRound: (r: PingRoundResult[]) => void = () => {}
    pingMock.mockImplementationOnce(() => new Promise((resolve) => (finishRound = resolve)))
    pingMock.mockResolvedValue([])
    const first = startScheduler(t.db, null)
    first.stop()
    stop = startScheduler(t.db, null).stop
    const callsBeforeCompletion = pingMock.mock.calls.length
    finishRound([])
    await vi.advanceTimersByTimeAsync(0)
    expect(callsBeforeCompletion).toBe(1)
  })
})

describe('scheduler lifecycle across stop/restart', () => {
  const offlineResult = (): PingRoundResult => ({
    id: 'dev-1',
    name: 'In LAN',
    ip: '192.168.50.20',
    offlineTransition: true,
    onlineTransition: false
  })
  const offlineEvents = (): number => listEventLogs(t.db, { eventType: 'DEVICE_OFFLINE' }).length

  it('a stopped round is told it is cancelled and reports nothing when it settles', async () => {
    let finishRound: (r: PingRoundResult[]) => void = () => {}
    pingMock.mockImplementationOnce(() => new Promise((resolve) => (finishRound = resolve)))
    const onDevicesUpdated = vi.fn()
    const first = startScheduler(t.db, null, { eventLogs: new EventLogService(t.db), onDevicesUpdated })
    const isCancelled = pingMock.mock.calls[0]![2]!
    expect(isCancelled()).toBe(false)

    first.stop()
    expect(isCancelled()).toBe(true)
    finishRound([offlineResult()])
    await vi.advanceTimersByTimeAsync(0)
    await vi.runOnlyPendingTimersAsync() // would flush a (wrongly) queued EventLogService insert
    expect(offlineEvents()).toBe(0)
    expect(onDevicesUpdated).not.toHaveBeenCalled()
  })

  it('the replacement scheduler resumes on its next tick once the stopped round settles', async () => {
    let finishRound: (r: PingRoundResult[]) => void = () => {}
    pingMock.mockImplementationOnce(() => new Promise((resolve) => (finishRound = resolve)))
    pingMock.mockResolvedValue([])
    startScheduler(t.db, null).stop()
    stop = startScheduler(t.db, null).stop
    finishRound([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(pingMock).toHaveBeenCalledTimes(2)
  })

  it('a rejected round does not leave the scheduler locked', async () => {
    pingMock.mockRejectedValueOnce(new Error('probe failure'))
    pingMock.mockResolvedValue([])
    stop = startScheduler(t.db, null, { eventLogs: new EventLogService(t.db) }).stop
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(pingMock).toHaveBeenCalledTimes(2)
    expect(listEventLogs(t.db, { eventType: 'SYSTEM_ERROR' })).toHaveLength(1)
  })

  // Regression (Codex B5): the settings-save restart started a scheduler without the event logger.
  it('a settings-save restart keeps monitoring events flowing to the event log', async () => {
    pingMock.mockResolvedValue([])
    const controller = createSchedulerController(() => t.db, () => null, { eventLogs: new EventLogService(t.db) })
    stop = controller.stop
    controller.restart() // startup
    await vi.advanceTimersByTimeAsync(0)

    // What the SAVE_SETTINGS handler does: persist, then restart through the controller.
    saveSettings(t.db, { pingIntervalMs: 2000 })
    controller.restart()
    pingMock.mockResolvedValue([offlineResult()])
    const callsAfterRestart = pingMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000) // the old 1 s interval must be gone
    expect(pingMock.mock.calls.length).toBe(callsAfterRestart)
    await vi.advanceTimersByTimeAsync(1000) // new 2 s interval fires
    expect(pingMock.mock.calls.length).toBe(callsAfterRestart + 1)

    await vi.runOnlyPendingTimersAsync() // EventLogService inserts on setImmediate
    expect(offlineEvents()).toBeGreaterThanOrEqual(1)
  })
})
