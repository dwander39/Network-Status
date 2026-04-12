import type { Equipment } from './types'
import type { EquipmentFieldValue } from './valueTypes'

export type EquipmentPatchOperation = 'set' | 'clear' | 'setOverride' | 'clearOverride'

export interface EquipmentFieldPatch {
  fieldKey: string
  operation: EquipmentPatchOperation
  value?: EquipmentFieldValue
}

export interface CreateEquipmentCommand {
  id?: string
  projectId: string
  typeKey: Equipment['typeKey']
  equipmentTypeDefKey: string
  name: string
  displayName?: string
  values?: Record<string, EquipmentFieldValue>
  createdBy: string
}

export interface UpdateEquipmentCommand {
  equipmentId: string
  projectId: string
  patches: EquipmentFieldPatch[]
  updatedBy: string
}

export interface DeleteEquipmentCommand {
  equipmentId: string
  projectId: string
}

/**
 * Explicit type change; does not delete prior `values`. Non-applicable fields remain stored but
 * marked in warnings; callers run completeness checks against new `requiredFieldKeys`.
 */
export interface ReclassifyEquipmentCommand {
  equipmentId: string
  projectId: string
  nextTypeKey: Equipment['typeKey']
  nextEquipmentTypeDefKey: string
  updatedBy: string
}

export interface AppliedEquipmentPatch {
  fieldKey: string
  operation: EquipmentPatchOperation
  previousSnapshot?: unknown
  newSnapshot?: unknown
}

export interface RejectedEquipmentPatch {
  fieldKey: string
  operation: EquipmentPatchOperation
  reason: string
  code?: string
}

export interface UpdateEquipmentResult {
  success: boolean
  equipment?: Equipment
  appliedPatches: AppliedEquipmentPatch[]
  rejectedPatches: RejectedEquipmentPatch[]
  errors: string[]
  warnings: string[]
  updatedAt: string
}

export interface ReclassifyEquipmentResult extends UpdateEquipmentResult {
  /** Field keys that no longer apply under new type (values retained on disk). */
  inapplicableFieldKeys?: string[]
}

/**
 * System and user override stores are persisted separately from `Equipment.values` so effective
 * resolution can be `override ?? system ?? raw` without losing source fidelity.
 * (SQLite shape is deferred; this is the domain contract.)
 */
export interface EquipmentSystemFieldStore {
  equipmentId: string
  projectId: string
  entries: Record<string, EquipmentFieldValue>
}

export interface EquipmentOverrideFieldStore {
  equipmentId: string
  projectId: string
  entries: Record<string, EquipmentFieldValue>
}

/**
 * Per-field mutation pipeline (each patch independent — partial success):
 * 1. Resolve FieldDefinition
 * 2. Check applicability (static rules)
 * 3. Check ownership / editability for operation
 * 4. Validate type + constraints
 * 5. Normalize
 * 6. Persist to values, system store, or override store as appropriate
 * 7. Update core row timestamps / actor ids
 */
export interface EquipmentMutationService {
  createEquipment(command: CreateEquipmentCommand): Promise<UpdateEquipmentResult>
  updateEquipment(command: UpdateEquipmentCommand): Promise<UpdateEquipmentResult>
  deleteEquipment(command: DeleteEquipmentCommand): Promise<void>
  reclassifyEquipment(command: ReclassifyEquipmentCommand): Promise<ReclassifyEquipmentResult>
}
