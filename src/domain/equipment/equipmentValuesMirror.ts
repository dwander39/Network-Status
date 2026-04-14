/**
 * Canonical JSON mirror for `devices.equipment_values_json` (write-through; columns authoritative).
 *
 * **Guarded JSON-read experiment:** {@link parseEquipmentValuesMirrorJson} / {@link runEquipmentMirrorJsonReadExperiment}
 * parse persisted text for maintenance comparison only — never a substitute for `Device` → projection.
 *
 * **Opt-in hydration (still non-authoritative):** {@link hydrateLegacyDeviceScopedValuesFromMirror} /
 * {@link resolveEquipmentRuntimeProjectionWithJsonHydrationExperiment} validate mirror `values` and build a projection-like
 * shape; they always fall back to {@link mapDeviceToEquipmentRuntime} when anything fails.
 */

import type { Device, EquipmentMirrorJsonReadExperiment, EquipmentRuntimeReadSource } from '@shared/types'
import {
  LEGACY_DEVICE_RUNTIME_VALUE_KEYS,
  mapDeviceToEquipmentRuntime,
  type EquipmentRuntimeProjection,
  type LegacyDeviceScopedValues
} from './deviceEquipmentAdapter'

export const EQUIPMENT_VALUES_MIRROR_VERSION = 1 as const

/** Same payload shape as write-through mirror updates and startup backfill. */
export function serializeEquipmentValuesMirrorPayload(device: Device): string {
  const { values } = mapDeviceToEquipmentRuntime(device)
  return JSON.stringify({ v: EQUIPMENT_VALUES_MIRROR_VERSION, values })
}

export interface EquipmentMirrorCompareResult {
  match: boolean
  reason?: string
}

type ParseMirrorOk = { ok: true; version: number; values: LegacyDeviceScopedValues }
type ParseMirrorErr = { ok: false; reason: string }

/**
 * Parse persisted mirror JSON (guarded read). Does not consult `Device`; use only for experiments/diagnostics.
 */
export function parseEquipmentValuesMirrorJson(
  storedJson: string | null | undefined
): ParseMirrorOk | ParseMirrorErr {
  if (storedJson == null || String(storedJson).trim() === '') {
    return { ok: false, reason: 'missing_or_empty_mirror' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(storedJson.trim())
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || !('values' in parsed)) {
    return { ok: false, reason: 'malformed_mirror_shape' }
  }
  const rec = parsed as Record<string, unknown>
  const v = rec.v
  const values = rec.values
  if (typeof v !== 'number' || v !== EQUIPMENT_VALUES_MIRROR_VERSION) {
    return { ok: false, reason: 'version_mismatch' }
  }
  if (typeof values !== 'object' || values === null) {
    return { ok: false, reason: 'malformed_values' }
  }
  return { ok: true, version: v, values: values as LegacyDeviceScopedValues }
}

function isEquipmentFieldValueLike(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return false
  const t = (x as { type?: unknown }).type
  return typeof t === 'string'
}

/**
 * Strict structural check for mirror `values` (every legacy runtime key, object with string `type`, no extra keys).
 * Does not prove semantic correctness vs `Device` columns.
 */
export function validateLegacyDeviceScopedValuesShape(raw: unknown): LegacyDeviceScopedValues | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const allowed = new Set<string>(LEGACY_DEVICE_RUNTIME_VALUE_KEYS as readonly string[])
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) return null
  }
  for (const key of LEGACY_DEVICE_RUNTIME_VALUE_KEYS) {
    if (!isEquipmentFieldValueLike(o[key])) return null
  }
  return o as LegacyDeviceScopedValues
}

/**
 * Parse + validate mirror JSON into a `LegacyDeviceScopedValues` bag. Never throws.
 */
