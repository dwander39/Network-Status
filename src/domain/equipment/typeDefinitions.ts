import type { EquipmentTypeKey } from './types'

/** Lightweight profile only — no hooks, no validation engines. */
export interface EquipmentTypeDefinition {
  key: string
  label: string
  description?: string
  baseFamily: EquipmentTypeKey
  defaultFieldKeys: string[]
  requiredFieldKeys: string[]
}
