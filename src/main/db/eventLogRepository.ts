import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { EventLog, EventSeverity, EventType, GetEventLogsQuery, LogEventInput } from '@shared/types'
import { EVENT_LOG_NETWORK_UNKNOWN } from '@shared/eventLog'

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return {}
}

function rowToEvent(row: Record<string, unknown>): EventLog {
  return {
    id: String(row.id),
    timestamp: String(row.timestamp),
    eventType: String(row.event_type) as EventType,
    severity: (String(row.severity ?? 'info') as EventSeverity) || 'info',
    deviceId: row.device_id != null ? String(row.device_id) : null,
    ipAddress: row.ip_address != null ? String(row.ip_address) : null,
    macAddress: row.mac_address != null ? String(row.mac_address) : null,
    networkId: String(row.network_id),
    ssid: row.ssid != null ? String(row.ssid) : null,
    message: String(row.message),
    metadata: safeParse(String(row.metadata_json ?? '{}'))
  }
}

export function insertEventLog(
  db: Database.Database,
  input: LogEventInput & { severity?: EventSeverity }
): EventLog {
  const networkIdRaw = String(input.networkId ?? '').trim()
  const networkId = networkIdRaw || EVENT_LOG_NETWORK_UNKNOWN

  const id = uuidv4()
  const timestamp = input.timestamp ?? new Date().toISOString()
  const eventType = input.eventType
  const deviceId = input.deviceId ?? null
  const ipAddress = input.ipAddress ?? null
  const macAddress = input.macAddress ?? null
  const ssid = input.ssid ?? null
  const severity = input.severity ?? 'info'
  const message = String(input.message ?? '').trim()
  const metadataJson = JSON.stringify(input.metadata ?? {})

  if (!message) throw new Error('message is required for event logs')

  db.prepare(
    `INSERT INTO event_logs
      (id, timestamp, event_type, severity, device_id, ip_address, mac_address, network_id, ssid, message, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, timestamp, eventType, severity, deviceId, ipAddress, macAddress, networkId, ssid, message, metadataJson)

  const row = db
    .prepare(
      `SELECT id, timestamp, event_type, severity, device_id, ip_address, mac_address, network_id, ssid, message, metadata_json
       FROM event_logs WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return rowToEvent(row!)
}

export function listEventLogs(db: Database.Database, query: GetEventLogsQuery = {}): EventLog[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (query.networkId != null && String(query.networkId).trim() !== '') {
    where.push(`network_id = @networkId`)
    params.networkId = String(query.networkId).trim()
  }
  if (query.eventType != null && String(query.eventType).trim() !== '') {
    where.push(`event_type = @eventType`)
    params.eventType = String(query.eventType).trim()
  }
  if (query.severity != null && String(query.severity).trim() !== '') {
    where.push(`severity = @severity`)
    params.severity = String(query.severity).trim()
  }
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(query.limit ?? 500) || 500)))
  params.limit = limit

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT id, timestamp, event_type, severity, device_id, ip_address, mac_address, network_id, ssid, message, metadata_json
       FROM event_logs${clause}
       ORDER BY timestamp DESC
       LIMIT @limit`
    )
    .all(params) as Record<string, unknown>[]
  return rows.map(rowToEvent)
}

export function deleteEventLogs(
  db: Database.Database,
  query: Omit<GetEventLogsQuery, 'limit'> = {}
): number {
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (query.networkId != null && String(query.networkId).trim() !== '') {
    where.push(`network_id = @networkId`)
    params.networkId = String(query.networkId).trim()
  }
  if (query.eventType != null && String(query.eventType).trim() !== '') {
    where.push(`event_type = @eventType`)
    params.eventType = String(query.eventType).trim()
  }
  if (query.severity != null && String(query.severity).trim() !== '') {
    where.push(`severity = @severity`)
    params.severity = String(query.severity).trim()
  }

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  return db.prepare(`DELETE FROM event_logs${clause}`).run(params).changes
}

/** Retention: keep last N events globally (simple and cheap). */
export function pruneEventLogsToMax(db: Database.Database, maxRows = 5000): number {
  const max = Math.max(100, Math.floor(maxRows))
  return db
    .prepare(
      `DELETE FROM event_logs
       WHERE id NOT IN (
         SELECT id FROM event_logs ORDER BY timestamp DESC LIMIT ?
       )`
    )
    .run(max).changes
}