export function hydrateLegacyDeviceScopedValuesFromMirror(
  storedJson: string | null | undefined
): { ok: true; values: LegacyDeviceScopedValues } | { ok: false; reason: string } {
  const parsed = parseEquipmentValuesMirrorJson(storedJson)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  const shaped = validateLegacyDeviceScopedValuesShape(parsed.values as unknown)
  if (!shaped) return { ok: false, reason: 'values_shape_invalid' }
  return { ok: true, values: shaped }
}

/**
 * Opt-in experiment: use hydrated mirror values when valid; otherwise identical to {@link mapDeviceToEquipmentRuntime}.
 * Columns / `Device` remain authoritative; JSON path is explicitly marked in `_projection` and `readSource`.
 */
export function resolveEquipmentRuntimeProjectionWithJsonHydrationExperiment(
  device: Device,
  storedJson: string | null | undefined
): { projection: EquipmentRuntimeProjection; readSource: EquipmentRuntimeReadSource } {
  const hydrated = hydrateLegacyDeviceScopedValuesFromMirror(storedJson)
  if (!hydrated.ok) {
    return { projection: mapDeviceToEquipmentRuntime(device), readSource: 'device_columns' }
  }
  return {
    projection: {
      id: device.id,
      values: hydrated.values,
      _projection: { source: 'json_mirror_experiment', phase: 1 }
    },
    readSource: 'json_mirror_experiment'
  }
}

/** Stable JSON for comparing two value bags (sorted object keys recursively). */
function stableStringifyForCompare(x: unknown): string {
  if (x === null || typeof x !== 'object') {
    return JSON.stringify(x)
  }
  if (Array.isArray(x)) {
    return `[${x.map((e) => stableStringifyForCompare(e)).join(',')}]`
  }
  const o = x as Record<string, unknown>
  const keys = Object.keys(o).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringifyForCompare(o[k])}`).join(',')}}`
}

export function canonicalEquipmentValuesEqual(
  a: LegacyDeviceScopedValues,
  b: LegacyDeviceScopedValues
): boolean {
  return stableStringifyForCompare(a) === stableStringifyForCompare(b)
}

/**
 * Guarded experiment: parse mirror JSON, optionally compare parsed `values` to live projection from authoritative `Device`.
 * If `device` is null, only parsing runs; `parsedValuesMatchLiveProjection` is false.
 */
export function runEquipmentMirrorJsonReadExperiment(
  storedJson: string | null | undefined,
  device: Device | null
): EquipmentMirrorJsonReadExperiment {
  const parsed = parseEquipmentValuesMirrorJson(storedJson)
  if (!parsed.ok) {
    return {
      mirrorParseOk: false,
      parseFailureReason: parsed.reason,
      parsedValuesMatchLiveProjection: false
    }
  }
  if (!device) {
    return {
      mirrorParseOk: true,
      mirrorVersion: parsed.version,
      parsedValuesMatchLiveProjection: false
    }
  }
  const live = mapDeviceToEquipmentRuntime(device).values
  return {
    mirrorParseOk: true,
    mirrorVersion: parsed.version,
    parsedValuesMatchLiveProjection: canonicalEquipmentValuesEqual(parsed.values, live)
  }
}

/**
 * Compare stored mirror text to a fresh projection from authoritative `Device` (no DB I/O).
 * Safe on null/empty/malformed JSON.
 */
export function compareEquipmentMirrorStoredToDevice(
  storedJson: string | null | undefined,
  device: Device
): EquipmentMirrorCompareResult {
  const expected = serializeEquipmentValuesMirrorPayload(device)
  if (storedJson == null || String(storedJson).trim() === '') {
    return { match: false, reason: 'missing_or_empty_mirror' }
  }
  const trimmed = storedJson.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || !('values' in parsed)) {
      return { match: false, reason: 'malformed_mirror_shape' }
    }
  } catch {
    return { match: false, reason: 'invalid_json' }
  }
  if (trimmed === expected) return { match: true }
  return { match: false, reason: 'payload_mismatch' }
}
