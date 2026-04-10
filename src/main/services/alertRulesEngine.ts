/**
 * User-defined alert rules: event-driven evaluation, per-rule cooldown, network scoping.
 * New condition types: add to AlertConditionType + branch in the switch below.
 */

import type Database from 'better-sqlite3'
import { getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import type {
  AlertRule,
  AlertRuleConditionConfig,
  ArpEntry,
  Device,
  EventType
} from '@shared/types'
import {
  listEnabledAlertRulesForContext,
  updateAlertRuleLastTriggered
} from '../db/alertRuleRepository'
import { getDeviceByIp } from '../db/deviceRepository'
import { showDesktopAlert } from './notificationService'
import type { EventLogService } from './eventLogService'
import { EVENT_LOG_NETWORK_UNKNOWN } from '@shared/eventLog'

/** First ARP snapshot seeds baseline without firing “new device” rules (mirrors legacy discovery notify). */
let discoverySeenIps = new Set<string>()
let discoveryPrimed = false

export function resetAlertDiscoveryBaseline(): void {
  discoverySeenIps.clear()
  discoveryPrimed = false
}

/** Cooldown: skip if last_triggered is within cooldownSeconds (0 = always allow). */
function passesCooldown(rule: AlertRule, nowMs: number): boolean {
  if (rule.cooldownSeconds <= 0) return true
  if (!rule.lastTriggered) return true
  const last = new Date(rule.lastTriggered).getTime()
  return nowMs - last >= rule.cooldownSeconds * 1000
}

function matchDeviceScope(cfg: AlertRuleConditionConfig, device: Device): boolean {
  const scope = cfg.scope ?? 'all'
  if (scope === 'all') return true
  if (scope === 'device') {
    if (cfg.deviceId?.trim() && device.id === cfg.deviceId.trim()) return true
    if (cfg.deviceIp?.trim() && device.ip.trim() === cfg.deviceIp.trim()) return true
    return false
  }
  if (scope === 'group') {
    const k = cfg.groupKind
    const raw = (cfg.groupValue ?? '').trim()
    if (!k || !raw) return true
    const v = raw.toLowerCase()
    if (k === 'vendor') return (device.vendor ?? '').toLowerCase().includes(v)
    if (k === 'deviceType')
      return getDeviceTypeDisplayLabel(device).toLowerCase() === raw.toLowerCase()
    if (k === 'ipPrefix') return device.ip.startsWith(raw)
  }
  return false
}

/**
 * Single "fire" point for alert rules.
 *
 * IMPORTANT: We log ALERT_TRIGGERED here (and only here) so we only record alerts that actually fired
 * after all checks passed (enabled/cooldown/scope/network matching). This avoids duplicates and avoids
 * logging evaluation attempts.
 */
function fireRule(
  db: Database.Database,
  rule: AlertRule,
  title: string,
  body: string,
  contextNetworkId: string | null,
  eventLogs?: EventLogService,
  trigger?: {
    triggeringEventType?: EventType
    device?: Device | null
    arp?: ArpEntry | null
    macChange?: { oldMac: string; newMac: string } | null
  }
): void {
  const iso = new Date().toISOString()
  updateAlertRuleLastTriggered(db, rule.id, iso)
  rule.lastTriggered = iso

  // Fire-time log (non-blocking; EventLogService internally defers work).
  if (eventLogs) {
    const nid = contextNetworkId ?? EVENT_LOG_NETWORK_UNKNOWN
    const device = trigger?.device ?? null
    const arp = trigger?.arp ?? null
    eventLogs.log({
      eventType: 'ALERT_TRIGGERED' as EventType,
      networkId: nid,
      deviceId: device?.id?.trim() ? device.id : null,
      ipAddress: device?.ip ?? arp?.ip ?? null,
      macAddress: device?.macAddress ?? arp?.macAddress ?? null,
      message: `Alert triggered: ${rule.name}`,
      ruleSeverityOverride: rule.eventLogSeverity,
      metadata: {
        networkContextUnavailable: contextNetworkId == null,
        ruleId: rule.id,
        ruleName: rule.name,
        conditionType: rule.conditionType,
        cooldownSeconds: rule.cooldownSeconds,
        triggeringEventType: trigger?.triggeringEventType ?? null,
        deviceId: device?.id ?? null,
        ipAddress: device?.ip ?? arp?.ip ?? null,
        macAddress: device?.macAddress ?? arp?.macAddress ?? null,
        scope: rule.conditionConfig?.scope ?? null,
        scopeConfig: rule.conditionConfig ?? {},
        macChange: trigger?.macChange ?? null,
        notification: { title, body }
      }
    })
  }

  setImmediate(() => {
    try {
      showDesktopAlert(title, body)
    } catch {
      /* Notification failures must not break monitoring */
    }
  })
}

export interface PingTransitionItem {
  device: Device
  offlineTransition: boolean
  onlineTransition: boolean
}

/** After a ping round: evaluate device_offline / device_online rules (non-blocking). */
export function onPingTransitions(
  db: Database.Database,
  items: PingTransitionItem[],
  contextNetworkId: string | null,
  eventLogs?: EventLogService
): void {
  if (items.length === 0) return
  setImmediate(() => {
    const rules = listEnabledAlertRulesForContext(db, contextNetworkId)
    const now = Date.now()
    for (const item of items) {
      const { device, offlineTransition, onlineTransition } = item
      if (offlineTransition) {
        for (const rule of rules) {
          if (rule.conditionType !== 'device_offline') continue
          if (!passesCooldown(rule, now)) continue
          if (!matchDeviceScope(rule.conditionConfig, device)) continue
          fireRule(
            db,
            rule,
            'Device offline',
            `${device.name} (${device.ip}) is no longer reachable.`,
            contextNetworkId,
            eventLogs,
            { triggeringEventType: 'DEVICE_OFFLINE', device }
          )
        }
      }
      if (onlineTransition) {
        for (const rule of rules) {
          if (rule.conditionType !== 'device_online') continue
          if (!passesCooldown(rule, now)) continue
          if (!matchDeviceScope(rule.conditionConfig, device)) continue
          fireRule(
            db,
            rule,
            'Device online',
            `${device.name} (${device.ip}) is reachable again.`,
            contextNetworkId,
            eventLogs,
            { triggeringEventType: 'DEVICE_ONLINE', device }
          )
        }
      }
    }
  })
}

/** Pseudo-device for ARP-only hosts (new discovery / MAC change when not saved). */
function deviceFromArp(ip: string, vendor: string | null, mac: string): Device {
  return {
    id: '',
    name: ip,
    ip,
    subnet: '',
    gateway: '',
    macAddress: mac,
    vendor,
    deviceType: 'Unknown',
    deviceTypeCustom: null,
    lastStatus: 'unknown',
    lastChecked: null,
    groupId: null,
    groupName: null
  }
}

/** After ARP merge: new unknown IPs vs baseline. */
export function onDiscoveryScanComplete(
  db: Database.Database,
  discovered: ArpEntry[],
  contextNetworkId: string | null,
  eventLogs?: EventLogService
): void {
  setImmediate(() => {
    const rules = listEnabledAlertRulesForContext(db, contextNetworkId).filter(
      (r) => r.conditionType === 'new_device_discovered'
    )

    if (!discoveryPrimed) {
      for (const e of discovered) discoverySeenIps.add(e.ip)
      discoveryPrimed = true
      return
    }

    const now = Date.now()
    for (const e of discovered) {
      if (discoverySeenIps.has(e.ip)) continue
      discoverySeenIps.add(e.ip)

      if (rules.length === 0) continue

      const pseudo = deviceFromArp(e.ip, e.vendor, e.macAddress)
      const vendorLabel = e.vendor?.trim() || 'Unknown vendor'
      for (const rule of rules) {
        if (!passesCooldown(rule, now)) continue
        if (!matchDeviceScope(rule.conditionConfig, pseudo)) continue
        fireRule(
          db,
          rule,
          'New device detected',
          `New host ${e.ip} (${vendorLabel}) appeared in the ARP cache.`,
          contextNetworkId,
          eventLogs,
          { triggeringEventType: 'DEVICE_DISCOVERED', arp: e }
        )
      }
    }
  })
}

/** Fired from ARP upsert after MAC change is confirmed (2 observations). */
export function onMacAddressChangeConfirmed(
  db: Database.Database,
  ev: { ip: string; oldMac: string; newMac: string; vendor: string | null },
  contextNetworkId: string | null,
  eventLogs?: EventLogService
): void {
  setImmediate(() => {
    const rules = listEnabledAlertRulesForContext(db, contextNetworkId).filter(
      (r) => r.conditionType === 'mac_address_change'
    )
    if (rules.length === 0) return

    const saved = getDeviceByIp(db, ev.ip)
    const device = saved ?? deviceFromArp(ev.ip, ev.vendor, ev.newMac)
    const now = Date.now()
    const name = saved?.name ?? ev.ip

    for (const rule of rules) {
      if (!passesCooldown(rule, now)) continue
      if (!matchDeviceScope(rule.conditionConfig, device)) continue
      fireRule(
        db,
        rule,
        'MAC address changed',
        `${name} (${ev.ip}): MAC ${ev.oldMac} → ${ev.newMac}`,
        contextNetworkId,
        eventLogs,
        { triggeringEventType: 'MAC_ADDRESS_CHANGED', device, macChange: { oldMac: ev.oldMac, newMac: ev.newMac } }
      )
    }
  })
}
