/**
 * Phase 1 — Equipment runtime projection from legacy `Device`.
 *
 * Single source of truth remains SQLite `devices` + `Device` rows; this module only shapes
 * a typed `values` bag for resolver/UI adoption. No second persistence.
 *
 * Absence / unknown / not-yet-discovered: use `{ type: 'json', value: null }` consistently — not
 * empty strings (which would conflate “missing” with “user cleared to empty” once resolvers exist).
 *
 * Future: persist `values` (JSON column or side table), split system vs user vs override, and
 * stop duplicating columns in the projection (read from `values` only).
 */

import type { Device, DeviceStatus, DeviceType } from '@shared/types'
import type { EquipmentFieldValue } from './valueTypes'

/** Stable keys for Phase-1 column → `values` mapping (registry-aligned names, camelCase). */
export const LEGACY_DEVICE_RUNTIME_VALUE_KEYS = [
  'name',
  'ip',
  'macAddress',
  'subnet',
  'gateway',
  'vendor',
  'deviceType',
  'deviceTypeCustom',
  'lastStatus',
  'lastChecked',
  'groupId',
  // Joined list-group label from device_groups; canonical id remains groupId.
  'groupName'
] as const

export type LegacyDeviceRuntimeValueKey = (typeof LEGACY_DEVICE_RUNTIME_VALUE_KEYS)[number]

/** Typed field bag for the legacy columns in scope (Phase 1). */
export type LegacyDeviceScopedValues = Record<LegacyDeviceRuntimeValueKey, EquipmentFieldValue>

/**
 * Runtime Equipment-shaped view derived from `Device`. Not persisted; not the full domain
 * `Equipment` entity (no `projectId`, audit ids, or `typeKey` until those exist on the row).
 */
export interface EquipmentRuntimeProjection {
  id: string
  values: LegacyDeviceScopedValues
  /** Documents adapter provenance for debugging and future migrations. */
  _projection: { source: 'legacy_device_row'; phase: 1 }
}

/**
 * Explicit absence in the projection: unknown, not discovered, or no value on the legacy row.
 * Resolver layer can treat this distinctly from `text` `value: ''` (intentional empty string).
 */
export function equipmentRuntimeValueAbsent(): EquipmentFieldValue {
  return { type: 'json', value: null }
}

function textOrEmpty(s: string | null | undefined): EquipmentFieldValue {
  return { type: 'text', value: s?.trim() ? s : '' }
}

function enumValue(value: string): EquipmentFieldValue {
  return { type: 'enum', value }
}

function macAddressProjection(mac: string | null | undefined): EquipmentFieldValue {
  if (mac == null) return equipmentRuntimeValueAbsent()
  const t = mac.trim()
  if (t === '') return equipmentRuntimeValueAbsent()
  return { type: 'text', value: t }
}

function vendorProjection(vendor: string | null | undefined): EquipmentFieldValue {
  if (vendor == null) return equipmentRuntimeValueAbsent()
  const t = vendor.trim()
  if (t === '') return equipmentRuntimeValueAbsent()
  return { type: 'text', value: t }
}

/** Absent when null, empty, or whitespace-only ISO. Present values use `datetime` only. */
function lastCheckedProjection(iso: string | null | undefined): EquipmentFieldValue {
  if (iso == null) return equipmentRuntimeValueAbsent()
  const t = String(iso).trim()
  if (t === '') return equipmentRuntimeValueAbsent()
  return { type: 'datetime', value: t }
}

/** Absent when null, empty, or whitespace-only id. Present values use `reference` only. */
function groupIdProjection(id: string | null | undefined): EquipmentFieldValue {
  if (id == null) return equipmentRuntimeValueAbsent()
  const t = id.trim()
  if (t === '') return equipmentRuntimeValueAbsent()
  return { type: 'reference', value: t }
}

/**
 * Maps a legacy `Device` to typed `EquipmentFieldValue` entries. Centralize all Device → values
 * transforms here; do not scatter column→value logic in UI or services.
 */
export function mapDeviceToEquipmentRuntime(device: Device): EquipmentRuntimeProjection {
  const deviceType: DeviceType = device.deviceType
  const lastStatus: DeviceStatus = device.lastStatus

  const values: LegacyDeviceScopedValues = {
    name: textOrEmpty(device.name),
    ip: textOrEmpty(device.ip),
    macAddress: macAddressProjection(device.macAddress),
    subnet: textOrEmpty(device.subnet),
    gateway: textOrEmpty(device.gateway),
    vendor: vendorProjection(device.vendor),
    deviceType: enumValue(deviceType),
    deviceTypeCustom: textOrEmpty(device.deviceTypeCustom),
    lastStatus: enumValue(lastStatus),
    lastChecked: lastCheckedProjection(device.lastChecked),
    groupId: groupIdProjection(device.groupId),
    groupName: textOrEmpty(device.groupName)
  }

  return {
    id: device.id,
    values,
    _projection: { source: 'legacy_device_row', phase: 1 }
  }
}
