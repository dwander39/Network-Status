import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { listDevices } from '../db/deviceRepository'
import { setAllDevicesStatus } from './equipmentMutationService'
import { getSettings } from '../db/settingsRepository'
import { listArpEntries, listDiscoveredDevices } from '../db/arpRepository'
import { pingAllDevices } from './pingService'
import { scanArpCache } from './arpService'
import { listNetworkAdapters } from './networkAdapterService'
import {
  notifyDeviceOffline,
  notifyNewUnknownDevices
} from './notificationService'
import { onPingTransitions, onDiscoveryScanComplete } from './alertRulesEngine'
import { IPC } from '@shared/ipc'
import { getLastNetworkContext, getStableNetworkId } from './networkDetection'
import { EventLogService } from './eventLogService'
import type { EventType } from '@shared/types'

function ipv4ToInt(ip: string): number | null {
  const p = ip.trim().split('.').map((x) => parseInt(x, 10))
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return null
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0) as number
}

function isIpInSubnet(ip: string, netAddr: string, netmask: string): boolean {
  const x = ipv4ToInt(ip)
  const a = ipv4ToInt(netAddr)
  const m = ipv4ToInt(netmask)
  if (x == null || a == null || m == null) return false
  return ((x & m) >>> 0) === ((a & m) >>> 0)
}

function filterDevicesBySelectedAdapters(
  devices: ReturnType<typeof listDevices>,
  listenAdapterNames: string[]
): ReturnType<typeof listDevices> {
  if (listenAdapterNames.length === 0) return []
  const allowed = new Set(listenAdapterNames)
  const adapters = listNetworkAdapters().filter((a) => allowed.has(a.name))
  const nets = adapters.flatMap((a) =>
    a.addresses
      .filter((x) => x.family === 'IPv4' && !x.internal)
      .map((x) => ({ address: x.address, netmask: x.netmask }))
  )
  if (nets.length === 0) return []
  return devices.filter((d) => nets.some((n) => isIpInSubnet(d.ip, n.address, n.netmask)))
}

export interface SchedulerHandles {
  stop: () => void
}

/**
 * At most one ping round runs per process, across scheduler instances. `stop()` cannot abort probes
 * that are already running, so a replacement scheduler (settings save, network change) skips its ticks
 * until the stopped instance's round has settled; the stopped round persists and reports nothing more.
 */
let activePingRound: Promise<void> | null = null

export interface SchedulerOptions {
  onDevicesUpdated?: () => void
  eventLogs?: EventLogService
  /** Hardcoded secondary surface for the Map pop-out window (no generic multi-window system). */
  getSecondaryWindow?: () => BrowserWindow | null
}

export interface SchedulerController {
  /** Stop the current scheduler (if any) and start a new one with the bound options. */
  restart: () => void
  stop: () => void
}

/**
 * Binds the scheduler options once so every restart path (startup, network change, settings save)
 * starts an identically wired scheduler — in particular, the same event logger.
 */
export function createSchedulerController(
  getDb: () => Database.Database,
  getWindow: () => BrowserWindow | null,
  options: SchedulerOptions
): SchedulerController {
  let handles: SchedulerHandles | null = null
  return {
    restart: () => {
      handles?.stop()
      handles = startScheduler(getDb(), getWindow(), options)
    },
    stop: () => {
      handles?.stop()
      handles = null
    }
  }
}

/**
 * Periodic ping + ARP scans; pushes DB updates to renderer via webContents.
 * Intervals restart when `startScheduler` is called again (e.g. after settings change).
 */
