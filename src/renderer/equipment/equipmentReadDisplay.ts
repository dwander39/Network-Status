/**
 * Equipment read layer: runtime projection → display-ready strings and row flags.
 *
 * **Static map inspector** uses {@link resolveMapInspectorStaticReadModel}: raw {@link EquipmentRuntimeProjection}
 * plus {@link MapInspectorStaticResolvedFields} built from shared {@link ResolvedReadField} units.
 * Field keys align with `LegacyDeviceEquipmentFieldKey` and {@link getLegacyProjectionFieldValue}.
 * Static row **labels** for legacy-backed fields use {@link mapInspectorStaticLabelFromLegacyDefinition}
 * (read-only metadata from `LEGACY_DEVICE_FIELD_DEFINITIONS`; values still from resolved read).
 */

import type { Device, DeviceType } from '@shared/types'
import { getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import { showDeviceTypeCustomField } from '@shared/deviceSaveValidation'
import {
  mapDeviceToEquipmentRuntime,
  type EquipmentRuntimeProjection,
  type LegacyDeviceScopedValues
} from '../../domain/equipment/deviceEquipmentAdapter'
import { getLegacyDeviceFieldDefinition } from '../../domain/equipment/legacyDeviceFieldDefinitions'
import {
  getLegacyProjectionFieldValue,
  type LegacyDeviceEquipmentFieldKey
} from '../../domain/equipment/legacyFieldKeyBridge'
import type { EquipmentFieldValue } from '../../domain/equipment/valueTypes'
import type {
  MapInspectorStaticResolvedFieldKey,
  MapInspectorStaticResolvedFields,
  ResolvedReadField
} from './resolvedReadField'

const PLACEHOLDER_EMPTY = '—'

/** Placeholder-aware string for a single projected value (absence vs empty text). */
function displayFromProjectedValue(
  v: EquipmentFieldValue,
  emptyLabel: string = PLACEHOLDER_EMPTY
): string {
  if (v.type === 'json' && v.value === null) return emptyLabel
  switch (v.type) {
    case 'text':
      return v.value.trim() !== '' ? v.value : emptyLabel
    case 'enum':
      return v.value
    case 'datetime': {
      const t = v.value.trim()
      if (!t) return emptyLabel
      try {
        return new Date(t).toLocaleString()
      } catch {
        return t
      }
    }
    case 'reference': {
      const id = v.value.trim()
      return id !== '' ? id : emptyLabel
    }
    default:
      return emptyLabel
  }
}

function rf(
  key: MapInspectorStaticResolvedFieldKey,
  partial: Omit<ResolvedReadField, 'fieldKey'>
): ResolvedReadField {
  return { fieldKey: key, ...partial }
}

type SimpleLegacyInspectorKey =
  | 'name'
  | 'ip'
  | 'macAddress'
  | 'subnet'
  | 'gateway'
  | 'groupName'
  | 'groupId'
  | 'vendor'
  | 'lastStatus'
  | 'lastChecked'

function simpleLegacyInspectorField(key: SimpleLegacyInspectorKey, values: LegacyDeviceScopedValues): ResolvedReadField {
  const raw = getLegacyProjectionFieldValue(values, key)
  return rf(key, { raw, displayValue: displayFromProjectedValue(raw), isVisible: true })
}

function effectiveDeviceType(values: LegacyDeviceScopedValues, device: Device): DeviceType {
  return values.deviceType.type === 'enum' ? (values.deviceType.value as DeviceType) : device.deviceType
}

function resolveTypeRowDisplay(values: LegacyDeviceScopedValues, device: Device): string {
  const deviceType = effectiveDeviceType(values, device)
  const customFromProjection =
    values.deviceTypeCustom.type === 'text' && values.deviceTypeCustom.value.trim() !== ''
      ? values.deviceTypeCustom.value.trim()
      : null
  return getDeviceTypeDisplayLabel({ deviceType, deviceTypeCustom: customFromProjection })
}

function resolveCustomTypeRowVisible(values: LegacyDeviceScopedValues, device: Device): boolean {
  const deviceType = effectiveDeviceType(values, device)
  const deviceTypeCustom =
    values.deviceTypeCustom.type === 'text' ? values.deviceTypeCustom.value : null
  return showDeviceTypeCustomField({ deviceType, deviceTypeCustom })
}

function resolveCustomTypeRowDisplay(values: LegacyDeviceScopedValues): string {
  return displayFromProjectedValue(values.deviceTypeCustom)
}

function buildStaticResolvedFields(
  values: LegacyDeviceScopedValues,
  device: Device
): MapInspectorStaticResolvedFields {
  const typeDisplay = resolveTypeRowDisplay(values, device)
  const customVisible = resolveCustomTypeRowVisible(values, device)
  const customDisplay = resolveCustomTypeRowDisplay(values)
  const deviceTypeRaw = getLegacyProjectionFieldValue(values, 'deviceType')
  const deviceTypeCustomRaw = getLegacyProjectionFieldValue(values, 'deviceTypeCustom')

  return {
    name: simpleLegacyInspectorField('name', values),
    ip: simpleLegacyInspectorField('ip', values),
    macAddress: simpleLegacyInspectorField('macAddress', values),
    subnet: simpleLegacyInspectorField('subnet', values),
    gateway: simpleLegacyInspectorField('gateway', values),
    groupName: simpleLegacyInspectorField('groupName', values),
    groupId: simpleLegacyInspectorField('groupId', values),
    vendor: simpleLegacyInspectorField('vendor', values),
    lastStatus: simpleLegacyInspectorField('lastStatus', values),
    lastChecked: simpleLegacyInspectorField('lastChecked', values),
    deviceType: rf('deviceType', {
      raw: deviceTypeRaw,
      displayValue: typeDisplay,
      isVisible: true
    }),
    deviceTypeCustom: rf('deviceTypeCustom', {
      raw: deviceTypeCustomRaw,
      displayValue: customDisplay,
      isVisible: customVisible
    })
  }
}

/**
 * Resolved read model for static (read-only) map inspector rows backed by the equipment runtime
 * projection. `runtime` holds raw inputs; `fields` holds shared {@link ResolvedReadField} units.
 */
export interface MapInspectorStaticResolvedRead {
  runtime: EquipmentRuntimeProjection
  fields: MapInspectorStaticResolvedFields
}

/**
 * Single read-resolution step for the static map inspector: one `Device` in, projection + resolved
 * fields out. Does not cover layout-only rows (e.g. map canvas group).
 */
export function resolveMapInspectorStaticReadModel(device: Device): MapInspectorStaticResolvedRead {
  const runtime = mapDeviceToEquipmentRuntime(device)
  const { values } = runtime
  return {
    runtime,
    fields: buildStaticResolvedFields(values, device)
  }
}

/**
 * Label text for a static map inspector row backed by a legacy field definition.
 * Does not affect display values, visibility, or formatting — {@link getLegacyDeviceFieldDefinition} only.
 */
export function mapInspectorStaticLabelFromLegacyDefinition(
  fieldKey: LegacyDeviceEquipmentFieldKey,
  fallbackLabel: string
): string {
  return getLegacyDeviceFieldDefinition(fieldKey)?.label ?? fallbackLabel
}
