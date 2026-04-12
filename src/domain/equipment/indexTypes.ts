/**
 * Derived index only — rebuild from equipment + field definitions. Not authoritative.
 *
 * Extraction (target): text, enum, number, boolean, reference only, with normalization:
 * - text → lowercase + trim
 * - enum → raw string
 * - number → numeric
 * - boolean → boolean
 * - reference → id string
 */

export interface EquipmentIndexEntry {
  equipmentId: string
  projectId: string
  searchableText: string
  sortableValues: Record<string, string | number | boolean | null>
  filterableValues: Record<string, string | number | boolean | null>
  derivedAt: string
}
