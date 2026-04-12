/**
 * Unified orchestration for equipment/device writes (transitional: SQLite `devices` schema).
 *
 * User saves, group assignment, and monitoring status updates go through this module.
 * Persistence stays in `deviceRepository` helpers; lifecycle hard-deletes are orchestrated here.
 */

import type Database from 'better-sqlite3'
import type { Device, DeviceStatus, DeviceType, SaveDevicePayload } from '@shared/types'
import {
  collectDeviceFormValidationRejections,
  showDeviceTypeCustomField,
  type DeviceFormFieldValues
} from '@shared/deviceSaveValidation'
import { normalizeDeviceTypeCustom } from '@shared/deviceTypeDisplay'
import {
  mapDeviceToEquipmentRuntime,
  type EquipmentRuntimeProjection
} from '../../domain/equipment/deviceEquipmentAdapter'
import type { AppliedEquipmentPatch, RejectedEquipmentPatch } from '../../domain/equipment/mutations'
import { inferDeviceType } from './deviceFingerprint'
import { getLastNetworkContext, getStableNetworkId } from './networkDetection'
import {
  allocateDeviceId,
  getDeviceById,
  getDeviceByIp,
  persistAllDevicesMonitoringStatus,
  persistDeleteAllDevices,
  persistDeleteDeviceById,
  persistDeleteDevicesByNetworkId,
  persistDeviceDiscoveryFieldsById,
  persistDeviceGroupId,
  persistDeviceMonitoringStatus,
  persistNormalizedDevice
} from '../db/deviceRepository'
import { getDeviceGroupById } from '../db/groupRepository'

/** Who initiated the mutation; extends later for ARP, ping, and automation. */
export type EquipmentMutationSource = 'user' | 'system' | 'discovery' | 'monitoring'

export type LegacyUserDeviceFieldKey =
  | 'name'
  | 'ip'
  | 'subnet'
  | 'gateway'
  | 'groupId'
  | 'deviceTypeCustom'

/** Internal patch shape; `setOverride` / `clearOverride` arrive when legacy storage splits. */
export type LegacyDevicePatchOperation = 'set' | 'clear'

export interface LegacyDeviceFieldPatch {
  fieldKey: LegacyUserDeviceFieldKey
  operation: LegacyDevicePatchOperation
  /** Normalized primitive / null for clear */
  value?: string | null
}

export interface LegacyEquipmentMutationResult {
  success: boolean
  source: EquipmentMutationSource
  appliedPatches: AppliedEquipmentPatch[]
  rejectedPatches: RejectedEquipmentPatch[]
  errors: string[]
  warnings: string[]
  updatedAt: string
  device?: Device
  /**
   * Optional Equipment-shaped projection of `device` (Phase 1). Same data as `device`; for
   * resolver prep. Omitted when `device` is absent.
   */
  equipmentRuntime?: EquipmentRuntimeProjection
  /** Compatibility scope: maps to `Device.networkId` / DB `network_id`. */
  projectId: string | null
}

function withEquipmentRuntime<T extends LegacyEquipmentMutationResult>(r: T): T {
  if (r.device) {
    return { ...r, equipmentRuntime: mapDeviceToEquipmentRuntime(r.device) }
  }
  return r
}

function networkScopeForPersist(): string | null {
  return getLastNetworkContext()?.networkId ?? getStableNetworkId()
}

function toRejectedPatches(
  rejections: ReturnType<typeof collectDeviceFormValidationRejections>
): RejectedEquipmentPatch[] {
  return rejections.map((r) => ({
    fieldKey: r.fieldKey,
    operation: 'set' as const,
    reason: r.reason,
    code: r.code
  }))
}

function mergePayloadForValidation(
  payload: SaveDevicePayload,
  existing: Device | null
): DeviceFormFieldValues {
  const groupId =
    payload.groupId !== undefined ? payload.groupId : (existing?.groupId ?? null)
  const deviceTypeCustomStr =
    payload.deviceTypeCustom !== undefined
      ? payload.deviceTypeCustom ?? ''
      : (existing?.deviceTypeCustom ?? '') ?? ''
  return {
    name: payload.name,
    ip: payload.ip,
    subnet: payload.subnet,
    gateway: payload.gateway,
    deviceTypeCustom: deviceTypeCustomStr
  }
}

