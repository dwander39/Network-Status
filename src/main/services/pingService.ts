import ping from 'ping'
import type { Device, DeviceStatus } from '@shared/types'
import type Database from 'better-sqlite3'
import { updateDeviceStatus } from './equipmentMutationService'
import net from 'net'

/**
 * ICMP reachability via the OS `ping` binary (implemented by the `ping` package).
 * Uses short timeouts; non-blocking at Node level by async probe per host.
 */
export async function probeHost(ip: string, timeoutSec = 4): Promise<boolean> {
  return new Promise((resolve) => {
    ping.sys.probe(
      ip,
      (alive: boolean | null) => {
        resolve(alive === true)
      },
      {
        timeout: timeoutSec
      }
    )
  })
}

/**
 * Lightweight TCP "touch" to help populate ARP when ICMP is blocked.
 * We consider any connect or immediate error as "touched" (traffic occurred).
 */
export async function tcpTouchHost(
  ip: string,
  ports: number[] = [80, 443],
  timeoutMs = 600
): Promise<boolean> {
  for (const port of ports) {
    const touched = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      let done = false
      const finish = (ok: boolean): void => {
        if (done) return
        done = true
        try {
          socket.destroy()
        } catch {
          // ignore
        }
        resolve(ok)
      }

      socket.setTimeout(timeoutMs)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(true))
      socket.connect(port, ip)
    })
    if (touched) return true
  }
  return false
}

const CONCURRENCY = 16

async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  const n = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

export interface PingRoundResult {
  id: string
  name: string
  ip: string
  /** True only for ONLINE → OFFLINE (notification trigger; ignores first "unknown" state). */
  offlineTransition: boolean
  /** True when returning from OFFLINE → ONLINE. */
  onlineTransition: boolean
}

/**
 * Ping all devices with bounded concurrency (efficient for 50+ hosts).
 * Persists last_status + last_checked and returns transitions for notifications.
 * Once `isCancelled()` returns true (scheduler stopped), no further probes start and no result is
 * persisted; cancelled entries report no transition. Probes already running are not killed.
 */
export async function pingAllDevices(
  db: Database.Database,
  devices: Device[],
  isCancelled: () => boolean = () => false
): Promise<PingRoundResult[]> {
  const checkedIso = new Date().toISOString()
  const checkedMs = Date.parse(checkedIso)
  const outcomes = await runPool(devices, CONCURRENCY, async (d) => {
    const unchanged = { id: d.id, name: d.name, ip: d.ip, offlineTransition: false, onlineTransition: false }
    if (isCancelled()) return unchanged
    const alive = await probeHost(d.ip)
    if (isCancelled()) return unchanged
    const current: DeviceStatus = alive ? 'online' : 'offline'
    const previous = d.lastStatus
    updateDeviceStatus(db, d.id, current, { source: 'monitoring', timestamp: checkedMs })
    const offlineTransition = previous === 'online' && current === 'offline'
    const onlineTransition = previous === 'offline' && current === 'online'
    return {
      id: d.id,
      name: d.name,
      ip: d.ip,
      offlineTransition,
      onlineTransition
    }
  })

  return outcomes
}
