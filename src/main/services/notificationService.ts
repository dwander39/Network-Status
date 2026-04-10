import { Notification } from 'electron'
import type { AppSettings } from '@shared/types'
import type { PingRoundResult } from './pingService'

/**
 * Native OS notifications from the main process.
 * Deduping: offline alerts fire only on ONLINE→OFFLINE; unknown-device alerts once per IP per session.
 */

const notifiedUnknownIps = new Set<string>()
let discoveryPrimed = false

export function notifyDeviceOffline(
  settings: AppSettings,
  r: PingRoundResult
): void {
  if (!settings.notifyOnOffline || !r.offlineTransition) return
  if (!Notification.isSupported()) return
  new Notification({
    title: 'Device offline',
    body: `${r.name} (${r.ip}) is no longer reachable.`
  }).show()
}

/**
 * Call after ARP merge with the current set of discovered (unknown) IPs.
 * First call establishes baseline without spamming on startup.
 */
/** Desktop toast for custom alert rules (independent of legacy settings toggles). */
export function showDesktopAlert(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body }).show()
}

export function notifyNewUnknownDevices(
  settings: AppSettings,
  unknownIps: string[]
): void {
  if (!settings.notifyOnNewDevice || !Notification.isSupported()) return

  if (!discoveryPrimed) {
    for (const ip of unknownIps) notifiedUnknownIps.add(ip)
    discoveryPrimed = true
    return
  }

  for (const ip of unknownIps) {
    if (notifiedUnknownIps.has(ip)) continue
    notifiedUnknownIps.add(ip)
    new Notification({
      title: 'New device on network',
      body: `Unknown host ${ip} appeared in the ARP cache.`
    }).show()
  }
}
