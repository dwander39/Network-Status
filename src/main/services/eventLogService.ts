import type Database from 'better-sqlite3'
import type {
  EventLog,
  EventLogSeverityOverrides,
  EventSeverity,
  EventType,
  LogEventInput
} from '@shared/types'
import { insertEventLog, pruneEventLogsToMax } from '../db/eventLogRepository'
import { getLastNetworkContext } from './networkDetection'
import { EVENT_LOG_NETWORK_UNKNOWN } from '@shared/eventLog'

/**
 * Event Log fallback scope used when an event occurs before a reliable `networkId` is available.
 *
 * Guardrails:
 * - This value is **only** for Event Log scoping when network context is unavailable.
 * - It must never be treated as a real/saved network profile id, map layout scope, or settings target.
 * - SSID is never used as a substitute identity key.
 */
/**
 * Central event logger.
 *
 * - Uses `networkId` as the source of truth for scoping.
 * - Accepts SSID as optional contextual metadata only.
 * - Uses setImmediate so ping/ARP flows don't block on log writes.
 */
export class EventLogService {
  private db: Database.Database
  private emit?: (ev: EventLog) => void
  private pruneScheduled = false
  private lastErrorByKey = new Map<string, number>()
  /** Global event-type overrides (from settings); applied after rule override for ALERT_TRIGGERED. */
  private eventTypeSeverityOverrides: EventLogSeverityOverrides = {}

  constructor(db: Database.Database, emit?: (ev: EventLog) => void) {
    this.db = db
    this.emit = emit
  }

  /** Replace global event-type severity overrides (call on startup and after settings save). */
  setEventSeverityOverrides(overrides: EventLogSeverityOverrides): void {
    this.eventTypeSeverityOverrides = { ...overrides }
  }

  log(input: Omit<LogEventInput, 'message'> & { message?: string }): void {
    // `networkId` remains the preferred source of truth. If it is genuinely unavailable at fire time,
    // we log explicitly under a sentinel so the event isn't silently dropped.
    const networkIdRaw = String(input.networkId ?? '').trim()
    const networkId = networkIdRaw || EVENT_LOG_NETWORK_UNKNOWN

    setImmediate(() => {
      try {
        const ctx = getLastNetworkContext()
        const ssid = input.ssid ?? ctx?.wifiSsid ?? null
        const severity = this.resolveSeverity(
          input.eventType,
          input.ruleSeverityOverride ?? null
        )
        const message = this.buildMessage(input.eventType, {
          message: input.message,
          ip: input.ipAddress ?? null
        })
        const ev = insertEventLog(this.db, {
          ...input,
          networkId,
          ssid,
          severity,
          message
        })
        this.emit?.(ev)
        this.schedulePrune()
      } catch {
        // Logging must never break monitoring.
      }
    })
  }

  /**
   * Throttled SYSTEM_ERROR helper to avoid spamming recurring poll failures.
   * Callers provide a stable `key` representing the failure boundary.
   */
  logSystemErrorThrottled(input: {
    key: string
    module: string
    operation: string
    error: unknown
    networkId?: string | null
    ipAddress?: string | null
    macAddress?: string | null
    deviceId?: string | null
    metadata?: Record<string, unknown>
    throttleMs?: number
  }): void {
    const now = Date.now()
    const throttleMs = Math.max(5_000, Number(input.throttleMs ?? 60_000))
    const last = this.lastErrorByKey.get(input.key) ?? 0
    if (now - last < throttleMs) return
    this.lastErrorByKey.set(input.key, now)

    const err = input.error instanceof Error ? input.error : new Error(String(input.error))
    const ctx = getLastNetworkContext()
    this.log({
      eventType: 'SYSTEM_ERROR' as EventType,
      networkId: input.networkId ?? ctx?.networkId ?? EVENT_LOG_NETWORK_UNKNOWN,
      ssid: ctx?.wifiSsid ?? null,
      deviceId: input.deviceId ?? null,
      ipAddress: input.ipAddress ?? null,
      macAddress: input.macAddress ?? null,
      message: `[${input.module}] ${input.operation} failed: ${err.message}`,
      metadata: {
        module: input.module,
        operation: input.operation,
        errorMessage: err.message,
        stack: err.stack ?? null,
        ...((input.metadata ?? {}) as Record<string, unknown>)
      }
    })
  }

  private schedulePrune(): void {
    if (this.pruneScheduled) return
    this.pruneScheduled = true
    setTimeout(() => {
      this.pruneScheduled = false
      try {
        pruneEventLogsToMax(this.db, 5000)
      } catch {
        /* ignore */
      }
    }, 15_000)
  }

  private buildMessage(type: EventType, ctx: { message?: string; ip: string | null }): string {
    if (ctx.message?.trim()) return ctx.message.trim()
    if (type === 'DEVICE_ONLINE') return ctx.ip ? `Device ${ctx.ip} is online.` : 'Device is online.'
    if (type === 'DEVICE_OFFLINE') return ctx.ip ? `Device ${ctx.ip} is offline.` : 'Device is offline.'
    if (type === 'DEVICE_DISCOVERED') return ctx.ip ? `Discovered new host ${ctx.ip}.` : 'Discovered a new host.'
    if (type === 'MAC_ADDRESS_CHANGED') return ctx.ip ? `MAC address changed for ${ctx.ip}.` : 'MAC address changed.'
    if (type === 'NETWORK_CHANGED') return 'Network changed.'
    if (type === 'NETWORK_NEW_DETECTED') return 'New network detected.'
    if (type === 'ALERT_TRIGGERED') return 'Alert triggered.'
    return 'System error.'
  }

  /**
   * Layered severity resolution (single place; do not duplicate in callers).
   *
   * Precedence:
   * 1. Rule override — only when `eventType === ALERT_TRIGGERED` and `ruleSeverityOverride` is set.
   * 2. User global overrides — `eventType` → severity from settings (`eventLogSeverityOverrides`).
   * 3. Built-in defaults — `defaultSeverityForEventType`.
   *
   * Extensibility: new built-in types add a branch in `defaultSeverityForEventType`; optional global
   * overrides apply automatically via the map in step 2.
   */
  private resolveSeverity(
    eventType: EventType,
    ruleSeverityOverride: EventSeverity | null
  ): EventSeverity {
    if (eventType === 'ALERT_TRIGGERED' && ruleSeverityOverride != null) {
      return ruleSeverityOverride
    }
    const user = this.eventTypeSeverityOverrides[eventType]
    if (user) return user
    return this.defaultSeverityForEventType(eventType)
  }

  /** Built-in mapping when no user override applies. */
  private defaultSeverityForEventType(type: EventType): EventSeverity {
    if (type === 'SYSTEM_ERROR') return 'critical'
    if (type === 'NETWORK_NEW_DETECTED') return 'warning'
    if (type === 'DEVICE_OFFLINE') return 'warning'
    if (type === 'MAC_ADDRESS_CHANGED') return 'warning'
    if (type === 'ALERT_TRIGGERED') return 'warning'
    return 'info'
  }
}

