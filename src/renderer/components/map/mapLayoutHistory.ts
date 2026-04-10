/**
 * Command-based undo/redo for manual Map View layout only.
 *
 * Undo/redo flow (MapCanvas):
 * - `pushMapHistory(cmd)` → `undoStack.push`, `redoStack` cleared (new work invalidates redo).
 * - `handleMapUndo` → `pop undoStack`, `await cmd.undo()`, `redoStack.push`, then `schedulePersistRef`.
 * - `handleMapRedo` → symmetric with `cmd.redo()`.
 *
 * Each entry is `{ type, undo, redo }` — no full graph snapshots; callbacks patch React Flow nodes
 * and/or call existing map IPC, then rely on debounced `saveMapLayout` for positions.
 *
 * Limited to Manual layout: `canRecordHistoryRef` gates push/pop/shortcuts; auto-group modes never
 * mutate stacks (see MapView).
 */

export interface MapLayoutCommand {
  /** Identifier for debugging / future telemetry */
  readonly type: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}
