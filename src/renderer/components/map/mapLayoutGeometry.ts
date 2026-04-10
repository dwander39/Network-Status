/**
 * Pure helpers for manual map layout (positions, group hit-test, post-drag membership).
 * Used by MapView persistence and undo/redo: `patch*` helpers apply inverse/forward layout deltas
 * without storing whole graph snapshots — keep deterministic and side-effect free.
 */

import type { Node, XYPosition } from '@xyflow/react'

export function absoluteNodePosition(node: Node, byId: Map<string, Node>): XYPosition {
  let x = node.position.x
  let y = node.position.y
  let cur: Node | undefined = node
  while (cur?.parentId) {
    const p = byId.get(cur.parentId)
    if (!p) break
    x += p.position.x
    y += p.position.y
    cur = p
  }
  return { x, y }
}

export function pickManualGroupForDrop(intersecting: Node[]): Node | null {
  const groups = intersecting.filter((n) => n.type === 'manualGroup')
  if (groups.length === 0) return null
  if (groups.length === 1) return groups[0]!
  return groups.reduce((a, b) => {
    const aw = (a.width ?? 400) * (a.height ?? 300)
    const bw = (b.width ?? 400) * (b.height ?? 300)
    return aw <= bw ? a : b
  })
}

/**
 * After a device drag, assign or clear `parentId` from intersection with manual group nodes.
 * Returns a new node array (immutable update).
 */
export function applyDeviceGroupDropResolution(
  nds: Node[],
  draggedDeviceId: string,
  getIntersectingNodes: (node: Node, partially?: boolean, nodes?: Node[]) => Node[]
): Node[] {
  const byId = new Map(nds.map((n) => [n.id, n]))
  const cur = byId.get(draggedDeviceId)
  if (!cur || cur.type !== 'device') return nds
  const abs = absoluteNodePosition(cur, byId)
  const curParent = cur.parentId ? byId.get(cur.parentId) : undefined
  const curLocked =
    curParent?.type === 'manualGroup' &&
    Boolean((curParent.data as { contentsLocked?: boolean } | undefined)?.contentsLocked)

  if (curLocked && curParent?.type === 'manualGroup') {
    /* Locked groups: devices must not change membership or position via this resolver (drag is disabled on the node). */
    return nds
  }

  const rawHit = pickManualGroupForDrop(getIntersectingNodes(cur, true, nds))
  const hitParent = rawHit?.type === 'manualGroup' ? rawHit : null
  const hitLocked = Boolean(
    (hitParent?.data as { contentsLocked?: boolean } | undefined)?.contentsLocked ?? false
  )

  // Locked groups are protected containers: devices cannot be added/removed via drag.
  const hit =
    hitParent && hitLocked && curParent?.type !== 'manualGroup'
      ? null
      : hitParent && hitLocked && curParent?.type === 'manualGroup' && curParent.id !== hitParent.id
        ? null
        : hitParent
  const next = nds.map((n) => (n.id === cur.id ? { ...n } : n))
  const target = next.find((n) => n.id === cur.id)
  if (!target || target.type !== 'device') return nds

  if (hit) {
    // Unlocked or same-group move: allow assign.
    target.parentId = hit.id
    target.position = { x: abs.x - hit.position.x, y: abs.y - hit.position.y }
    return next
  }

  // No hit and not locked: allow ungroup.
  target.parentId = undefined
  target.position = abs
  return next
}

/** Manual group id if parent is a manual group, else null. */
export function deviceManualGroupId(node: Node, byId: Map<string, Node>): string | null {
  const parent = node.parentId ? byId.get(node.parentId) : undefined
  return parent?.type === 'manualGroup' ? parent.id : null
}

export interface DeviceLayoutSnap {
  manualGroupId: string | null
  abs: XYPosition
}

export function snapDeviceLayout(node: Node, byId: Map<string, Node>): DeviceLayoutSnap {
  return {
    manualGroupId: deviceManualGroupId(node, byId),
    abs: absoluteNodePosition(node, byId)
  }
}

const EPS = 1e-4

export function sameXY(a: XYPosition, b: XYPosition): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

export function sameDeviceLayout(a: DeviceLayoutSnap, b: DeviceLayoutSnap): boolean {
  return a.manualGroupId === b.manualGroupId && sameXY(a.abs, b.abs)
}

/** Apply absolute position + optional manual group membership; returns new nodes array. */
export function patchDeviceLayout(
  nds: Node[],
  deviceId: string,
  target: DeviceLayoutSnap
): Node[] {
  const byId = new Map(nds.map((n) => [n.id, n]))
  const next = nds.map((n) => ({ ...n }))
  const idx = next.findIndex((n) => n.id === deviceId && n.type === 'device')
  if (idx < 0) return nds
  const node = next[idx]!
  if (target.manualGroupId) {
    const g = next.find((n) => n.id === target.manualGroupId && n.type === 'manualGroup')
    if (!g) {
      node.parentId = undefined
      node.position = { ...target.abs }
      return next
    }
    node.parentId = g.id
    node.position = { x: target.abs.x - g.position.x, y: target.abs.y - g.position.y }
  } else {
    node.parentId = undefined
    node.position = { ...target.abs }
  }
  return next
}

export function patchManualGroupPosition(nds: Node[], groupId: string, pos: XYPosition): Node[] {
  return nds.map((n) =>
    n.id === groupId && n.type === 'manualGroup' ? { ...n, position: { ...pos } } : n
  )
}

export function patchGatewayPosition(nds: Node[], gatewayId: string, pos: XYPosition): Node[] {
  return nds.map((n) => (n.id === gatewayId ? { ...n, position: { ...pos } } : n))
}
