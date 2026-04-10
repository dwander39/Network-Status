import type Database from 'better-sqlite3'
import type {
  ArpCacheMode,
  AppSettings,
  EventLogSeverityOverrides,
  EventSeverity,
  EventType
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

const EVENT_TYPES = new Set<EventType>([
  'DEVICE_ONLINE',
  'DEVICE_OFFLINE',
  'DEVICE_DISCOVERED',
  'MAC_ADDRESS_CHANGED',
  'NETWORK_CHANGED',
  'NETWORK_NEW_DETECTED',
  'ALERT_TRIGGERED',
  'SYSTEM_ERROR'
])

const SEVERITIES = new Set<EventSeverity>(['info', 'warning', 'critical'])

function parseEventLogSeverityOverrides(s: string | undefined): EventLogSeverityOverrides {
  if (!s?.trim()) return {}
  try {
    const raw = JSON.parse(s) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: EventLogSeverityOverrides = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!EVENT_TYPES.has(k as EventType)) continue
      if (typeof v !== 'string' || !SEVERITIES.has(v as EventSeverity)) continue
      out[k as EventType] = v as EventSeverity
    }
    return out
  } catch {
    return {}
  }
}

function parseBool(s: string | undefined, fallback: boolean): boolean {
  if (s === undefined) return fallback
  return s === '1' || s === 'true'
}

function parseStringArrayJson(s: string | undefined, fallback: string[]): string[] {
  if (!s) return fallback
  try {
    const x = JSON.parse(s) as unknown
    if (!Array.isArray(x)) return fallback
    return x.map((v) => String(v)).filter(Boolean)
  } catch {
    return fallback
  }
}

export function getSettings(db: Database.Database): AppSettings {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as {
    key: string
    value: string
  }[]
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const arpCacheMode: ArpCacheMode =
    map.arpCacheMode === 'app_owned' ? 'app_owned' : 'mirror_os'
  return {
    pingIntervalMs: Math.max(
      1000,
      parseInt(map.pingIntervalMs ?? '', 10) || DEFAULT_SETTINGS.pingIntervalMs
    ),
    arpIntervalMs: Math.max(
      5000,
      parseInt(map.arpIntervalMs ?? '', 10) || DEFAULT_SETTINGS.arpIntervalMs
    ),
    notifyOnOffline: parseBool(map.notifyOnOffline, DEFAULT_SETTINGS.notifyOnOffline),
    notifyOnNewDevice: parseBool(
      map.notifyOnNewDevice,
      DEFAULT_SETTINGS.notifyOnNewDevice
    ),
    listenAdapterNames: parseStringArrayJson(
      map.listenAdapterNames,
      DEFAULT_SETTINGS.listenAdapterNames
    ),
    arpTcpTouch: parseBool(map.arpTcpTouch, DEFAULT_SETTINGS.arpTcpTouch),
    arpCacheMode,
    arpEntryTtlMs: Math.max(
      60_000,
      parseInt(map.arpEntryTtlMs ?? '', 10) || DEFAULT_SETTINGS.arpEntryTtlMs
    ),
    arpSubnetSweep: parseBool(map.arpSubnetSweep, DEFAULT_SETTINGS.arpSubnetSweep),
    eventLogSeverityOverrides: parseEventLogSeverityOverrides(map.eventLogSeverityOverrides)
  }
}

export function saveSettings(db: Database.Database, s: Partial<AppSettings>): AppSettings {
  const current = getSettings(db)
  const next: AppSettings = {
    pingIntervalMs: s.pingIntervalMs ?? current.pingIntervalMs,
    arpIntervalMs: s.arpIntervalMs ?? current.arpIntervalMs,
    notifyOnOffline: s.notifyOnOffline ?? current.notifyOnOffline,
    notifyOnNewDevice: s.notifyOnNewDevice ?? current.notifyOnNewDevice,
    listenAdapterNames: s.listenAdapterNames ?? current.listenAdapterNames,
    arpTcpTouch: s.arpTcpTouch ?? current.arpTcpTouch,
    arpCacheMode: s.arpCacheMode ?? current.arpCacheMode,
    arpEntryTtlMs: s.arpEntryTtlMs ?? current.arpEntryTtlMs,
    arpSubnetSweep: s.arpSubnetSweep ?? current.arpSubnetSweep,
    eventLogSeverityOverrides: s.eventLogSeverityOverrides ?? current.eventLogSeverityOverrides
  }

  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  upsert.run('pingIntervalMs', String(next.pingIntervalMs))
  upsert.run('arpIntervalMs', String(next.arpIntervalMs))
  upsert.run('notifyOnOffline', next.notifyOnOffline ? '1' : '0')
  upsert.run('notifyOnNewDevice', next.notifyOnNewDevice ? '1' : '0')
  upsert.run('listenAdapterNames', JSON.stringify(next.listenAdapterNames))
  upsert.run('arpTcpTouch', next.arpTcpTouch ? '1' : '0')
  upsert.run('arpCacheMode', next.arpCacheMode)
  upsert.run('arpEntryTtlMs', String(next.arpEntryTtlMs))
  upsert.run('arpSubnetSweep', next.arpSubnetSweep ? '1' : '0')
  upsert.run('eventLogSeverityOverrides', JSON.stringify(next.eventLogSeverityOverrides))
  return next
}
