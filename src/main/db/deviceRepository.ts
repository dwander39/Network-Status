import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  DebugEquipmentRuntimeJsonHydrationIpcResult,
  Device,
  DeviceStatus,
  DeviceType,
  EquipmentMirrorVerifyDeviceResult,
  EquipmentMirrorVerifyScanSummary
} from '@shared/types'
import {
  compareEquipmentMirrorStoredToDevice,
  resolveEquipmentRuntimeProjectionWithJsonHydrationExperiment,
  runEquipmentMirrorJsonReadExperiment,
  serializeEquipmentValuesMirrorPayload
} from '../../domain/equipment/equipmentValuesMirror'
import { lookupVendor } from '../services/vendorLookup'
import { inferDeviceType } from '../services/deviceFingerprint'
import { normalizeDeviceTypeCustom } from '@shared/deviceTypeDisplay'
import { getLastNetworkContext, getStableNetworkId } from '../services/networkDetection'
import {
  deleteAllMapLayout,
  deleteMapLayoutForNetwork,
  deleteMapLayoutRowsForNodeKey
} from './mapLayoutRepository'

/** Include mirror column only in dev — avoids shipping large JSON over IPC in production. */
const INCLUDE_DEV_EQUIPMENT_MIRROR_JSON = process.env.NODE_ENV === 'development'

function rowToDevice(row: Record<string, unknown>): Device {
  const mac = row.mac_address != null ? String(row.mac_address) : null
  const storedVendor = row.vendor != null ? String(row.vendor) : null
  const vendor = storedVendor ?? (mac ? lookupVendor(mac) : null)
  const deviceType = (row.device_type != null ? String(row.device_type) : 'Unknown') as DeviceType
  const deviceTypeCustom =
    row.device_type_custom != null && String(row.device_type_custom).trim()
      ? normalizeDeviceTypeCustom(String(row.device_type_custom))
      : null
  const base: Device = {
    id: String(row.id),
    name: String(row.name),
    ip: String(row.ip),
    subnet: String(row.subnet ?? ''),
    gateway: String(row.gateway ?? ''),
    macAddress: mac,
    vendor,
    deviceType: deviceType || inferDeviceType({ ip: String(row.ip), gateway: String(row.gateway ?? ''), vendor }),
    deviceTypeCustom,
    lastStatus: row.last_status as DeviceStatus,
    lastChecked: row.last_checked != null ? String(row.last_checked) : null,
    groupId: row.group_id != null ? String(row.group_id) : null,
    groupName: row.group_name != null ? String(row.group_name) : null,
    networkId: row.network_id != null ? String(row.network_id) : null
  }
  if (INCLUDE_DEV_EQUIPMENT_MIRROR_JSON && 'equipment_values_json' in row) {
    const j = row.equipment_values_json
    const s = j != null ? String(j) : ''
    base.equipmentValuesJson = s.trim() !== '' ? s : null
  }
  return base
}

const deviceSelectBase = `
  SELECT d.id, d.name, d.ip, d.subnet, d.gateway, d.mac_address, d.vendor, d.device_type, d.device_type_custom,
         d.last_status, d.last_checked, d.group_id, d.network_id, g.name AS group_name
  FROM devices d
  LEFT JOIN device_groups g ON g.id = d.group_id
`

const deviceSelect = INCLUDE_DEV_EQUIPMENT_MIRROR_JSON
  ? `
  SELECT d.id, d.name, d.ip, d.subnet, d.gateway, d.mac_address, d.vendor, d.device_type, d.device_type_custom,
         d.last_status, d.last_checked, d.group_id, d.network_id, g.name AS group_name,
         d.equipment_values_json
  FROM devices d
  LEFT JOIN device_groups g ON g.id = d.group_id
`
  : deviceSelectBase

/**
 * Lists devices for the UI. When `networkId` is set, shows rows tagged for that LAN
 * or legacy rows with NULL `network_id`. When `networkId` is null (unknown), no filter.
 */
