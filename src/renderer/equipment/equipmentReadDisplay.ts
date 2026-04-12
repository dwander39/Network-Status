/**
 * Equipment read layer: runtime projection → display-ready strings and row flags.
 *
 * **Static map inspector** uses a single resolver-oriented entry point:
 * {@link resolveMapInspectorStaticReadModel}. It keeps raw {@link EquipmentRuntimeProjection}
 * separate from resolved row labels so this surface can evolve toward shared `ResolvedField`-style
 * models without ad-hoc helpers per row.
 */

import type { Device, DeviceType } from '@shared/types'
import { getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import { showDeviceTypeCustomField } from '@shared/deviceSaveValidation'
import {
  mapDeviceToEquipmentRuntime,
  type EquipmentRuntimeProjection,
  type LegacyDeviceScopedValues
} from '../../domain/equipment/deviceEquipmentAdapter'
import type { EquipmentFieldValue } from '../../domain/equipment/valueTypes'

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

function resolveGroupRowDisplay(values: LegacyDeviceScopedValues): string {
  return displayFromProjectedValue(values.groupName)
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

/**
 * Resolved read model for static (read-only) map inspector rows backed by the equipment runtime
 * projection. `runtime` holds raw inputs; other fields are surface-resolved display/visibility.
 */
export interface MapInspectorStaticResolvedRead {
  runtime: EquipmentRuntimeProjection
  name: string
  ip: string
  macAddress: string
  subnet: string
  gateway: string
  vendor: string
  typeDisplay: string
  groupDisplay: string
  customTypeRowVisible: boolean
  customTypeDisplay: string
  lastStatus: string
  lastChecked: string
  groupId: string
}

/**
 * Single read-resolution step for the static map inspector: one `Device` in, projection + resolved
 * row strings/flags out. Does not cover layout-only rows (e.g. map canvas group).
 */
export function resolveMapInspectorStaticReadModel(device: Device): MapInspectorStaticResolvedRead {
  const runtime = mapDeviceToEquipmentRuntime(device)
  const { values } = runtime
  return {
    runtime,
    name: displayFromProjectedValue(values.name),
    ip: displayFromProjectedValue(values.ip),
    macAddress: displayFromProjectedValue(values.macAddress),
    subnet: displayFromProjectedValue(values.subnet),
    gateway: displayFromProjectedValue(values.gateway),
    vendor: displayFromProjectedValue(values.vendor),
    typeDisplay: resolveTypeRowDisplay(values, device),
    groupDisplay: resolveGroupRowDisplay(values),
    customTypeRowVisible: resolveCustomTypeRowVisible(values, device),
    customTypeDisplay: resolveCustomTypeRowDisplay(values),
    lastStatus: displayFromProjectedValue(values.lastStatus),
    lastChecked: displayFromProjectedValue(values.lastChecked),
    groupId: displayFromProjectedValue(values.groupId)
  }
}
