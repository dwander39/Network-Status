/**
 * Proximity pick for manual trace snap hover (POC). Presentation / UX only — no commit snapping.
 */

import { getSnapIdentity, snapPointIdsForTraceConnection } from './mapDeviceSnapIdentity'
import type { MapManualTraceConnectionType } from './types'

export const MAP_TRACE_SNAP_HOVER_MAX_DIST_PX = 36

function distancePointToRect(px: number, py: number, r: DOMRect): number {
  const cx = Math.max(r.left, Math.min(px, r.right))
  const cy = Math.max(r.top, Math.min(py, r.bottom))
  return Math.hypot(px - cx, py - cy)
}

export type TraceSnapHoverTarget = { deviceId: string; snapPointId: string }

/**
 * Nearest visible snap handle within `maxDistPx` that matches the active trace phase and type
 * (via canonical snap identity), searching under `rootEl`.
 *
 * @param traceSourceDeviceId `null` = before source selection; otherwise destination phase (excludes that device).
 */
export function pickTraceSnapHoverTarget(
  clientX: number,
  clientY: number,
  rootEl: HTMLElement,
  traceType: MapManualTraceConnectionType,
  traceSourceDeviceId: string | null,
  maxDistPx: number = MAP_TRACE_SNAP_HOVER_MAX_DIST_PX
): TraceSnapHoverTarget | null {
  const inferred = snapPointIdsForTraceConnection(traceType)
  const targetSnapId =
    traceSourceDeviceId != null ? inferred.destinationSnapPointId : inferred.sourceSnapPointId
  const wantMeta = getSnapIdentity(targetSnapId)
  if (!wantMeta || wantMeta.type !== traceType) return null

  const nodes = rootEl.querySelectorAll('.map-device-node__snap-point[data-device-id][data-snap-point-id]')
  type BestCandidate = { deviceId: string; snapPointId: string; dist: number }
  let best: BestCandidate | null = null
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    const deviceId = node.dataset.deviceId
    const snapPointId = node.dataset.snapPointId
    if (!deviceId || !snapPointId) continue
    if (snapPointId !== targetSnapId) continue
    if (traceSourceDeviceId != null && deviceId === traceSourceDeviceId) continue
    const meta = getSnapIdentity(snapPointId)
    if (!meta || meta.type !== traceType) continue
    const r = node.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const d = distancePointToRect(clientX, clientY, r)
    if (d > maxDistPx) continue
    if (!best || d < best.dist) {
      best = { deviceId, snapPointId, dist: d }
    }
  }
  if (best === null) return null
  return { deviceId: best.deviceId, snapPointId: best.snapPointId }
}
