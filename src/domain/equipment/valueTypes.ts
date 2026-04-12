/**
 * Transitional / target domain layer (migration in progress).
 *
 * Runtime IPC still uses `Device` + `SaveDevicePayload`; the main process routes saves through
 * `equipmentMutationService.applyUserSaveDevicePayload` (single orchestration path). Typed
 * `values` persistence is not live yet.
 */

/** Persisted dynamic field payload; `type` must match `FieldDefinition.dataType`. */
export type EquipmentFieldValue =
  | { type: 'text'; value: string }
  | { type: 'multiline_text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'integer'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'datetime'; value: string }
  | { type: 'enum'; value: string }
  | { type: 'multi_enum'; value: string[] }
  | { type: 'url'; value: string }
  | { type: 'email'; value: string }
  | { type: 'phone'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'reference'; value: string }
