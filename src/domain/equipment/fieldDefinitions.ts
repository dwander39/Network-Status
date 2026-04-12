import type { EquipmentTypeKey } from './types'
import type { FieldDataType, FieldEditability, FieldOwnership } from './types'

export interface FieldEnumOption {
  value: string
  label: string
}

/**
 * Static applicability only (v1). Resolution order (mandatory):
 * 1. If `appliesToEquipmentTypeDefKeys` is defined and non-empty → use ONLY that list.
 * 2. Else if `appliesToFamilies` is defined and non-empty → use that.
 * 3. Else if `appliesToAll` is true → global.
 * 4. Else → invalid definition (must not register).
 *
 * Requiredness for completeness is NOT on this type; use `EquipmentTypeDefinition.requiredFieldKeys`.
 */
/**
 * Registry `fieldKey` strings are domain-owned. For legacy `Device` columns, prefer the same string
 * literals as runtime projection keys (see `legacyFieldKeyBridge.ts`) until a naming migration is intentional.
 */
export interface FieldDefinition {
  fieldKey: string
  label: string
  description?: string
  dataType: FieldDataType
  ownership: FieldOwnership
  editability: FieldEditability
  appliesToAll?: boolean
  appliesToFamilies?: EquipmentTypeKey[]
  appliesToEquipmentTypeDefKeys?: string[]

  allowNull: boolean
  defaultValue?: unknown
  min?: number
  max?: number
  maxLength?: number
  pattern?: string
  enumOptions?: FieldEnumOption[]

  visibleInInspector: boolean
  visibleInTable: boolean
  filterable: boolean
  sortable: boolean
  groupKey?: string
  groupLabel?: string
  sortOrder?: number
}
