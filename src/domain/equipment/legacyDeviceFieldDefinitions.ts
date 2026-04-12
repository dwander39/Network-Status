/**
 * Concrete `FieldDefinition` rows for legacy SQLite `Device` columns that already flow through
 * `mapDeviceToEquipmentRuntime` and the read bridge (`LegacyDeviceEquipmentFieldKey`).
 *
 * **Partially authoritative:** static map inspector row labels for these keys may be read via
 * `mapInspectorStaticLabelFromLegacyDefinition` (renderer). Projection, mutations, and resolved
 * display values still do not use this registry; resolvers and full field-driven UI remain future work.
 */

import { DEVICE_TYPE_CUSTOM_MAX_LEN } from '@shared/deviceTypeDisplay'
import type { FieldDefinition } from './fieldDefinitions'
import type { LegacyDeviceEquipmentFieldKey } from './legacyFieldKeyBridge'

const GROUP = { groupKey: 'legacy_device', groupLabel: 'Device' } as const

/**
 * Field keys and `dataType` values match the runtime projection (`EquipmentFieldValue` shapes).
 */
export const LEGACY_DEVICE_FIELD_DEFINITIONS = [
  {
    fieldKey: 'name',
    label: 'Name',
    dataType: 'text',
    ownership: 'user',
    editability: 'editable',
    appliesToAll: true,
    allowNull: false,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 10
  },
  {
    fieldKey: 'ip',
    label: 'IP address',
    dataType: 'text',
    ownership: 'user',
    editability: 'editable',
    appliesToAll: true,
    allowNull: false,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 20
  },
  {
    fieldKey: 'macAddress',
    label: 'MAC address',
    dataType: 'text',
    ownership: 'system',
    editability: 'readOnly',
    appliesToAll: true,
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 30
  },
  {
    fieldKey: 'subnet',
    label: 'Subnet mask',
    dataType: 'text',
    ownership: 'user',
    editability: 'editable',
    appliesToAll: true,
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 40
  },
  {
    fieldKey: 'gateway',
    label: 'Gateway',
    dataType: 'text',
    ownership: 'user',
    editability: 'editable',
    appliesToAll: true,
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 50
  },
  {
    fieldKey: 'groupName',
    label: 'Group',
    description: 'Joined list-group name from device_groups.',
    dataType: 'text',
    ownership: 'system',
    editability: 'readOnly',
    appliesToAll: true,
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 55
  },
  {
    fieldKey: 'groupId',
    label: 'Group ID',
    dataType: 'reference',
    ownership: 'user',
    editability: 'editable',
    appliesToAll: true,
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 58
  },
  {
    fieldKey: 'deviceType',
    label: 'Device type',
    dataType: 'enum',
    ownership: 'system',
    editability: 'readOnly',
    appliesToAll: true,
    allowNull: false,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 60
  },
  {
    fieldKey: 'deviceTypeCustom',
    label: 'Custom type',
    dataType: 'text',
    ownership: 'user',
    editability: 'editable',
    appliesToAll: true,
    allowNull: true,
    maxLength: DEVICE_TYPE_CUSTOM_MAX_LEN,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 65
  },
  {
    fieldKey: 'vendor',
    label: 'Vendor',
    dataType: 'text',
    ownership: 'system',
    editability: 'readOnly',
    appliesToAll: true,
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 70
  },
  {
    fieldKey: 'lastStatus',
    label: 'Status',
    dataType: 'enum',
    ownership: 'system',
    editability: 'readOnly',
    appliesToAll: true,
    allowNull: false,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 80
  },
  {
    fieldKey: 'lastChecked',
    label: 'Last checked',
    dataType: 'datetime',
    ownership: 'system',
    editability: 'readOnly',
    appliesToAll: true,
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    ...GROUP,
    sortOrder: 90
  }
] as const satisfies readonly FieldDefinition[]

/** Mutable copy where callers need a `FieldDefinition[]` (e.g. merging registries). */
export const legacyDeviceFieldDefinitionsList: FieldDefinition[] = [...LEGACY_DEVICE_FIELD_DEFINITIONS]

export function getLegacyDeviceFieldDefinition(
  fieldKey: LegacyDeviceEquipmentFieldKey
): FieldDefinition | undefined {
  return LEGACY_DEVICE_FIELD_DEFINITIONS.find((d) => d.fieldKey === fieldKey)
}
