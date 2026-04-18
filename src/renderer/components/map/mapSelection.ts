/**
 * Phase 2C.1 / 2C.2 — canonical Map View selection (runtime only).
 *
 * - Not tied to persistence, undo/redo, or viewport — MapCanvas owns React state and syncs `node.selected`.
 * - Model is a tagged union; multi selection is manual-layout + marquee (+ Shift additive).
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
  /** Router/gateway card on the map (single node id). */
  | { kind: 'gateway' }
  /**
   * Multi selection: devices, optional manual groups, optional gateway together.
   * `includeGateway` is set when the gateway is part of the same marquee / additive merge.
   */
  | { kind: 'multi'; deviceIds: string[]; manualGroupIds?: string[]; includeGateway?: boolean }
  | { kind: 'manual-group'; groupId: string }
  | { kind: 'auto-group'; groupKey: string; autoGroupBy: MapAutoGroupBy }

export const initialMapSelection: MapSelection = { kind: 'none' }

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort()
}

/** True if device is a child of a manual group whose contents are locked (default: locked when flag missing). */
export function deviceChildOfLockedManualGroup(node: Node, allNodes: readonly Node[]): boolean {
  if (node.type !== 'device' || !node.parentId) return false
  const p = allNodes.find((n) => n.id === node.parentId && n.type === 'manualGroup')
  if (!p) return false
  return Boolean((p.data as { contentsLocked?: boolean } | undefined)?.contentsLocked ?? true)
}

export function clearSelection(): MapSelection {
  return { kind: 'none' }
}

/**
 * Device/equipment ids derived from a map selection (empty when none or no devices).
 * Map View must not treat an empty result as a signal to clear shared selection unless `sel.kind === 'none'`.
 */
export function mapSelectionToSharedEquipmentIds(sel: MapSelection): Set<string> {
  if (sel.kind === 'device') return new Set([sel.deviceId])
  if (sel.kind === 'multi') return new Set(sel.deviceIds)
  return new Set()
}

export function selectDevice(deviceId: string): MapSelection {
  return { kind: 'device', deviceId }
}

export function selectGateway(): MapSelection {
  return { kind: 'gateway' }
}

/** Marquee / programmatic multi-select (devices only). */
export function selectDevicesMulti(deviceIds: readonly string[]): MapSelection {
  const u = sortedUnique(deviceIds)
  if (u.length === 0) return clearSelection()
  if (u.length === 1) return selectDevice(u[0]!)
  return { kind: 'multi', deviceIds: u }
}

/**
 * Collapse to the smallest accurate `MapSelection` shape (single kinds vs `multi`).
 * `includeGateway` may coexist with devices and/or groups.
 */
function toMixedOrSingleSelection(
  deviceIds: readonly string[],
  groupIds: readonly string[],
  includeGateway: boolean
): MapSelection {
  const d = sortedUnique(deviceIds)
  const g = sortedUnique(groupIds)

  if (!includeGateway && d.length === 0 && g.length === 0) return clearSelection()
  if (includeGateway && d.length === 0 && g.length === 0) return selectGateway()

  const partCount = d.length + g.length + (includeGateway ? 1 : 0)
  if (partCount === 1) {
    if (d.length === 1) return selectDevice(d[0]!)
    if (g.length === 1) return selectManualGroup(g[0]!)
    return selectGateway()
  }

  return {
    kind: 'multi',
    deviceIds: d,
    manualGroupIds: g.length > 0 ? g : undefined,
    includeGateway: includeGateway ? true : undefined
  }
}

/** Mixed selection: one or more groups + devices (+ optional gateway). */
export function selectMixedDevicesAndGroups(
  deviceIds: readonly string[],
  manualGroupIds: readonly string[],
  options?: { includeGateway?: boolean }
): MapSelection {
  return toMixedOrSingleSelection(deviceIds, manualGroupIds, Boolean(options?.includeGateway))
}

export function selectManualGroup(groupId: string): MapSelection {
  return { kind: 'manual-group', groupId }
}

export function selectAutoGroup(groupKey: string, autoGroupBy: MapAutoGroupBy): MapSelection {
  return { kind: 'auto-group', groupKey, autoGroupBy }
}

/**
 * Apply marquee hit lists: replace selection, or merge with current when `additive` (Shift).
 * Preserves groups, devices, and gateway across additive merges.
 */
export function applyMarqueeMapSelection(
  current: MapSelection,
  picks: { devices: string[]; groups: string[]; gateway: boolean },
  additive: boolean
): MapSelection {
  const d = sortedUnique(picks.devices)
  const g = sortedUnique(picks.groups)
  const gw = picks.gateway

  if (!additive) {
    return toMixedOrSingleSelection(d, g, gw)
  }

  const baseD: string[] = []
  const baseG: string[] = []
  let baseGw = false

  if (current.kind === 'device') baseD.push(current.deviceId)
  else if (current.kind === 'gateway') baseGw = true
  else if (current.kind === 'manual-group') baseG.push(current.groupId)
  else if (current.kind === 'multi') {
    baseD.push(...current.deviceIds)
    baseG.push(...(current.manualGroupIds ?? []))
    baseGw = Boolean(current.includeGateway)
  }

  return toMixedOrSingleSelection(
    sortedUnique([...baseD, ...d]),
    sortedUnique([...baseG, ...g]),
    baseGw || gw
  )
}

/**
 * When layout mode changes: drop manual-group in auto modes, auto-group in manual,
 * auto-group when the grouping dimension changes; multi only valid in manual.
 */
export function reconcileSelectionForLayoutMode(
  selection: MapSelection,
  layoutMode: MapLayoutModeTag
): MapSelection {
  if (selection.kind === 'none' || selection.kind === 'device' || selection.kind === 'gateway') return selection
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
  if (selection.kind === 'gateway') return true
  if (selection.kind === 'device') return deviceIds.has(selection.deviceId)
  if (selection.kind === 'multi') return selection.deviceIds.every((id) => deviceIds.has(id))
  return true
}

export function selectionStillValidForManualGroups(
  selection: MapSelection,
  groupIds: ReadonlySet<string>
): boolean {
  if (selection.kind === 'gateway') return true
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
  layoutMode: MapLayoutModeTag,
  allNodes: readonly Node[]
): boolean {
  if (selection.kind === 'none') return false

  if (selection.kind === 'gateway') {
    return node.id === MAP_GATEWAY_NODE_ID && node.type === 'gateway'
  }

  if (selection.kind === 'device') {
    if (node.type !== 'device' || node.id !== selection.deviceId) return false
    if (deviceChildOfLockedManualGroup(node, allNodes)) return false
    return true
  }
  if (selection.kind === 'multi') {
    if (selection.includeGateway && (node.type === 'gateway' || node.id === MAP_GATEWAY_NODE_ID)) {
      return true
    }
    if (node.type === 'device') {
      if (deviceChildOfLockedManualGroup(node, allNodes)) return false
      return selection.deviceIds.includes(node.id)
    }
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

/** 1 when the gateway node is selected (alone or inside `multi`). */
export function mapSelectionGatewayCount(selection: MapSelection): number {
  if (selection.kind === 'gateway') return 1
  if (selection.kind === 'multi' && selection.includeGateway) return 1
  return 0
}