export function listDevices(db: Database.Database, networkId?: string | null): Device[] {
  const nid =
    networkId !== undefined ? networkId : (getLastNetworkContext()?.networkId ?? getStableNetworkId())
  const where =
    nid == null
      ? ''
      : ` WHERE (d.network_id IS NULL OR d.network_id = @nid)`
  const rows = db
    .prepare(`${deviceSelect}${where} ORDER BY d.name COLLATE NOCASE`)
    .all(nid == null ? {} : { nid }) as Record<string, unknown>[]
  return rows.map(rowToDevice)
}

export function getDeviceByIp(db: Database.Database, ip: string): Device | null {
  const row = db
    .prepare(`${deviceSelect} WHERE d.ip = ?`)
    .get(ip) as Record<string, unknown> | undefined
  return row ? rowToDevice(row) : null
}

/**
 * Persistence only: insert or update a device row. Callers must validate, check IP conflicts,
 * and resolve group ids. Routed through `equipmentMutationService` for user saves.
 */
export function persistNormalizedDevice(
  db: Database.Database,
  input: {
    mode: 'insert' | 'update'
    id: string
    name: string
    ip: string
    subnet: string
    gateway: string
    groupId: string | null
    networkId: string | null
    /** When false on update, `device_type_custom` column is left unchanged. */
    touchDeviceTypeCustom: boolean
    /** Normalized custom type; used on insert always; on update only when touchDeviceTypeCustom. */
    deviceTypeCustom: string | null
  }
): void {
  const {
    mode,
    id,
    name,
    ip,
    subnet,
    gateway,
    groupId,
    networkId,
    touchDeviceTypeCustom,
    deviceTypeCustom
  } = input

  if (mode === 'update') {
    if (touchDeviceTypeCustom) {
      db.prepare(
        `UPDATE devices SET name = ?, ip = ?, subnet = ?, gateway = ?, group_id = ?, network_id = ?, device_type_custom = ? WHERE id = ?`
      ).run(name, ip, subnet, gateway, groupId, networkId, deviceTypeCustom, id)
    } else {
      db.prepare(
        `UPDATE devices SET name = ?, ip = ?, subnet = ?, gateway = ?, group_id = ?, network_id = ? WHERE id = ?`
      ).run(name, ip, subnet, gateway, groupId, networkId, id)
    }
    return
  }

  db.prepare(
    `INSERT INTO devices (id, name, ip, subnet, gateway, group_id, network_id, last_status, last_checked, device_type_custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)`
  ).run(id, name, ip, subnet, gateway, groupId, networkId, new Date().toISOString(), deviceTypeCustom)
}

/** @internal Used when the mutation service allocates a new id before persist. */
export function allocateDeviceId(): string {
  return uuidv4()
}

export function getDeviceById(db: Database.Database, id: string): Device | null {
  const row = db
    .prepare(`${deviceSelect} WHERE d.id = ?`)
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToDevice(row) : null
}

/**
 * Persistence only: set `group_id`.
 * Returns sqlite `changes` (may be 0 when the new value equals the old value; callers should not
 * treat 0 alone as “device missing”).
 */
export function persistDeviceGroupId(
  db: Database.Database,
  deviceId: string,
  groupId: string | null
): number {
  return db.prepare(`UPDATE devices SET group_id = ? WHERE id = ?`).run(groupId, deviceId).changes
}

/**
 * Persistence only: hard-delete one device row and its map node positions. Returns whether a row
 * was removed. Policy/existence messaging lives in `equipmentMutationService`.
 */
export function persistDeleteDeviceById(db: Database.Database, id: string): boolean {
  const r = db.prepare(`DELETE FROM devices WHERE id = ?`).run(id)
  if (r.changes > 0) deleteMapLayoutRowsForNodeKey(db, id)
  return r.changes > 0
}

/** Persistence only: all devices + all map layout state. Returns device rows deleted. */
export function persistDeleteAllDevices(db: Database.Database): number {
  deleteAllMapLayout(db)
  return db.prepare(`DELETE FROM devices`).run().changes
}

/**
 * Persistence only: devices tagged with `network_id` + map layout for that network.
 * Returns device rows deleted.
 */
