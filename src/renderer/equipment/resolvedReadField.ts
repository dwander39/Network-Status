import type { EquipmentFieldValue } from '../../domain/equipment/valueTypes'

/**
 * Minimal shared read-resolution unit: one logical row’s projected input(s) vs UI-ready display.
 * Not a field-definition contract — no editability, provenance, or override layers.
 *
 * For legacy device-backed rows, `fieldKey` should use literals from
 * {@link LegacyDeviceEquipmentFieldKey} (`src/domain/equipment/legacyFieldKeyBridge.ts`) so read
 * resolution stays aligned with runtime projection and future `FieldDefinition.fieldKey` values.
 */
export interface ResolvedReadField {
  fieldKey: string
  raw?: EquipmentFieldValue
  displayValue: string
  isVisible: boolean
}

/**
 * Map inspector static rows — keys match `LegacyDeviceEquipmentFieldKey` / runtime projection.
 * The **Type** row is keyed `deviceType` (display still composes `deviceTypeCustom`).
 */
export type MapInspectorStaticResolvedFieldKey =
  | 'name'
  | 'ip'
  | 'macAddress'
  | 'subnet'
  | 'gateway'
  | 'groupName'
  | 'groupId'
  | 'deviceType'
  | 'deviceTypeCustom'
  | 'vendor'
  | 'lastStatus'
  | 'lastChecked'

export type MapInspectorStaticResolvedFields = Record<MapInspectorStaticResolvedFieldKey, ResolvedReadField>
