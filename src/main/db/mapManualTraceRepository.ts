import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { normalizeMapManualTraceConnectionType } from '@shared/mapManualTraceConnectionType'
import type { MapManualTrace, MapManualTraceConnectionType, MapTracePoint2D } from '@shared/types'

const CONNECTION_TYPES = new Set<MapManualTraceConnectionType>(['Power', 'DMX', 'Network'])

function parsePathJson(raw: string): MapTracePoint2D[] {
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    const out: MapTracePoint2D[] = []
    for (const p of v) {
      if (p == null || typeof p !== 'object') continue
      const x = Number((p as { x?: unknown }).x)
      const y = Number((p as { y?: unknown }).y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      out.push({ x, y })
    }
    return out
  } catch {
    return []
  }
}

function rowToTrace(row: Record<string, unknown>): MapManualTrace {
  const connectionType = normalizeMapManualTraceConnectionType(String(row.connection_type))
  return {
    kind: 'manual',
    traceId: String(row.id),
    networkId: String(row.network_id),
    sourceDeviceId: String(row.source_device_id),
    destinationDeviceId: String(row.destination_device_id),
    connectionType,
    sourceSnapPointId: String(row.source_snap_point_id),
    destinationSnapPointId: String(row.destination_snap_point_id),
    path: parsePathJson(String(row.path_json ?? '[]'))
  }
}

export function listManualTracesForNetwork(db: Database.Database, networkId: string): MapManualTrace[] {
  const rows = db
    .prepare(
      `SELECT id, network_id, source_device_id, destination_device_id, connection_type,
              source_snap_point_id, destination_snap_point_id, path_json
       FROM map_manual_traces WHERE network_id = ? ORDER BY updated_at DESC`
    )
    .all(networkId) as Record<string, unknown>[]
  return rows.map(rowToTrace)
}

export function getManualTraceById(db: Database.Database, traceId: string): MapManualTrace | null {
  const row = db
    .prepare(
      `SELECT id, network_id, source_device_id, destination_device_id, connection_type,
              source_snap_point_id, destination_snap_point_id, path_json
       FROM map_manual_traces WHERE id = ?`
    )
    .get(traceId) as Record<string, unknown> | undefined
  return row ? rowToTrace(row) : null
}

export type UpsertMapManualTraceInput = Omit<MapManualTrace, 'kind' | 'traceId'> & { traceId?: string }

/** Insert or replace by unique logical key `(networkId, source, destination, connectionType)`. */
export function upsertManualTrace(db: Database.Database, input: UpsertMapManualTraceInput): MapManualTrace {
  const iso = new Date().toISOString()
  const pathJson = JSON.stringify(input.path)
  const ct = CONNECTION_TYPES.has(input.connectionType) ? input.connectionType : 'DMX'

  const existing = db
    .prepare(
      `SELECT id FROM map_manual_traces
       WHERE network_id = ? AND source_device_id = ? AND destination_device_id = ? AND connection_type = ?`
    )
    .get(input.networkId, input.sourceDeviceId, input.destinationDeviceId, ct) as { id: string } | undefined

  const traceId = existing ? input.traceId?.trim() || existing.id : input.traceId?.trim() || uuidv4()

  if (existing) {
    db.prepare(
      `UPDATE map_manual_traces SET
         id = @traceId,
         source_snap_point_id = @ssp,
         destination_snap_point_id = @dsp,
         path_json = @path,
         updated_at = @u
       WHERE network_id = @nid AND source_device_id = @src AND destination_device_id = @dst AND connection_type = @ct`
    ).run({
      traceId,
      ssp: input.sourceSnapPointId,
      dsp: input.destinationSnapPointId,
      path: pathJson,
      u: iso,
      nid: input.networkId,
      src: input.sourceDeviceId,
      dst: input.destinationDeviceId,
      ct
    })
  } else {
    db.prepare(
      `INSERT INTO map_manual_traces (
         id, network_id, source_device_id, destination_device_id, connection_type,
         source_snap_point_id, destination_snap_point_id, path_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      traceId,
      input.networkId,
      input.sourceDeviceId,
      input.destinationDeviceId,
      ct,
      input.sourceSnapPointId,
      input.destinationSnapPointId,
      pathJson,
      iso,
      iso
    )
  }

  return getManualTraceById(db, traceId)!
}

export function deleteManualTraceById(db: Database.Database, traceId: string): boolean {
  return db.prepare(`DELETE FROM map_manual_traces WHERE id = ?`).run(traceId).changes > 0
}

export function deleteManualTracesForNetwork(db: Database.Database, networkId: string): void {
  db.prepare(`DELETE FROM map_manual_traces WHERE network_id = ?`).run(networkId)
}

export function deleteAllManualTraces(db: Database.Database): void {
  db.prepare(`DELETE FROM map_manual_traces`).run()
}

/** Remove any trace that references a deleted device (either endpoint). */
export function deleteManualTracesInvolvingDevice(db: Database.Database, deviceId: string): void {
  db.prepare(
    `DELETE FROM map_manual_traces WHERE source_device_id = ? OR destination_device_id = ?`
  ).run(deviceId, deviceId)
}
