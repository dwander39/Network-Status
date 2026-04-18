/**
 * Resolves a device trace handle anchor to flow-space coordinates (Step 13 endpoint geometry).
 * Queries the rendered `.map-device-node__snap-point` with matching data attributes under `rootEl`.
 */

export type FlowPoint = { x: number; y: number }

export function getTraceSnapAnchorFlowPosition(
  rootEl: HTMLElement,
  screenToFlow: (client: { x: number; y: number }) => FlowPoint,
  deviceId: string,
  snapPointId: string
): FlowPoint | null {
  const el = rootEl.querySelector(
    `.map-device-node__snap-point[data-device-id="${deviceId}"][data-snap-point-id="${snapPointId}"]`
  )
  if (!(el instanceof HTMLElement)) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  return screenToFlow({ x: cx, y: cy })
}