export function startScheduler(
  db: Database.Database,
  win: BrowserWindow | null,
  options?: SchedulerOptions
): SchedulerHandles {
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let arpTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const pushDevices = (): void => {
    if (!win || win.isDestroyed()) return
    const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
    win.webContents.send(IPC.ON_DEVICES_CHANGED, listDevices(db, nid))
    const w2 = options?.getSecondaryWindow?.()
    if (w2 && !w2.isDestroyed() && w2 !== win) {
      w2.webContents.send(IPC.ON_DEVICES_CHANGED, listDevices(db, nid))
    }
  }

  const pushArp = (): void => {
    if (!win || win.isDestroyed()) return
    const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
    const payload = {
      entries: listArpEntries(db, nid),
      discovered: listDiscoveredDevices(db, nid)
    }
    win.webContents.send(IPC.ON_ARP_CHANGED, payload)
    const w2 = options?.getSecondaryWindow?.()
    if (w2 && !w2.isDestroyed() && w2 !== win) {
      w2.webContents.send(IPC.ON_ARP_CHANGED, payload)
    }
  }

  // A ping round can outlast the interval (e.g. many offline hosts at the 4s probe timeout);
  // skip ticks while one is running (in this or a stopped instance) so rounds never stack up.
  const runPing = async (): Promise<void> => {
    if (stopped || activePingRound) return
    const round = pingRound()
    activePingRound = round
    try {
      await round
    } finally {
      if (activePingRound === round) activePingRound = null
    }
  }

  const pingRound = async (): Promise<void> => {
    try {
      const settings = getSettings(db)
      if (settings.listenAdapterNames.length === 0) {
        // User selected no adapters: treat monitoring as disabled and force UI to show offline.
        // Do not emit offline notifications in this state.
        setAllDevicesStatus(
          db,
          'offline',
          { source: 'monitoring' },
          getLastNetworkContext()?.networkId ?? getStableNetworkId()
        )
        pushDevices()
        options?.onDevicesUpdated?.()
        return
      }
      const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
      const devices = filterDevicesBySelectedAdapters(listDevices(db, nid), settings.listenAdapterNames)
      if (!devices.length) return
      const results = await pingAllDevices(db, devices, () => stopped)
      if (stopped) return
      for (const r of results) notifyDeviceOffline(settings, r)
      for (const r of results) {
        if (r.offlineTransition) {
          options?.eventLogs?.log({
            eventType: 'DEVICE_OFFLINE' as EventType,
            networkId: nid ?? '',
            deviceId: r.id,
            ipAddress: r.ip,
            message: `${r.name} (${r.ip}) went offline.`,
            metadata: { name: r.name }
          })
        }
        if (r.onlineTransition) {
          options?.eventLogs?.log({
            eventType: 'DEVICE_ONLINE' as EventType,
            networkId: nid ?? '',
            deviceId: r.id,
            ipAddress: r.ip,
            message: `${r.name} (${r.ip}) is online.`,
            metadata: { name: r.name }
          })
        }
      }
      onPingTransitions(
        db,
        results.map((r, i) => ({
          device: devices[i]!,
          offlineTransition: r.offlineTransition,
          onlineTransition: r.onlineTransition
        })),
        nid,
        options?.eventLogs
      )
      pushDevices()
      options?.onDevicesUpdated?.()
    } catch (e) {
      if (stopped) return
      options?.eventLogs?.logSystemErrorThrottled({
        key: 'scheduler.runPing',
        module: 'scheduler',
        operation: 'runPing',
        error: e,
        networkId: getLastNetworkContext()?.networkId ?? getStableNetworkId() ?? null
      })
    }
  }

  const runArp = async (): Promise<void> => {
    if (stopped) return
    try {
      const settings = getSettings(db)
      await scanArpCache(db, options?.eventLogs)
      if (stopped) return
      const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
      const discovered = listDiscoveredDevices(db, nid)
      notifyNewUnknownDevices(
        settings,
        discovered.map((d) => d.ip)
      )
      onDiscoveryScanComplete(db, discovered, nid, options?.eventLogs)
      pushArp()
    } catch (e) {
      if (stopped) return
      options?.eventLogs?.logSystemErrorThrottled({
        key: 'scheduler.runArp',
        module: 'scheduler',
        operation: 'runArp',
        error: e,
        networkId: getLastNetworkContext()?.networkId ?? getStableNetworkId() ?? null
      })
    }
  }

  const schedule = (): void => {
    const s = getSettings(db)
    if (pingTimer) clearInterval(pingTimer)
    if (arpTimer) clearInterval(arpTimer)
    pingTimer = setInterval(() => {
      void runPing()
    }, s.pingIntervalMs)
    arpTimer = setInterval(() => {
      void runArp()
    }, s.arpIntervalMs)
    void runPing()
    void runArp()
  }

  schedule()

  return {
    stop: () => {
      stopped = true
      if (pingTimer) clearInterval(pingTimer)
      if (arpTimer) clearInterval(arpTimer)
      pingTimer = null
      arpTimer = null
    }
  }
}
