import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { listDevices } from '../db/deviceRepository'
import { mutateMonitoringBulkStatus } from './equipmentMutationService'
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
 * Periodic ping + ARP scans; pushes DB updates to renderer via webContents.
 * Intervals restart when `startScheduler` is called again (e.g. after settings change).
 */
export function startScheduler(
  db: Database.Database,
  win: BrowserWindow | null,
  options?: { onDevicesUpdated?: () => void; eventLogs?: EventLogService }
): SchedulerHandles {
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let arpTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const pushDevices = (): void => {
    if (!win || win.isDestroyed()) return
    const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
    win.webContents.send(IPC.ON_DEVICES_CHANGED, listDevices(db, nid))
  }

  const pushArp = (): void => {
    if (!win || win.isDestroyed()) return
    const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
    win.webContents.send(IPC.ON_ARP_CHANGED, {
      entries: listArpEntries(db, nid),
      discovered: listDiscoveredDevices(db, nid)
    })
  }

  let lastPingErrorAt = 0
  let lastArpErrorAt = 0

  const runPing = async (): Promise<void> => {
    if (stopped) return
    try {
      const settings = getSettings(db)
      if (settings.listenAdapterNames.length === 0) {
        // User selected no adapters: treat monitoring as disabled and force UI to show offline.
        // Do not emit offline notifications in this state.
        mutateMonitoringBulkStatus(
          db,
          'offline',
          new Date().toISOString(),
          getLastNetworkContext()?.networkId ?? getStableNetworkId()
        )
        pushDevices()
        options?.onDevicesUpdated?.()
        return
      }
      const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
      const devices = filterDevicesBySelectedAdapters(listDevices(db, nid), settings.listenAdapterNames)
      if (!devices.length) return
      const results = await pingAllDevices(db, devices)
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
      // Avoid spamming: only surface ping loop failures at most once per minute.
      const now = Date.now()
      if (now - lastPingErrorAt > 60_000) lastPingErrorAt = now
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
      const nid = getLastNetworkContext()?.networkId ?? getStableNetworkId()
      const discovered = listDiscoveredDevices(db, nid)
      notifyNewUnknownDevices(
        settings,
        discovered.map((d) => d.ip)
      )
      onDiscoveryScanComplete(db, discovered, nid, options?.eventLogs)
      pushArp()
    } catch (e) {
      const now = Date.now()
      if (now - lastArpErrorAt > 60_000) lastArpErrorAt = now
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