export function persistDeleteDevicesByNetworkId(db: Database.Database, networkId: string): number {
  deleteMapLayoutForNetwork(db, networkId)
  return db.prepare(`DELETE FROM devices WHERE network_id = ?`).run(networkId).changes
}

/**
 * Persistence only: monitoring fields on one row. Returns sqlite row change count.
 * Orchestration (validation, existence) lives in `equipmentMutationService`.
 */
export function persistDeviceMonitoringStatus(
  db: Database.Database,
  deviceId: string,
  status: DeviceStatus,
  lastCheckedIso: string
): number {
  return db
    .prepare(`UPDATE devices SET last_status = ?, last_checked = ? WHERE id = ?`)
    .run(status, lastCheckedIso, deviceId).changes
}

/**
 * Persistence only: bulk monitoring update. When `networkId` is null/undefined, resolves like
 * legacy `setAllDevicesStatus` and either updates all rows (no stable network) or scoped rows.
 */
export function persistAllDevicesMonitoringStatus(
  db: Database.Database,
  status: DeviceStatus,
  lastCheckedIso: string,
  networkId?: string | null
): number {
  const nid = networkId !== undefined ? networkId : getStableNetworkId()
  if (nid == null) {
    return db
      .prepare(`UPDATE devices SET last_status = ?, last_checked = ?`)
      .run(status, lastCheckedIso).changes
  }
  return db
    .prepare(
      `UPDATE devices SET last_status = ?, last_checked = ? WHERE network_id IS NULL OR network_id = ?`
    )
    .run(status, lastCheckedIso, nid).changes
}

/**
 * Persistence only: discovery/ARP-owned columns on one row, keyed by canonical `deviceId`.
 * `vendor` uses SQL COALESCE with the new value (null keeps the stored vendor), matching legacy ARP sync.
 */
export function persistDeviceDiscoveryFieldsById(
  db: Database.Database,
  deviceId: string,
  macAddress: string,
  vendor: string | null,
  deviceType: DeviceType
): number {
  return db
    .prepare(
      `UPDATE devices SET mac_address = ?, vendor = COALESCE(?, vendor), device_type = ? WHERE id = ?`
    )
    .run(macAddress, vendor, deviceType, deviceId).changes
}

/**
 * Write-through mirror only: persists JSON for `mapDeviceToEquipmentRuntime(device).values`.
 * Columns remain source of truth; call only from `equipmentMutationService` after a reload-backed `Device`.
 */
export function persistEquipmentValuesJsonMirror(
  db: Database.Database,
  deviceId: string,
  equipmentValuesJson: string
): number {
  return db
    .prepare(`UPDATE devices SET equipment_values_json = ? WHERE id = ?`)
    .run(equipmentValuesJson, deviceId).changes
}

/**
 * Device ids that match the same scope as {@link persistAllDevicesMonitoringStatus} (for mirror refresh).
 * Must stay predicate-identical to avoid stale JSON after bulk monitoring updates.
 */
export function listDeviceIdsInMonitoringBulkScope(
  db: Database.Database,
  networkId?: string | null
): string[] {
  const nid = networkId !== undefined ? networkId : getStableNetworkId()
  if (nid == null) {
    const rows = db.prepare(`SELECT id FROM devices`).all() as { id: string }[]
    return rows.map((r) => String(r.id))
  }
  const rows = db
    .prepare(`SELECT id FROM devices WHERE network_id IS NULL OR network_id = ?`)
    .all(nid) as { id: string }[]
  return rows.map((r) => String(r.id))
}

/**
 * One-time / startup: fill `equipment_values_json` from authoritative `Device` where missing or blank.
 * Does not overwrite non-empty mirrors (avoids fighting concurrent writers).
 */
