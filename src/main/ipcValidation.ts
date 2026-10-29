import type {
  AppSettings,
  EventLogSeverityOverrides,
  EventSeverity,
  EventType,
  PurgeDeviceCachePayload
} from '@shared/types'

/**
 * Runtime validation for IPC payloads whose handlers change persisted state or OS-facing behaviour.
 * TypeScript types do not exist at runtime, so anything from the renderer is treated as `unknown`.
 * Device saves are validated separately (shared `deviceSaveValidation`).
 */

const EVENT_TYPES: readonly EventType[] = [
  'DEVICE_ONLINE',
  'DEVICE_OFFLINE',
  'DEVICE_DISCOVERED',
  'MAC_ADDRESS_CHANGED',
  'NETWORK_CHANGED',
  'NETWORK_NEW_DETECTED',
  'ALERT_TRIGGERED',
  'SYSTEM_ERROR'
]
const SEVERITIES: readonly EventSeverity[] = ['info', 'warning', 'critical']
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000
const MAX_ADAPTERS = 64
const MAX_NAME_LENGTH = 256
const MAX_SELECTED_IDS = 10_000

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const positiveInt = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.floor(v) : undefined

/**
 * Settings patch from the renderer: unknown keys are ignored and invalid values dropped (the same
 * "invalid input is not saved" behaviour as the settings form). The repository still clamps minimums.
 */
export function sanitizeSettingsPatch(input: unknown): Partial<AppSettings> {
  if (!isRecord(input)) throw new Error('Settings update must be an object')
  const out: Partial<AppSettings> = {}

  const ping = positiveInt(input.pingIntervalMs, MAX_INTERVAL_MS)
  if (ping !== undefined) out.pingIntervalMs = ping
  const arp = positiveInt(input.arpIntervalMs, MAX_INTERVAL_MS)
  if (arp !== undefined) out.arpIntervalMs = arp
  const ttl = positiveInt(input.arpEntryTtlMs, MAX_TTL_MS)
  if (ttl !== undefined) out.arpEntryTtlMs = ttl

  for (const key of ['notifyOnOffline', 'notifyOnNewDevice', 'arpTcpTouch', 'arpSubnetSweep'] as const) {
    if (typeof input[key] === 'boolean') out[key] = input[key] as boolean
  }
  if (input.arpCacheMode === 'mirror_os' || input.arpCacheMode === 'app_owned') {
    out.arpCacheMode = input.arpCacheMode
  }
  const adapters = input.listenAdapterNames
  if (
    Array.isArray(adapters) &&
    adapters.length <= MAX_ADAPTERS &&
    adapters.every((a) => typeof a === 'string' && a.length > 0 && a.length <= MAX_NAME_LENGTH)
  ) {
    out.listenAdapterNames = [...new Set(adapters as string[])]
  }
  if (isRecord(input.eventLogSeverityOverrides)) {
    const overrides: EventLogSeverityOverrides = {}
    for (const [type, severity] of Object.entries(input.eventLogSeverityOverrides)) {
      if (EVENT_TYPES.includes(type as EventType) && SEVERITIES.includes(severity as EventSeverity)) {
        overrides[type as EventType] = severity as EventSeverity
      }
    }
    out.eventLogSeverityOverrides = overrides
  }
  return out
}

/** Purge is destructive: the scope must be exactly one of the two supported values. */
export function parsePurgeDeviceCachePayload(input: unknown): PurgeDeviceCachePayload {
  if (!isRecord(input) || (input.scope !== 'all' && input.scope !== 'current_network')) {
    throw new Error('Invalid purge request')
  }
  return { scope: input.scope, includeArp: input.includeArp === true }
}

/** Shared selection set: bounded, string ids only. */
export function sanitizeSelectedIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  if (input.length > MAX_SELECTED_IDS) throw new Error('Selection is too large')
  return input.filter((x): x is string => typeof x === 'string' && x.length <= MAX_NAME_LENGTH)
}

/** Context-menu position: finite screen coordinates and a known target kind with a string id. */
export function parseContextMenuRequest(input: unknown): {
  x: number
  y: number
  target: { kind: 'manualGroup'; id: string; contentsLocked: boolean } | { kind: 'device'; id: string }
} {
  if (!isRecord(input) || !isRecord(input.target)) throw new Error('Invalid context menu request')
  const { x, y, target } = input
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Invalid context menu position')
  }
  if (typeof target.id !== 'string' || target.id.length > MAX_NAME_LENGTH) throw new Error('Invalid context menu target')
  if (target.kind === 'manualGroup') {
    return { x, y, target: { kind: 'manualGroup', id: target.id, contentsLocked: target.contentsLocked === true } }
  }
  if (target.kind === 'device') return { x, y, target: { kind: 'device', id: target.id } }
  throw new Error('Invalid context menu target')
}
