import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { Device, DeviceStatus, DeviceType, SaveDevicePayload } from '@shared/types'
import { assertValidIPv4 } from '@shared/ipValidation'
import { lookupVendor } from '../services/vendorLookup'
import { getDeviceGroupById } from './groupRepository'
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

export function saveDevice(db: Database.Database, input: SaveDevicePayload): Device {
  assertValidIPv4('IP address', input.ip)
  if (input.subnet.trim()) assertValidIPv4('Subnet mask', input.subnet)
  if (input.gateway.trim()) assertValidIPv4('Gateway', input.gateway)

  const id = input.id ?? uuidv4()

  const resolveGroupId = (existing: Device | null): string | null => {
    if (input.groupId !== undefined) {
      const gid = input.groupId
      if (gid) {
        const g = getDeviceGroupById(db, gid)
        if (!g) throw new Error('Invalid group')
      }
      return gid
    }
    return existing?.groupId ?? null
  }

  if (input.id) {
    const existingDevice = getDeviceById(db, input.id)
    if (!existingDevice) throw new Error('Device not found')
    const conflict = db
      .prepare(`SELECT id FROM devices WHERE ip = ? AND id != ?`)
      .get(input.ip, id) as { id: string } | undefined
    if (conflict) throw new Error('Another device already uses this IP')

    const nextGroupId = resolveGroupId(existingDevice)

    const tag = getLastNetworkContext()?.networkId ?? getStableNetworkId()
    const custom =
      input.deviceTypeCustom !== undefined
        ? normalizeDeviceTypeCustom(input.deviceTypeCustom)
        : undefined
    if (custom !== undefined) {
      db.prepare(
        `UPDATE devices SET name = ?, ip = ?, subnet = ?, gateway = ?, group_id = ?, network_id = ?, device_type_custom = ? WHERE id = ?`
      ).run(
        input.name.trim(),
        input.ip.trim(),
        input.subnet.trim(),
        input.gateway.trim(),
        nextGroupId,
        tag,
        custom,
        id
      )
    } else {
      db.prepare(
        `UPDATE devices SET name = ?, ip = ?, subnet = ?, gateway = ?, group_id = ?, network_id = ? WHERE id = ?`
      ).run(
        input.name.trim(),
        input.ip.trim(),
        input.subnet.trim(),
        input.gateway.trim(),
        nextGroupId,
        tag,
        id
      )
    }
  } else {
    const conflict = db.prepare(`SELECT id FROM devices WHERE ip = ?`).get(input.ip)
    if (conflict) throw new Error('A device with this IP already exists')

    let nextGroupId: string | null = null
    if (input.groupId !== undefined) {
      nextGroupId = input.groupId
      if (nextGroupId) {
        const g = getDeviceGroupById(db, nextGroupId)
        if (!g) throw new Error('Invalid group')
      }
    }

    const tag = getLastNetworkContext()?.networkId ?? getStableNetworkId()
    const customNew =
      input.deviceTypeCustom !== undefined
        ? normalizeDeviceTypeCustom(input.deviceTypeCustom)
        : null
    db.prepare(
      `INSERT INTO devices (id, name, ip, subnet, gateway, group_id, network_id, last_status, last_checked, device_type_custom)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)`
    ).run(
      id,
      input.name.trim(),
      input.ip.trim(),
      input.subnet.trim(),
      input.gateway.trim(),
      nextGroupId,
      tag,
      new Date().toISOString(),
      customNew
    )
  }

  return getDeviceById(db, id)!
}

export function getDeviceById(db: Database.Database, id: string): Device | null {
  const row = db
    .prepare(`${deviceSelect} WHERE d.id = ?`)
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToDevice(row) : null
}

export function setDeviceGroup(
  db: Database.Database,
  deviceId: string,
  groupId: string | null
): Device {
  if (groupId) {
    const g = getDeviceGroupById(db, groupId)
    if (!g) throw new Error('Invalid group')
  }
  const r = db.prepare(`UPDATE devices SET group_id = ? WHERE id = ?`).run(groupId, deviceId)
  if (r.changes === 0) throw new Error('Device not found')
  return getDeviceById(db, deviceId)!
}

export function deleteDevice(db: Database.Database, id: string): boolean {
  const r = db.prepare(`DELETE FROM devices WHERE id = ?`).run(id)
  if (r.changes > 0) deleteMapLayoutRowsForNodeKey(db, id)
  return r.changes > 0
}

/** Remove every saved device (all networks). Returns rows deleted. */
export function deleteAllDevices(db: Database.Database): number {
  deleteAllMapLayout(db)
  return db.prepare(`DELETE FROM devices`).run().changes
}

/** Remove monitored devices tagged for one LAN (`network_id` must match stored fingerprint). */
export function deleteDevicesForNetwork(db: Database.Database, networkId: string): number {
  deleteMapLayoutForNetwork(db, networkId)
  return db.prepare(`DELETE FROM devices WHERE network_id = ?`).run(networkId).changes
}

/** Update reachability result after a ping round. */
export function updateDeviceStatus(
  db: Database.Database,
  id: string,
  status: DeviceStatus,
  checkedIso: string
): void {
  db.prepare(
    `UPDATE devices SET last_status = ?, last_checked = ? WHERE id = ?`
  ).run(status, checkedIso, id)
}

/** Bulk status update (used when monitoring is disabled). Only touches current-LAN rows + legacy NULL. */
export function setAllDevicesStatus(
  db: Database.Database,
  status: DeviceStatus,
  checkedIso: string,
  networkId?: string | null
): void {
  const nid = networkId !== undefined ? networkId : getStableNetworkId()
  if (nid == null) {
    db.prepare(`UPDATE devices SET last_status = ?, last_checked = ?`).run(status, checkedIso)
    return
  }
  db.prepare(
    `UPDATE devices SET last_status = ?, last_checked = ? WHERE network_id IS NULL OR network_id = ?`
  ).run(status, checkedIso, nid)
}
