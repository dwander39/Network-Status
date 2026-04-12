/**
 * Example static registry — merge with project-defined rows at runtime.
 * Applicability follows mandatory order in `fieldDefinitions.ts`.
 */

import type { FieldDefinition } from './fieldDefinitions'
import type { EquipmentTypeDefinition } from './typeDefinitions'

export const EXAMPLE_FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    fieldKey: 'management_ip',
    label: 'Management IP',
    dataType: 'text',
    ownership: 'user',
    editability: 'editable',
    appliesToFamilies: ['network'],
    allowNull: false,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    groupKey: 'network',
    groupLabel: 'Network',
    sortOrder: 10,
  },
  {
    fieldKey: 'discovered_hostname',
    label: 'Discovered hostname',
    dataType: 'text',
    ownership: 'system',
    editability: 'readOnly',
    appliesToFamilies: ['network'],
    allowNull: true,
    visibleInInspector: true,
    visibleInTable: true,
    filterable: true,
    sortable: true,
    groupKey: 'network',
    sortOrder: 20,
  },
  {
    fieldKey: 'asset_notes',
    label: 'Asset notes',
    dataType: 'multiline_text',
    ownership: 'user',
    editability: 'editable',
    appliesToAll: true,
    allowNull: true,
    maxLength: 8000,
    visibleInInspector: true,
    visibleInTable: false,
    filterable: false,
    sortable: false,
    groupKey: 'general',
    groupLabel: 'General',
    sortOrder: 100,
  },
]

export const EXAMPLE_EQUIPMENT_TYPE_DEFINITIONS: EquipmentTypeDefinition[] = [
  {
    key: 'wireless_ap',
    label: 'Wireless access point',
    baseFamily: 'network',
    defaultFieldKeys: ['management_ip', 'asset_notes'],
    requiredFieldKeys: ['management_ip'],
  },
  {
    key: 'media_server',
    label: 'Media server',
    baseFamily: 'video',
    defaultFieldKeys: ['asset_notes'],
    requiredFieldKeys: ['name'],
  },
]
