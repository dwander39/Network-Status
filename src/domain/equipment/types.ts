/**
 * Canonical equipment entity (target). Core columns only; all extension metadata in `values`.
 *
 * Migration note: today’s `Device` embeds network fields and status on the row; those become
 * `values` + resolver/computed or system fields during migration.
 */

import type { EquipmentFieldValue } from './valueTypes'

export type EquipmentTypeKey =
  | 'network'
  | 'lighting'
  | 'audio'
  | 'video'
  | 'power'
  | 'control'
  | 'custom'

export type FieldOwnership = 'user' | 'system' | 'computed'

/** `overrideable`: user may supply override; effective = override ?? system ?? stored. */
export type FieldEditability = 'editable' | 'readOnly' | 'overrideable'

export type FieldDataType = EquipmentFieldValue['type']

export interface Equipment {
  id: string
  projectId: string
  typeKey: EquipmentTypeKey
  equipmentTypeDefKey: string
  name: string
  displayName?: string
  values: Record<string, EquipmentFieldValue>
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  archivedAt?: string
}
