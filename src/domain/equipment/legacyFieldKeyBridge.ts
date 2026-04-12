/**
 * Phase-1 bridge between legacy `Device` runtime projection and domain field identity.
 *
 * - `LegacyDeviceEquipmentFieldKey` is the canonical string set for SQLite-backed device columns
 *   in the equipment domain; concrete metadata lives in `legacyDeviceFieldDefinitions.ts` (still
 *   non-authoritative for runtime until resolvers are activated).
 * - {@link getLegacyProjectionFieldValue} is the thin read-only accessor from `values` by key.
 *
 * Not a resolver: no FieldDefinition lookup, overrides, or write path.
 */

import type { LegacyDeviceScopedValues, LegacyDeviceRuntimeValueKey } from './deviceEquipmentAdapter'
import type { EquipmentFieldValue } from './valueTypes'

/** Domain-level alias: runtime projection keys for the legacy device row. */
export type LegacyDeviceEquipmentFieldKey = LegacyDeviceRuntimeValueKey

export function getLegacyProjectionFieldValue(
  values: LegacyDeviceScopedValues,
  fieldKey: LegacyDeviceEquipmentFieldKey
): EquipmentFieldValue {
  return values[fieldKey]
}