export function backfillMissingEquipmentValuesJsonMirrors(db: Database.Database): number {
  const ids = db
    .prepare(
      `SELECT id FROM devices WHERE equipment_values_json IS NULL OR TRIM(COALESCE(equipment_values_json, '')) = ''`
    )
    .all() as { id: string }[]
  let n = 0
  for (const { id } of ids) {
    const d = getDeviceById(db, id)
    if (!d) continue
    persistEquipmentValuesJsonMirror(db, id, serializeEquipmentValuesMirrorPayload(d))
    n += 1
  }
  return n
}

const MIRROR_SCAN_FAILURE_CAP = 80

/**
 * Debug/maintenance: opt-in JSON hydration experiment for one device (read-only). Returns which source was used;
 * columns remain authoritative on mismatch (fallback projection).
 */
export function debugResolveEquipmentRuntimeProjectionWithJsonHydration(
  db: Database.Database,
  deviceId: string
): DebugEquipmentRuntimeJsonHydrationIpcResult {
  const id = deviceId.trim()
  if (!id) return { ok: false, deviceId: id, reason: 'device_id_required' }

  const device = getDeviceById(db, id)
  if (!device) return { ok: false, deviceId: id, reason: 'device_not_found' }

  const row = db
    .prepare(`SELECT equipment_values_json FROM devices WHERE id = ?`)
    .get(id) as { equipment_values_json: string | null } | undefined

  const { projection, readSource } = resolveEquipmentRuntimeProjectionWithJsonHydrationExperiment(
    device,
    row?.equipment_values_json ?? null
  )

  return {
    ok: true,
    deviceId: id,
    readSource,
    projection: {
      id: projection.id,
      values: projection.values as unknown as Record<string, unknown>,
      _projection: projection._projection
    }
  }
}

/** Maintenance / diagnostics: compare stored mirror to fresh projection for one device (read-only). */
export function verifyEquipmentValuesMirrorRow(
  db: Database.Database,
  deviceId: string
): EquipmentMirrorVerifyDeviceResult {
  const id = deviceId.trim()
  if (!id) return { deviceId: id, ok: false, reason: 'device_id_required' }

  const row = db
    .prepare(`SELECT equipment_values_json FROM devices WHERE id = ?`)
    .get(id) as { equipment_values_json: string | null } | undefined
  const device = getDeviceById(db, id)

  if (!device) {
    return {
      deviceId: id,
      ok: false,
      reason: 'device_not_found',
      jsonReadExperiment: runEquipmentMirrorJsonReadExperiment(row?.equipment_values_json ?? null, null)
    }
  }
  if (!row) {
    return {
      deviceId: id,
      ok: false,
      reason: 'row_not_found',
      jsonReadExperiment: runEquipmentMirrorJsonReadExperiment(null, device)
    }
  }

  const r = compareEquipmentMirrorStoredToDevice(row.equipment_values_json, device)
  return {
    deviceId: id,
    ok: r.match,
    reason: r.reason,
    jsonReadExperiment: runEquipmentMirrorJsonReadExperiment(row.equipment_values_json, device)
  }
}

/** Maintenance: verify every device row’s mirror (read-only). */
export function verifyAllEquipmentValuesMirrorRows(db: Database.Database): EquipmentMirrorVerifyScanSummary {
  const ids = db.prepare(`SELECT id FROM devices`).all() as { id: string }[]
  const failures: { deviceId: string; reason?: string }[] = []
  let ok = 0
  let missingOrEmpty = 0
  let invalid = 0
  let mismatch = 0
  let other = 0

  for (const { id } of ids) {
    const r = verifyEquipmentValuesMirrorRow(db, id)
    if (r.ok) {
      ok += 1
      continue
    }
    if (failures.length < MIRROR_SCAN_FAILURE_CAP) {
      failures.push({ deviceId: r.deviceId, reason: r.reason })
    }
    const reason = r.reason
    if (reason === 'missing_or_empty_mirror') missingOrEmpty += 1
    else if (reason === 'invalid_json' || reason === 'malformed_mirror_shape') invalid += 1
    else if (reason === 'payload_mismatch') mismatch += 1
    else other += 1
  }

  return {
    total: ids.length,
    ok,
    missingOrEmpty,
    invalid,
    mismatch,
    other,
    failures
  }
}
