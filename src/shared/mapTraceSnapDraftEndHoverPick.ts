/**
 * Draft-time end snap hover qualification (Step 2.3).
 *
 * Presentation / UX only — no commit behavior.
 *
 * Classification is explicit-endpoint driven:
 * - valid end candidate: same trace family + canonical destination snap id + different device than draft start
 * - invalid end candidate: same trace family snap under pointer, but not a valid direct end candidate
 * - neutral: no qualifying snap target under pointer (within proximity radius)
 */

import { getSnapIdentity, snapPointIdsForTraceConnection } from './mapDeviceSnapIdentity'
import type { MapManualTraceConnectionType } from './types'
import { MAP_TRACE_SNAP_HOVER_MAX_DIST_PX, type TraceSnapHoverTarget } from './mapTraceSnapHoverPick'

function distancePointToRect(px: number, py: number, r: DOMRect): number {
  const cx = Math.max(r.left, Math.min(px, r.right))
  const cy = Math.max(r.top, Math.min(py, r.bottom))
  return Math.hypot(px - cx, py - cy)
}

export type TraceDraftEndSnapHover =
  | { kind: 'neutral' }
  | { kind: 'validEnd'; target: TraceSnapHoverTarget }
  | { kind: 'invalidEnd'; target: TraceSnapHoverTarget }

function isValidDirectEndCandidate(args: {
  traceType: MapManualTraceConnectionType
  startDeviceId: string
  deviceId: string
  snapPointId: string
}): boolean {
  const meta = getSnapIdentity(args.snapPointId)
  if (!meta || meta.type !== args.traceType) return false
  const inferred = snapPointIdsForTraceConnection(args.traceType)
  if (args.snapPointId !== inferred.destinationSnapPointId) return false
  if (args.deviceId === args.startDeviceId) return false
  return true
}

/**
 * Pick the nearest visible snap under the pointer and classify it for draft-time end targeting.
 */
export function pickTraceDraftEndSnapHover(
  clientX: number,
  clientY: number,
  rootEl: HTMLElement,
  traceType: MapManualTraceConnectionType,
  startDeviceId: string,
  maxDistPx: number = MAP_TRACE_SNAP_HOVER_MAX_DIST_PX
): TraceDraftEndSnapHover {
  const nodes = rootEl.querySelectorAll('.map-device-node__snap-point[data-device-id][data-snap-point-id]')
  type Best = { deviceId: string; snapPointId: string; dist: number }
  let best: Best | null = null
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    const deviceId = node.dataset.deviceId
    const snapPointId = node.dataset.snapPointId
    if (!deviceId || !snapPointId) continue
    const meta = getSnapIdentity(snapPointId)
    if (!meta || meta.type !== traceType) continue
    const r = node.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const d = distancePointToRect(clientX, clientY, r)
    if (d > maxDistPx) continue
    if (!best || d < best.dist) best = { deviceId, snapPointId, dist: d }
  }
  if (best == null) return { kind: 'neutral' }
  const target: TraceSnapHoverTarget = { deviceId: best.deviceId, snapPointId: best.snapPointId }
  if (
    isValidDirectEndCandidate({
      traceType,
      startDeviceId,
      deviceId: best.deviceId,
      snapPointId: best.snapPointId
    })
  ) {
    return { kind: 'validEnd', target }
  }
  return { kind: 'invalidEnd', target }
}