function resolveGroupId(payload: SaveDevicePayload, existing: Device | null): string | null {
  if (payload.groupId !== undefined) {
    return payload.groupId
  }
  return existing?.groupId ?? null
}

/** Single place to validate a non-null group id exists (used by full save and group-only mutation). */
function validateGroupReference(
  db: Database.Database,
  groupId: string | null
): RejectedEquipmentPatch | null {
  if (!groupId) return null
  if (!getDeviceGroupById(db, groupId)) {
    return { fieldKey: 'groupId', operation: 'set', reason: 'Invalid group', code: 'invalid_group' }
  }
  return null
}

function normalizeCustomForPersist(payload: SaveDevicePayload): {
  touch: boolean
  value: string | null
} {
  if (payload.deviceTypeCustom === undefined) {
    return { touch: false, value: null }
  }
  return { touch: true, value: normalizeDeviceTypeCustom(payload.deviceTypeCustom) }
}

function buildAppliedPatches(prev: Device | null, next: Device): AppliedEquipmentPatch[] {
  const out: AppliedEquipmentPatch[] = []
  const push = (
    fieldKey: string,
    operation: LegacyDevicePatchOperation,
    before: unknown,
    after: unknown
  ): void => {
    if (operation === 'clear') {
      out.push({ fieldKey, operation: 'clear', previousSnapshot: before, newSnapshot: after })
      return
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return
    out.push({ fieldKey, operation: 'set', previousSnapshot: before, newSnapshot: after })
  }

  if (!prev) {
    push('name', 'set', undefined, next.name)
    push('ip', 'set', undefined, next.ip)
    push('subnet', 'set', undefined, next.subnet)
    push('gateway', 'set', undefined, next.gateway)
    push('groupId', 'set', undefined, next.groupId)
    push('deviceTypeCustom', next.deviceTypeCustom == null ? 'clear' : 'set', undefined, next.deviceTypeCustom)
    return out
  }

  push('name', 'set', prev.name, next.name)
  push('ip', 'set', prev.ip, next.ip)
  push('subnet', 'set', prev.subnet, next.subnet)
  push('gateway', 'set', prev.gateway, next.gateway)
  push('groupId', 'set', prev.groupId, next.groupId)
  const pc = prev.deviceTypeCustom ?? null
  const nc = next.deviceTypeCustom ?? null
  if (pc !== nc) {
    out.push({
      fieldKey: 'deviceTypeCustom',
      operation: nc == null ? 'clear' : 'set',
      previousSnapshot: pc,
      newSnapshot: nc
    })
  }

  return out
}

/**
 * Full mutation pipeline for the legacy `SaveDevicePayload` shape. Deterministic; no hidden I/O
 * beyond the given `db` handle.
 */
export function mutateDeviceFromSavePayload(
  db: Database.Database,
  payload: SaveDevicePayload,
  source: EquipmentMutationSource = 'user'
): LegacyEquipmentMutationResult {
  const updatedAt = new Date().toISOString()
  const projectId = networkScopeForPersist()
  const empty: LegacyEquipmentMutationResult = {
    success: false,
    source,
    appliedPatches: [],
    rejectedPatches: [],
    errors: [],
    warnings: [],
    updatedAt,
    projectId
  }

  const isUpdate = Boolean(payload.id)
  const existing = isUpdate ? getDeviceById(db, payload.id!) : null
  if (isUpdate && !existing) {
    return {
      ...empty,
      errors: ['Device not found'],
      rejectedPatches: [
        { fieldKey: 'id', operation: 'set', reason: 'Device not found', code: 'not_found' }
      ]
    }
  }

  const merged = mergePayloadForValidation(payload, existing)
  const showCustom = showDeviceTypeCustomField(isUpdate ? existing : null)
  const validationRejections = collectDeviceFormValidationRejections(merged, showCustom)
  if (validationRejections.length > 0) {
    return {
      ...empty,
      rejectedPatches: toRejectedPatches(validationRejections),
      errors: validationRejections.map((r) => r.reason)
    }
  }

  const name = merged.name.trim()
  const ip = merged.ip.trim()
  const subnet = merged.subnet.trim()
  const gateway = merged.gateway.trim()
  const nextGroupId = resolveGroupId(payload, existing)

  const groupRejection = validateGroupReference(db, nextGroupId)
  if (groupRejection) {
    return {
      ...empty,
      errors: [groupRejection.reason],
      rejectedPatches: [groupRejection]
    }
  }

  const custom = normalizeCustomForPersist(payload)

  if (isUpdate) {
    const conflict = db
      .prepare(`SELECT id FROM devices WHERE ip = ? AND id != ?`)
      .get(ip, existing!.id) as { id: string } | undefined
    if (conflict) {
      return {
        ...empty,
        errors: ['Another device already uses this IP'],
        rejectedPatches: [
          {
            fieldKey: 'ip',
            operation: 'set',
            reason: 'Another device already uses this IP',
            code: 'ip_conflict'
          }
        ]
      }
    }

    persistNormalizedDevice(db, {
      mode: 'update',
      id: existing!.id,
      name,
      ip,
      subnet,
      gateway,
      groupId: nextGroupId,
      networkId: projectId,
      touchDeviceTypeCustom: custom.touch,
      deviceTypeCustom: custom.value
    })

    const next = getDeviceById(db, existing!.id)!
    return withEquipmentRuntime({
      success: true,
      source,
      appliedPatches: buildAppliedPatches(existing, next),
      rejectedPatches: [],
      errors: [],
      warnings: [],
      updatedAt,
      device: next,
      projectId
    })
  }

  const conflictIns = db.prepare(`SELECT id FROM devices WHERE ip = ?`).get(ip)
  if (conflictIns) {
    return {
      ...empty,
      errors: ['A device with this IP already exists'],
      rejectedPatches: [
        {
          fieldKey: 'ip',
          operation: 'set',
          reason: 'A device with this IP already exists',
          code: 'ip_conflict'
        }
      ]
    }
  }

  const id = allocateDeviceId()
  const insertCustom = payload.deviceTypeCustom !== undefined ? custom.value : null

  persistNormalizedDevice(db, {
    mode: 'insert',
    id,
    name,
    ip,
    subnet,
    gateway,
    groupId: nextGroupId,
    networkId: projectId,
    touchDeviceTypeCustom: true,
    deviceTypeCustom: insertCustom
  })

  const next = getDeviceById(db, id)!
  return withEquipmentRuntime({
    success: true,
    source,
    appliedPatches: buildAppliedPatches(null, next),
    rejectedPatches: [],
    errors: [],
    warnings: [],
    updatedAt,
    device: next,
    projectId
  })
}

/**
 * IPC / legacy compatibility: same throw semantics as the former `deviceRepository.saveDevice`.
 */
export function applyUserSaveDevicePayload(db: Database.Database, payload: SaveDevicePayload): Device {
  const result = mutateDeviceFromSavePayload(db, payload, 'user')
  if (!result.success || !result.device) {
    const msg = result.errors[0] ?? result.rejectedPatches[0]?.reason ?? 'Save failed'
    throw new Error(msg)
  }
  return result.device
}

/**
 * Field-level mutation: `groupId` only. Same semantics as the former `setDeviceGroup` repository call.
 */
export function mutateDeviceGroupAssignment(
  db: Database.Database,
  deviceId: string,
  groupId: string | null,
  source: EquipmentMutationSource = 'user'
): LegacyEquipmentMutationResult {
  const updatedAt = new Date().toISOString()
  const projectId = networkScopeForPersist()
  const empty: LegacyEquipmentMutationResult = {
    success: false,
    source,
    appliedPatches: [],
    rejectedPatches: [],
    errors: [],
    warnings: [],
    updatedAt,
    projectId
  }

  const groupRejection = validateGroupReference(db, groupId)
  if (groupRejection) {
    return {
      ...empty,
      errors: [groupRejection.reason],
      rejectedPatches: [groupRejection]
    }
  }

  const existing = getDeviceById(db, deviceId)
  if (!existing) {
    return {
      ...empty,
      errors: ['Device not found'],
      rejectedPatches: [
        { fieldKey: 'id', operation: 'set', reason: 'Device not found', code: 'not_found' }
      ]
    }
  }

  persistDeviceGroupId(db, deviceId, groupId)
  // Do not use sqlite `changes`: UPDATE may report 0 when values are unchanged (same group).
  const next = getDeviceById(db, deviceId)
  if (!next) {
    return {
      ...empty,
      errors: ['Device not found'],
      rejectedPatches: [
        { fieldKey: 'id', operation: 'set', reason: 'Device not found', code: 'not_found' }
      ]
    }
  }
  const appliedPatches: AppliedEquipmentPatch[] = []
  if (existing.groupId !== next.groupId) {
    appliedPatches.push({
      fieldKey: 'groupId',
      operation: next.groupId == null ? 'clear' : 'set',
      previousSnapshot: existing.groupId,
      newSnapshot: next.groupId
    })
  }

  return withEquipmentRuntime({
    success: true,
    source,
    appliedPatches,
    rejectedPatches: [],
    errors: [],
    warnings: [],
    updatedAt,
    device: next,
    projectId
  })
}

/** IPC / legacy: same throw messages as former `setDeviceGroup`. */
export function applyUserSetDeviceGroup(
  db: Database.Database,
  deviceId: string,
  groupId: string | null
): Device {
  const result = mutateDeviceGroupAssignment(db, deviceId, groupId, 'user')
  if (!result.success || !result.device) {
    const msg = result.errors[0] ?? result.rejectedPatches[0]?.reason ?? 'Save failed'
    throw new Error(msg)
  }
  return result.device
}

const MONITORING_STATUS_VALUES: readonly DeviceStatus[] = ['online', 'offline', 'unknown']

function assertValidMonitoringStatus(status: DeviceStatus): RejectedEquipmentPatch | null {
  if (!MONITORING_STATUS_VALUES.includes(status)) {
    return {
      fieldKey: 'last_status',
      operation: 'set',
      reason: `Invalid monitoring status: ${String(status)}`,
      code: 'invalid_status'
    }
  }
  return null
}

function normalizeMonitoringLastChecked(iso: string): { ok: true; iso: string } | { ok: false; reason: string } {
  const t = iso.trim()
  if (!t) return { ok: false, reason: 'last_checked must be a non-empty ISO datetime string.' }
  const ms = Date.parse(t)
  if (Number.isNaN(ms)) return { ok: false, reason: 'last_checked is not a valid ISO datetime string.' }
  return { ok: true, iso: new Date(ms).toISOString() }
}

/** Structured result for per-device monitoring writes (ping round). */
export interface MonitoringDeviceStatusMutationResult {
  success: boolean
  source: 'monitoring'
  deviceId: string
  appliedPatches: AppliedEquipmentPatch[]
  rejectedPatches: RejectedEquipmentPatch[]
  errors: string[]
  warnings: string[]
  updatedAt: string
  rowsChanged: number
}

/** Structured result for bulk monitoring writes (adapters disabled path). */
export interface MonitoringBulkStatusMutationResult {
  success: boolean
  source: 'monitoring'
  appliedPatches: AppliedEquipmentPatch[]
  rejectedPatches: RejectedEquipmentPatch[]
  errors: string[]
  warnings: string[]
  updatedAt: string
  rowsChanged: number
  /** Resolved filter: null means “all devices” update (no stable network scope). */
  networkScope: string | null
}

/**
 * Monitoring-only: `last_status` + `last_checked`. Does not touch user-editable columns.
 * Callers (ping) should ignore the return value unless they need diagnostics; behavior matches
 * legacy `updateDeviceStatus` when inputs are valid.
 */
export function mutateMonitoringDeviceStatus(
  db: Database.Database,
  deviceId: string,
  status: DeviceStatus,
  lastCheckedIso: string
): MonitoringDeviceStatusMutationResult {
  const updatedAt = new Date().toISOString()
  const emptyBase = {
    source: 'monitoring' as const,
    deviceId,
    appliedPatches: [] as AppliedEquipmentPatch[],
    rejectedPatches: [] as RejectedEquipmentPatch[],
    errors: [] as string[],
    warnings: [] as string[],
    updatedAt,
    rowsChanged: 0
  }

  const statusRej = assertValidMonitoringStatus(status)
  if (statusRej) {
    return {
      ...emptyBase,
      success: false,
      rejectedPatches: [statusRej],
      errors: [statusRej.reason]
    }
  }

  const isoNorm = normalizeMonitoringLastChecked(lastCheckedIso)
  if (!isoNorm.ok) {
    const rej: RejectedEquipmentPatch = {
      fieldKey: 'last_checked',
      operation: 'set',
      reason: isoNorm.reason,
      code: 'invalid_timestamp'
    }
    return {
      ...emptyBase,
      success: false,
      rejectedPatches: [rej],
      errors: [isoNorm.reason]
    }
  }

  const before = getDeviceById(db, deviceId)
  if (!before) {
    const rej: RejectedEquipmentPatch = {
      fieldKey: 'id',
      operation: 'set',
      reason: 'Device not found',
      code: 'not_found'
    }
    return {
      ...emptyBase,
      success: false,
      rejectedPatches: [rej],
      errors: ['Device not found']
    }
  }

  const rowsChanged = persistDeviceMonitoringStatus(db, deviceId, status, isoNorm.iso)
  const appliedPatches: AppliedEquipmentPatch[] = [
    {
      fieldKey: 'last_status',
      operation: 'set',
      previousSnapshot: before.lastStatus,
      newSnapshot: status
    },
    {
      fieldKey: 'last_checked',
      operation: 'set',
      previousSnapshot: before.lastChecked,
      newSnapshot: isoNorm.iso
    }
  ]

  const warnings =
    rowsChanged === 0
      ? ['UPDATE affected 0 rows; device row may have been removed concurrently.']
      : []

  return {
    success: true,
    source: 'monitoring',
    deviceId,
    appliedPatches,
    rejectedPatches: [],
    errors: [],
    warnings,
    updatedAt,
    rowsChanged
  }
}

/**
 * Monitoring-only bulk update (legacy `setAllDevicesStatus` semantics).
 * When `networkId` is omitted, uses the same default as the repository helper (`getStableNetworkId()`).
 */
export function mutateMonitoringBulkStatus(
  db: Database.Database,
  status: DeviceStatus,
  lastCheckedIso: string,
  networkId?: string | null
): MonitoringBulkStatusMutationResult {
  const updatedAt = new Date().toISOString()
  const emptyBase = {
    source: 'monitoring' as const,
    appliedPatches: [] as AppliedEquipmentPatch[],
    rejectedPatches: [] as RejectedEquipmentPatch[],
    errors: [] as string[],
    warnings: [] as string[],
    updatedAt,
    rowsChanged: 0,
    networkScope: null as string | null
  }

  const statusRej = assertValidMonitoringStatus(status)
  if (statusRej) {
    return {
      ...emptyBase,
      success: false,
      rejectedPatches: [statusRej],
      errors: [statusRej.reason],
      networkScope: networkId !== undefined && networkId !== null ? networkId : getStableNetworkId()
    }
  }

  const isoNorm = normalizeMonitoringLastChecked(lastCheckedIso)
  if (!isoNorm.ok) {
    const rej: RejectedEquipmentPatch = {
      fieldKey: 'last_checked',
      operation: 'set',
      reason: isoNorm.reason,
      code: 'invalid_timestamp'
    }
    return {
      ...emptyBase,
      success: false,
      rejectedPatches: [rej],
      errors: [isoNorm.reason],
      networkScope: networkId !== undefined && networkId !== null ? networkId : getStableNetworkId()
    }
  }

  const resolvedScope =
    networkId !== undefined ? networkId : getStableNetworkId()
  const rowsChanged = persistAllDevicesMonitoringStatus(
    db,
    status,
    isoNorm.iso,
    networkId !== undefined ? networkId : undefined
  )

  return {
    success: true,
    source: 'monitoring',
    appliedPatches: [
      {
        fieldKey: 'last_status',
        operation: 'set',
        previousSnapshot: { scope: 'bulk', networkId: resolvedScope },
        newSnapshot: status
      },
      {
        fieldKey: 'last_checked',
        operation: 'set',
        previousSnapshot: undefined,
        newSnapshot: isoNorm.iso
      }
    ],
    rejectedPatches: [],
    errors: [],
    warnings: [],
    updatedAt,
    rowsChanged,
    networkScope: resolvedScope
  }
}

/** Must match `arpRepository` MAC normalization output before device sync. */
const DISCOVERY_MAC_HEX = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/

const KNOWN_DEVICE_TYPES: readonly DeviceType[] = [
  'Router',
  'Laptop',
  'Phone',
  'Printer',
  'IoT',
  'Unknown'
]

function rejectInvalidDiscoveryMac(normalizedMac: string): RejectedEquipmentPatch | null {
  if (!DISCOVERY_MAC_HEX.test(normalizedMac)) {
    return {
      fieldKey: 'mac_address',
      operation: 'set',
      reason: 'Discovery MAC must be normalized lowercase hex with colons (aa:bb:cc:dd:ee:ff).',
      code: 'invalid_mac'
    }
  }
  return null
}

function rejectInvalidDiscoveryDeviceType(t: DeviceType): RejectedEquipmentPatch | null {
  if (!KNOWN_DEVICE_TYPES.includes(t)) {
    return {
      fieldKey: 'device_type',
      operation: 'set',
      reason: `Invalid device_type: ${String(t)}`,
      code: 'invalid_device_type'
    }
  }
  return null
}

/**
 * One ARP scan row applied to a saved device. `lookupIp` is transitional resolution only;
 * persistence uses canonical `Device.id` once matched.
 */
export interface DiscoveryArpRowInput {
  lookupIp: string
  normalizedMac: string
  arpVendor: string | null
}

export interface DiscoveryArpRowMutationResult {
  success: boolean
  source: 'discovery'
  lookupIp: string
  /** Canonical row id when a saved device matched `lookupIp`; otherwise null. */
  matchedDeviceId: string | null
  appliedPatches: AppliedEquipmentPatch[]
  rejectedPatches: RejectedEquipmentPatch[]
  errors: string[]
  warnings: string[]
  updatedAt: string
  rowsChanged: number
}

/**
 * Discovery-only: `mac_address`, `vendor` (COALESCE semantics), `device_type` (inferred here).
 * Does not touch user-owned name/ip/subnet/gateway/group/custom type/status fields.
 */
export function mutateDiscoveryDeviceFromArpRow(
  db: Database.Database,
  input: DiscoveryArpRowInput
): DiscoveryArpRowMutationResult {
  const updatedAt = new Date().toISOString()
  const lookupIp = input.lookupIp.trim()
  const empty: DiscoveryArpRowMutationResult = {
    success: false,
    source: 'discovery',
    lookupIp,
    matchedDeviceId: null,
    appliedPatches: [],
    rejectedPatches: [],
    errors: [],
    warnings: [],
    updatedAt,
    rowsChanged: 0
  }

  const macRej = rejectInvalidDiscoveryMac(input.normalizedMac)
  if (macRej) {
    return {
      ...empty,
      rejectedPatches: [macRej],
      errors: [macRej.reason]
    }
  }

  const resolved = getDeviceByIp(db, lookupIp)
  if (!resolved) {
    // Legacy ARP path skipped silently when no saved device matched the IP.
    return {
      ...empty,
      success: true,
      matchedDeviceId: null,
      warnings: []
    }
  }

  const inferredType = inferDeviceType({
    ip: resolved.ip,
    gateway: resolved.gateway,
    vendor: input.arpVendor
  })
  const typeRej = rejectInvalidDiscoveryDeviceType(inferredType)
  if (typeRej) {
    return {
      ...empty,
      matchedDeviceId: resolved.id,
      rejectedPatches: [typeRej],
      errors: [typeRej.reason]
    }
  }

  const prevMac = resolved.macAddress
  const prevVendor = resolved.vendor
  const prevType = resolved.deviceType

  const rowsChanged = persistDeviceDiscoveryFieldsById(
    db,
    resolved.id,
    input.normalizedMac,
    input.arpVendor,
    inferredType
  )

  const nextVendor = input.arpVendor != null ? input.arpVendor : prevVendor
  const appliedPatches: AppliedEquipmentPatch[] = [
    {
      fieldKey: 'mac_address',
      operation: 'set',
      previousSnapshot: prevMac,
      newSnapshot: input.normalizedMac
    },
    {
      fieldKey: 'vendor',
      operation: 'set',
      previousSnapshot: prevVendor,
      newSnapshot: nextVendor
    },
    {
      fieldKey: 'device_type',
      operation: 'set',
      previousSnapshot: prevType,
      newSnapshot: inferredType
    }
  ]

  const warnings =
    rowsChanged === 0
      ? ['UPDATE affected 0 rows; device may have been removed during the ARP transaction.']
      : []

  return {
    success: true,
    source: 'discovery',
    lookupIp,
    matchedDeviceId: resolved.id,
    appliedPatches,
    rejectedPatches: [],
    errors: [],
    warnings,
    updatedAt,
    rowsChanged
  }
}

/**
 * `upsertArpBatch` compatibility: run discovery sync and ignore structured diagnostics.
 * Prefer `mutateDiscoveryDeviceFromArpRow` when callers need patch results.
 */
export function applyDiscoverySyncFromArpRow(db: Database.Database, input: DiscoveryArpRowInput): void {
  void mutateDiscoveryDeviceFromArpRow(db, input)
}

// --- Lifecycle / hard delete (orchestration; persistence is persistDelete* in repository) ---

/** Who authorized the destructive lifecycle operation (UI vs automated/system maintenance). */
export type EquipmentLifecycleSource = 'user' | 'system'

export interface LifecycleDeleteSingleResult {
  success: boolean
  operation: 'hard_delete_single'
  source: EquipmentLifecycleSource
  targetId: string
  /** True when a `devices` row was removed. */
  deleted: boolean
  deletedDeviceIds: string[]
  errors: string[]
  warnings: string[]
  updatedAt: string
}

export interface LifecycleBulkDeleteResult {
  success: boolean
  operation: 'hard_delete_all' | 'hard_delete_network_scope'
  source: EquipmentLifecycleSource
  deletedCount: number
  /** Set for `hard_delete_network_scope`. */
  networkId?: string
  errors: string[]
  warnings: string[]
  updatedAt: string
}

/**
 * Hard-delete one saved device by canonical `id`. Map layout rows for that node are removed by the
 * persistence helper (legacy behavior). Missing id → validation error; missing row → `deleted: false`.
 */
export function mutateLifecycleDeleteDeviceById(
  db: Database.Database,
  deviceId: string,
  source: EquipmentLifecycleSource
): LifecycleDeleteSingleResult {
  const updatedAt = new Date().toISOString()
  const targetId = deviceId.trim()
  const base: LifecycleDeleteSingleResult = {
    success: false,
    operation: 'hard_delete_single',
    source,
    targetId,
    deleted: false,
    deletedDeviceIds: [],
    errors: [],
    warnings: [],
    updatedAt
  }

  if (!targetId) {
    return { ...base, errors: ['Device id is required.'] }
  }

  const existed = getDeviceById(db, targetId) != null
  const deleted = persistDeleteDeviceById(db, targetId)

  if (!existed && !deleted) {
    return {
      ...base,
      success: true,
      deleted: false,
      warnings: ['No device row matched this id; nothing removed.']
    }
  }

  return {
    ...base,
    success: true,
    deleted,
    deletedDeviceIds: deleted ? [targetId] : [],
    warnings: deleted ? [] : ['Delete reported no row removed.']
  }
}

/** Hard-delete every device row (all networks) and all map layout state. */
export function mutateLifecycleDeleteAllDevices(
  db: Database.Database,
  source: EquipmentLifecycleSource
): LifecycleBulkDeleteResult {
  const updatedAt = new Date().toISOString()
  const deletedCount = persistDeleteAllDevices(db)
  return {
    success: true,
    operation: 'hard_delete_all',
    source,
    deletedCount,
    errors: [],
    warnings: [],
    updatedAt
  }
}

/** Hard-delete devices tagged with the given `network_id` and map layout for that network. */
export function mutateLifecycleDeleteDevicesForNetwork(
  db: Database.Database,
  networkId: string,
  source: EquipmentLifecycleSource
): LifecycleBulkDeleteResult {
  const updatedAt = new Date().toISOString()
  const nid = networkId.trim()
  if (!nid) {
    return {
      success: false,
      operation: 'hard_delete_network_scope',
      source,
      deletedCount: 0,
      errors: ['networkId is required for scoped delete.'],
      warnings: [],
      updatedAt
    }
  }

  const deletedCount = persistDeleteDevicesByNetworkId(db, nid)
  return {
    success: true,
    operation: 'hard_delete_network_scope',
    source,
    deletedCount,
    networkId: nid,
    errors: [],
    warnings: [],
    updatedAt
  }
}
