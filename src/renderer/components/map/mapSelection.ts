/**
 * Phase 2C.1 — canonical Map View selection (runtime only).
 *
 * - Not tied to persistence, undo/redo, or viewport — MapCanvas owns React state and syncs `node.selected`.
 * - Model is a tagged union so future multi-select can extend without breaking call sites.
 */

import type { Node } from '@xyflow/react'

import { MAP_GATEWAY_NODE_ID } from './flowIds'
import type { MapAutoGroupMode } from './mapAutoLayout'
import { parseAutoGroupNodeId } from './mapAutoLayout'

/** Same enum as auto-group layout modes; explicit alias for selection semantics. */
export type MapAutoGroupBy = MapAutoGroupMode

export type MapLayoutModeTag = 'manual' | MapAutoGroupMode

export type MapSelection =
  | { kind: 'none' }
  | { kind: 'device'; deviceId: string }
  | { kind: 'manual-group'; groupId: string }
  | { kind: 'auto-group'; groupKey: string; autoGroupBy: MapAutoGroupBy }

export const initialMapSelection: MapSelection = { kind: 'none' }

export function clearSelection(): MapSelection {
  return { kind: 'none' }
}

export function selectDevice(deviceId: string): MapSelection {
  return { kind: 'device', deviceId }
}

export function selectManualGroup(groupId: string): MapSelection {
  return { kind: 'manual-group', groupId }
}

export function selectAutoGroup(groupKey: string, autoGroupBy: MapAutoGroupBy): MapSelection {
  return { kind: 'auto-group', groupKey, autoGroupBy }
}

/**
 * When layout mode changes: drop manual-group in auto modes, auto-group in manual,
 * and auto-group when the grouping dimension changes (vendor vs subnet).
 */
export function reconcileSelectionForLayoutMode(
  selection: MapSelection,
  layoutMode: MapLayoutModeTag
): MapSelection {
  if (selection.kind === 'none' || selection.kind === 'device') return selection
  if (selection.kind === 'manual-group') {
    if (layoutMode !== 'manual') return clearSelection()
    return selection
  }
  if (selection.kind === 'auto-group') {
    if (layoutMode === 'manual') return clearSelection()
    if (layoutMode !== selection.autoGroupBy) return clearSelection()
    return selection
  }
  return selection
}

export function selectionStillValidForDevices(selection: MapSelection, deviceIds: ReadonlySet<string>): boolean {
  if (selection.kind !== 'device') return true
  return deviceIds.has(selection.deviceId)
}

export function selectionStillValidForManualGroups(
  selection: MapSelection,
  groupIds: ReadonlySet<string>
): boolean {
  if (selection.kind !== 'manual-group') return true
  return groupIds.has(selection.groupId)
}

/** Whether this node should show selected chrome for the current canonical selection. */
export function nodeMatchesMapSelection(
  node: Node,
  selection: MapSelection,
  layoutMode: MapLayoutModeTag
): boolean {
  if (selection.kind === 'none') return false
  if (node.id === MAP_GATEWAY_NODE_ID) return false

  if (selection.kind === 'device') {
    return node.type === 'device' && node.id === selection.deviceId
  }
  if (selection.kind === 'manual-group') {
    return layoutMode === 'manual' && node.type === 'manualGroup' && node.id === selection.groupId
  }
  if (selection.kind === 'auto-group') {
    if (layoutMode === 'manual' || layoutMode !== selection.autoGroupBy) return false
    if (node.type !== 'autoGroup') return false
    const parsed = parseAutoGroupNodeId(node.id)
    return (
      parsed != null &&
      parsed.groupKey === selection.groupKey &&
      parsed.autoGroupBy === selection.autoGroupBy
    )
  }
  return false
}
