/**
 * Phase 2C.2 — marquee selection in flow coordinates.
 *
 * - Devices: intersection based (partial overlap).
 * - Manual groups: optional higher-level target (see `pickManualGroupTargetInRect`).
 */

import type { Node, XYPosition } from '@xyflow/react'

import { MAP_GATEWAY_NODE_ID } from './flowIds'
import { absoluteNodePosition } from './mapLayoutGeometry'

/** Fallback size when RF has not measured the node yet (matches card CSS ballpark). */
const DEVICE_FALLBACK_W = 180
const DEVICE_FALLBACK_H = 116
const GROUP_FALLBACK_W = 380
const GROUP_FALLBACK_H = 220

export interface FlowRect {
  x: number
  y: number
  width: number
  height: number
}

export type MarqueeHitMode = 'intersect' | 'contain'

export function normalizeFlowRect(a: XYPosition, b: XYPosition): FlowRect {
  const x1 = Math.min(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const x2 = Math.max(a.x, b.x)
  const y2 = Math.max(a.y, b.y)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function axisAlignedIntersect(a: FlowRect, b: FlowRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function axisAlignedContains(container: FlowRect, inner: FlowRect): boolean {
  return (
    inner.x >= container.x &&
    inner.y >= container.y &&
    inner.x + inner.width <= container.x + container.width &&
    inner.y + inner.height <= container.y + container.height
  )
}

function intersectionArea(a: FlowRect, b: FlowRect): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const w = x2 - x1
  const h = y2 - y1
  if (w <= 0 || h <= 0) return 0
  return w * h
}

function deviceFlowBounds(node: Node, byId: Map<string, Node>): FlowRect {
  const pos = absoluteNodePosition(node, byId)
  const w = node.measured?.width ?? node.width ?? DEVICE_FALLBACK_W
  const h = node.measured?.height ?? node.height ?? DEVICE_FALLBACK_H
  return { x: pos.x, y: pos.y, width: w, height: h }
}

/** Device node ids whose bounds intersect `rect` (partial overlap). */
export function deviceIdsInFlowRect(nodes: readonly Node[], rect: FlowRect, mode: MarqueeHitMode): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: string[] = []
  for (const n of nodes) {
    if (n.type !== 'device') continue
    const b = deviceFlowBounds(n, byId)
    const ok = mode === 'contain' ? axisAlignedContains(rect, b) : axisAlignedIntersect(rect, b)
    if (ok) out.push(n.id)
  }
  return out
}

function manualGroupFlowBounds(node: Node): FlowRect {
  const pos = node.position
  const w =
    (typeof (node.style as { width?: unknown } | undefined)?.width === 'number'
      ? ((node.style as { width: number }).width as number)
      : undefined) ??
    (node.data && typeof (node.data as { width?: unknown }).width === 'number'
      ? (node.data as { width: number }).width
      : undefined) ??
    GROUP_FALLBACK_W
  const h =
    (typeof (node.style as { height?: unknown } | undefined)?.height === 'number'
      ? ((node.style as { height: number }).height as number)
      : undefined) ??
    (node.data && typeof (node.data as { height?: unknown }).height === 'number'
      ? (node.data as { height: number }).height
      : undefined) ??
    GROUP_FALLBACK_H
  return { x: pos.x, y: pos.y, width: w, height: h }
}

function rectContainsPoint(r: FlowRect, p: XYPosition): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

function manualGroupMarqueeCandidates(
  nodes: readonly Node[],
  rect: FlowRect,
  mode: MarqueeHitMode
): { id: string; ratio: number; fullySelected: boolean }[] {
  const out: { id: string; ratio: number; fullySelected: boolean }[] = []
  for (const n of nodes) {
    if (n.type !== 'manualGroup') continue
    const gb = manualGroupFlowBounds(n)
    const fullySelected = axisAlignedContains(rect, gb)
    const hit = mode === 'contain' ? fullySelected : axisAlignedIntersect(rect, gb)
    if (!hit) continue
    const area = gb.width * gb.height
    const inter = intersectionArea(rect, gb)
    const ratio = area > 0 ? inter / area : 0
    const center = { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 }
    const meaningful = rectContainsPoint(rect, center) || ratio >= 0.18 || fullySelected
    if (!meaningful) continue
    out.push({ id: n.id, ratio, fullySelected })
  }
  return out
}

/**
 * All manual groups meaningfully hit by the marquee (overlap / enclosure rules).
 * Sorted by overlap ratio descending, then id (stable).
 */
export function pickManualGroupIdsInRect(
  nodes: readonly Node[],
  rect: FlowRect,
  mode: MarqueeHitMode
): string[] {
  const c = manualGroupMarqueeCandidates(nodes, rect, mode)
  c.sort((a, b) => b.ratio - a.ratio || a.id.localeCompare(b.id))
  return c.map((x) => x.id)
}

/**
 * Manual group target for marquee.
 *
 * Rule (predictable, Phase 2C.2 stabilization):
 * - We consider a group “meaningfully targeted” if the marquee either contains its center point OR
 *   overlaps at least ~18% of the group area.
 * - If multiple qualify, pick the one with the highest overlap ratio.
 */
export function pickManualGroupTargetInRect(
  nodes: readonly Node[],
  rect: FlowRect,
  mode: MarqueeHitMode
): { id: string; fullySelected: boolean } | null {
  const c = manualGroupMarqueeCandidates(nodes, rect, mode)
  let best: (typeof c)[0] | null = null
  for (const x of c) {
    if (!best || x.ratio > best.ratio) best = x
  }
  return best ? { id: best.id, fullySelected: best.fullySelected } : null
}

/** True if the gateway node’s bounds intersect/contain per `mode`. */
export function gatewayInFlowRect(
  nodes: readonly Node[],
  rect: FlowRect,
  mode: MarqueeHitMode
): boolean {
  const gw = nodes.find((n) => n.type === 'gateway' || n.id === MAP_GATEWAY_NODE_ID)
  if (!gw) return false
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const b = deviceFlowBounds(gw, byId)
  return mode === 'contain' ? axisAlignedContains(rect, b) : axisAlignedIntersect(rect, b)
}
