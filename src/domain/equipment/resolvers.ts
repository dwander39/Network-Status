import type { FieldDefinition } from './fieldDefinitions'
import type { EquipmentOverrideFieldStore, EquipmentSystemFieldStore } from './mutations'
import type { Equipment } from './types'
import type { EquipmentTypeDefinition } from './typeDefinitions'
import type { EquipmentFieldValue } from './valueTypes'

export interface EquipmentFieldRegistry {
  getFieldDefinition(fieldKey: string): FieldDefinition | undefined
  listFieldDefinitions(): FieldDefinition[]
  getEquipmentTypeDefinition(defKey: string): EquipmentTypeDefinition | undefined
  listEquipmentTypeDefinitions(): EquipmentTypeDefinition[]
}

/**
 * Read model for inspector, spreadsheet, forms. Preserves raw vs effective vs sources.
 */
export interface ResolvedField {
  fieldKey: string
  definition: FieldDefinition
  ownership: FieldDefinition['ownership']
  editability: FieldDefinition['editability']
  applicable: boolean
  /** User/dynamic persisted value from `Equipment.values` when present. */
  rawValue?: EquipmentFieldValue
  /** System-sourced persisted value when present (discovery, sync). */
  systemValue?: EquipmentFieldValue
  /** User override when `editability === 'overrideable'`. */
  overrideValue?: EquipmentFieldValue
  /** What UI should show: override ?? system ?? raw ?? default/computed. */
  effectiveValue?: EquipmentFieldValue
  isOverride: boolean
  isComputed: boolean
  validationErrors?: string[]
}

export interface ResolveEquipmentFieldsOptions {
  includeNonApplicable?: boolean
}

export type ResolveEquipmentFieldsFn = (
  equipment: Equipment,
  system: EquipmentSystemFieldStore | null,
  overrides: EquipmentOverrideFieldStore | null,
  registry: EquipmentFieldRegistry,
  options?: ResolveEquipmentFieldsOptions
) => ResolvedField[]

/** Pure, deterministic: no I/O, no mutation of input equipment. */
export type ResolveEquipmentFields = ResolveEquipmentFieldsFn
