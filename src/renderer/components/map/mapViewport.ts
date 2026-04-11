import type { CoordinateExtent, Rect } from '@xyflow/system'
import type { MapSelection } from './mapSelection'
import { MAP_GATEWAY_NODE_ID } from './flowIds'
import { autoGroupNodeId, type MapAutoGroupMode } from './mapAutoLayout'

/** Padding (flow coordinates) added around the union of all node bounds for `translateExtent`. */
export const MAP_TRANSLATE_EXTENT_MARGIN_FLOW = 520

/**
 * Minimum half-width and half-height (flow coordinates) of the translate extent rectangle,
 * centered on content so sparse maps still allow comfortable panning.
 */
export const MAP_TRANSLATE_EXTENT_MIN_HALF = 960

/** Default zoom after “Reset zoom” (100%). */
export const MAP_DEFAULT_ZOOM = 1

export type MapLayoutModeForViewport = 'manual' | MapAutoGroupMode

/**
 * Derive pan limits from current node bounds: content bbox + margin, then enforce a minimum world floor.
 * Returns a `CoordinateExtent` for React Flow `translateExtent`.
 */
export function computeMapTranslateExtent(contentBounds: Rect): CoordinateExtent {
  const floor = (): CoordinateExtent => {
    const h = MAP_TRANSLATE_EXTENT_MIN_HALF
    return [
      [-h, -h],
      [h, h]
    ]
  }

  if (
    !Number.isFinite(contentBounds.width) ||
    !Number.isFinite(contentBounds.height) ||
    contentBounds.width < 4 ||
    contentBounds.height < 4
  ) {
    return floor()
  }

  const m = MAP_TRANSLATE_EXTENT_MARGIN_FLOW
  let minX = contentBounds.x - m
  let minY = contentBounds.y - m
  let maxX = contentBounds.x + contentBounds.width + m
  let maxY = contentBounds.y + contentBounds.height + m

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const halfW = Math.max((maxX - minX) / 2, MAP_TRANSLATE_EXTENT_MIN_HALF)
  const halfH = Math.max((maxY - minY) / 2, MAP_TRANSLATE_EXTENT_MIN_HALF)

  return [
    [cx - halfW, cy - halfH],
    [cx + halfW, cy + halfH]
  ]
}

/**
 * Node ids to include when centering / fitting the viewport to the current canonical selection.
 */
export function mapSelectionToViewportNodeIds(
  sel: MapSelection,
  layoutMode: MapLayoutModeForViewport
): string[] {
  switch (sel.kind) {
    case 'none':
      return []
    case 'device':
      return [sel.deviceId]
    case 'gateway':
      return [MAP_GATEWAY_NODE_ID]
    case 'manual-group':
      return layoutMode === 'manual' ? [sel.groupId] : []
    case 'auto-group':
      return layoutMode !== 'manual' ? [autoGroupNodeId(sel.autoGroupBy, sel.groupKey)] : []
    case 'multi': {
      const ids = [...sel.deviceIds]
      if (sel.manualGroupIds?.length) ids.push(...sel.manualGroupIds)
      if (sel.includeGateway) ids.push(MAP_GATEWAY_NODE_ID)
      return ids
    }
  }
}
