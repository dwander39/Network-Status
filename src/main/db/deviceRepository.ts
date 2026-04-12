import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { Device, DeviceStatus, DeviceType } from '@shared/types'
import { lookupVendor } from '../services/vendorLookup'
import { inferDeviceType } from '../services/deviceFingerprint'
import { normalizeDeviceTypeCustom } from '@shared/deviceTypeDisplay'
import { getLastNetworkContext, getStableNetworkId } from '../services/networkDetection'
import {
  deleteAllMapLayout,
  deleteMapLayoutForNetwork,
  deleteMapLayoutRowsForNodeKey
} from './mapLayoutRepository'

function rowToDevice(row: Record<string, unknown>): Device {
  const mac = row.mac_address != null ? String(row.mac_address) : null
  const storedVendor = row.vendor != null ? String(row.vendor) : null
  const vendor = storedVendor ?? (mac ? lookupVendor(mac) : null)
  const deviceType = (row.device_type != null ? String(row.device_type) : 'Unknown') as DeviceType
  const deviceTypeCustom =
    row.device_type_custom != null && String(row.device_type_custom).trim()
      ? normalizeDeviceTypeCustom(String(row.device_type_custom))
      : null
  return {
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
}

const deviceSelect = `
  SELECT d.id, d.name, d.ip, d.subnet, d.gateway, d.mac_address, d.vendor, d.device_type, d.device_type_custom,
         d.last_status, d.last_checked, d.group_id, d.network_id, g.name AS group_name
  FROM devices d
  LEFT JOIN device_groups g ON g.id = d.group_id
`

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
