/**
 * Phase 2C.1 / 2C.2 — canonical Map View selection (runtime only).
 *
 * - Not tied to persistence, undo/redo, or viewport — MapCanvas owns React state and syncs `node.selected`.
 * - Model is a tagged union; multi-device selection is manual-layout + marquee only for now.
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
  /**
   * Phase 2C.2+ — multi selection.
   * `manualGroupIds` is only produced by the unlocked-group marquee “group + contents” gesture.
   */
  | { kind: 'multi'; deviceIds: string[]; manualGroupIds?: string[] }
  | { kind: 'manual-group'; groupId: string }
  | { kind: 'auto-group'; groupKey: string; autoGroupBy: MapAutoGroupBy }

export const initialMapSelection: MapSelection = { kind: 'none' }

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort()
}

export function clearSelection(): MapSelection {
  return { kind: 'none' }
}

export function selectDevice(deviceId: string): MapSelection {
  return { kind: 'device', deviceId }
}

/** Marquee / programmatic multi-select (devices only). */
export function selectDevicesMulti(deviceIds: readonly string[]): MapSelection {
  const u = sortedUnique(deviceIds)
  if (u.length === 0) return clearSelection()
  if (u.length === 1) return selectDevice(u[0]!)
  return { kind: 'multi', deviceIds: u }
}

/** Very tight-scope mixed selection: one or more groups + devices (used only by unlocked-group marquee). */
export function selectMixedDevicesAndGroups(
  deviceIds: readonly string[],
  manualGroupIds: readonly string[]
): MapSelection {
  const ds = sortedUnique(deviceIds)
  const gs = sortedUnique(manualGroupIds)
  if (ds.length === 0 && gs.length === 0) return clearSelection()
  if (gs.length === 0) return selectDevicesMulti(ds)
  if (ds.length === 1 && gs.length === 0) return selectDevice(ds[0]!)
  return { kind: 'multi', deviceIds: ds, manualGroupIds: gs }
}

export function selectManualGroup(groupId: string): MapSelection {
  return { kind: 'manual-group', groupId }
}

export function selectAutoGroup(groupKey: string, autoGroupBy: MapAutoGroupBy): MapSelection {
  return { kind: 'auto-group', groupKey, autoGroupBy }
}

/**
 * Apply marquee result: replace selection, or add to existing device selection when `additive`.
 */
export function applyMarqueeDeviceSelection(
  current: MapSelection,
  pickedIds: readonly string[],
  additive: boolean
): MapSelection {
  const picked = sortedUnique(pickedIds)
  if (!additive) return selectDevicesMulti(picked)

  const base: string[] = []
  if (current.kind === 'device') base.push(current.deviceId)
  else if (current.kind === 'multi') base.push(...current.deviceIds)
  return selectDevicesMulti([...base, ...picked])
}

/**
 * When layout mode changes: drop manual-group in auto modes, auto-group in manual,
 * auto-group when the grouping dimension changes; multi only valid in manual.
 */
export function reconcileSelectionForLayoutMode(
  selection: MapSelection,
  layoutMode: MapLayoutModeTag
): MapSelection {
  if (selection.kind === 'none' || selection.kind === 'device') return selection
  if (selection.kind === 'multi') {
    if (layoutMode !== 'manual') return clearSelection()
    return selection
  }
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
  if (selection.kind === 'device') return deviceIds.has(selection.deviceId)
  if (selection.kind === 'multi') return selection.deviceIds.every((id) => deviceIds.has(id))
  return true
}

export function selectionStillValidForManualGroups(
  selection: MapSelection,
  groupIds: ReadonlySet<string>
): boolean {
  if (selection.kind === 'manual-group') return groupIds.has(selection.groupId)
  if (selection.kind === 'multi' && selection.manualGroupIds?.length) {
    return selection.manualGroupIds.every((id) => groupIds.has(id))
  }
  return true
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
  if (selection.kind === 'multi') {
    if (node.type === 'device') return selection.deviceIds.includes(node.id)
    if (layoutMode === 'manual' && node.type === 'manualGroup' && selection.manualGroupIds?.length) {
      return selection.manualGroupIds.includes(node.id)
    }
    return false
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

export function mapSelectionDeviceCount(selection: MapSelection): number {
  if (selection.kind === 'device') return 1
  if (selection.kind === 'multi') return selection.deviceIds.length
  return 0
}

export function mapSelectionManualGroupCount(selection: MapSelection): number {
  if (selection.kind === 'manual-group') return 1
  if (selection.kind === 'multi') return selection.manualGroupIds?.length ?? 0
  return 0
}
