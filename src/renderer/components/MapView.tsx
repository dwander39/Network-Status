import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type XYPosition
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  Device,
  DeviceGroup,
  MapLayoutBundle,
  MapLayoutSavePayload,
  MapLayoutSnapshot,
  MapManualGroup,
  MapManualTrace,
  MapManualTraceConnectionType,
  NetworkInfo,
  SaveDevicePayload
} from '@shared/types'
import { mapManualTraceKeyFromRow, mapManualTraceLogicalKey } from '@shared/mapManualTraceLogicalKey'
import {
  mapPocVisualDeviceTypeDefaultDeviceType,
  mapPocVisualDeviceTypeEmoji,
  mapPocVisualDeviceTypeLabel,
  type MapPocVisualDeviceType
} from '@shared/mapPocVisualDeviceTypes'
import { getSnapIdentity, inferSnapIdsForManualTrace } from '@shared/mapDeviceSnapPoints'
import {
  draftTracePathOverlayRootClassName,
  persistedManualTracePolylineClassName,
  traceFamilyToCssSuffix
} from '@shared/mapTraceFamilyVisual'
import { pickTraceSnapHoverTarget, type TraceSnapHoverTarget } from '@shared/mapTraceSnapHoverPick'
import {
  pickTraceDraftEndSnapHover,
  type TraceDraftEndSnapHover
} from '@shared/mapTraceSnapDraftEndHoverPick'
import { getTraceSnapAnchorFlowPosition } from '@shared/mapTraceSnapAnchorFlow'
import type { DeviceNodeData } from './map/DeviceNode'
import { useConfirmAction } from '../confirm/ConfirmDialogContext'
import { useSelectionState } from '../selection/SelectionStateContext'
import { logDeleteFlowPreDelete, recoverKeyboardAfterDestructiveAction } from '../utils/postDeleteFocusRecovery'
import { prepareAppWindowForKeyboardInput } from '../utils/ensureTextFieldFocus'
import { AutoGroupNode } from './map/AutoGroupNode'
import { DeviceNode } from './map/DeviceNode'
import { GatewayNode } from './map/GatewayNode'
import { MAP_GATEWAY_NODE_ID } from './map/flowIds'
import { ManualGroupNode } from './map/ManualGroupNode'
import { MapViewInspector } from './map/MapViewInspector'
import { buildAutoLayoutNodes, parseAutoGroupNodeId, type MapAutoGroupMode } from './map/mapAutoLayout'
import {
  applyMarqueeMapSelection,
  clearSelection,
  deviceChildOfLockedManualGroup,
  getDeviceIdsInMapGroup,
  initialMapSelection,
  mapSelectionToSharedEquipmentIds,
  mapSelectionDeviceCount,
  mapSelectionGatewayCount,
  mapSelectionManualGroupCount,
  nodeMatchesMapSelection,
  reconcileSelectionForLayoutMode,
  selectAutoGroup,
  selectDevice,
  selectDevicesMulti,
  selectGateway,
  selectMixedDevicesAndGroups,
  selectManualGroup,
  selectionStillValidForDevices,
  selectionStillValidForManualGroups,
  type MapSelection
} from './map/mapSelection'
import {
  deviceIdsInFlowRect,
  gatewayInFlowRect,
  normalizeFlowRect,
  pickManualGroupIdsInRect,
  type MarqueeHitMode,
  type FlowRect
} from './map/mapMarquee'
import {
  absoluteNodePosition,
  applyDeviceGroupDropResolution,
  patchDeviceLayout,
  patchGatewayPosition,
  patchManualGroupPosition,
  sameDeviceLayout,
  sameXY,
  snapDeviceLayout,
  type DeviceLayoutSnap
} from './map/mapLayoutGeometry'
import type { MapLayoutCommand } from './map/mapLayoutHistory'
import {
  computeMapTranslateExtent,
  MAP_DEFAULT_ZOOM,
  mapSelectionToViewportNodeIds
} from './map/mapViewport'

/** Persisted manual group minimum bounds (matches Auto size floor). */
const MANUAL_GROUP_MIN_W = 220
const MANUAL_GROUP_MIN_H = 140

export type GroupBounds = { x: number; y: number; width: number; height: number }

/** Manual trace POC: save / validation / IPC feedback (Step 14 — local banner only). */
type TracePocCommitFeedback =
  | null
  | { variant: 'success'; message: string }
  | { variant: 'invalid'; message: string }
  | { variant: 'error'; message: string }
  | { variant: 'info'; message: string }

function sameGroupBounds(a: GroupBounds, b: GroupBounds): boolean {
  return (
    sameXY({ x: a.x, y: a.y }, { x: b.x, y: b.y }) &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

/** Drop invalid RF resize payloads; clamp to persisted manual-group minimums. */
function sanitizeGroupBounds(raw: GroupBounds, minW: number, minH: number): GroupBounds | null {
  const x = Number(raw.x)
  const y = Number(raw.y)
  const wIn = Number(raw.width)
  const hIn = Number(raw.height)
  if (![x, y, wIn, hIn].every((n) => Number.isFinite(n))) return null
  return {
    x,
    y,
    width: Math.max(minW, wIn),
    height: Math.max(minH, hIn)
  }
}

/** Persisted map inspector inner width (px); handle adds 6px in grid column. */
const MAP_INSPECTOR_WIDTH_LS_KEY = 'system-status.mapInspectorInnerWidthPx'
const MAP_INSPECTOR_WIDTH_MIN = 260
const MAP_INSPECTOR_WIDTH_MAX = 520
const MAP_INSPECTOR_WIDTH_DEFAULT = 280

function readStoredMapInspectorWidth(): number {
  try {
    const raw = localStorage.getItem(MAP_INSPECTOR_WIDTH_LS_KEY)
    if (raw == null) return MAP_INSPECTOR_WIDTH_DEFAULT
    const n = Number(raw)
    if (!Number.isFinite(n)) return MAP_INSPECTOR_WIDTH_DEFAULT
    return Math.min(MAP_INSPECTOR_WIDTH_MAX, Math.max(MAP_INSPECTOR_WIDTH_MIN, Math.round(n)))
  } catch {
    return MAP_INSPECTOR_WIDTH_DEFAULT
  }
}

/** Subtle edge color: aligns with `.banner-current-profile` accent, not a new hue. */
const MAP_EDGE_STYLE: CSSProperties = {
  stroke: '#5e81ac',
  strokeWidth: 1.5,
  opacity: 0.85
}

const DEFAULT_NEW_GROUP_W = 380
const DEFAULT_NEW_GROUP_H = 220

/** Approximate manual `device` node size for viewport-centered POC placement (matches RF fallbacks). */
const POC_PLACEMENT_DEVICE_W = 180
const POC_PLACEMENT_DEVICE_H = 116
/**
 * POC-only burst offset (Step 7): repeated “Add Device” creates nudge in flow space so icons do not
 * stack; not a general placement engine. Resets after a short idle gap.
 */
const POC_CREATE_CASCADE_DX = 28
const POC_CREATE_CASCADE_DY = 20
const POC_CREATE_CASCADE_STEPS = 6
const POC_CREATE_CASCADE_RESET_AFTER_MS = 5000

const nodeTypes = {
  device: DeviceNode,
  gateway: GatewayNode,
  manualGroup: ManualGroupNode,
  autoGroup: AutoGroupNode
}

/** Manual = persisted SQLite layout; other values = ephemeral auto-group view only (see `mapAutoLayout.ts`). */
export type MapLayoutMode = 'manual' | MapAutoGroupMode

function defaultDevicePosition(index: number, total: number): XYPosition {
  const cols = Math.max(3, Math.ceil(Math.sqrt(Math.max(total, 1))))
  const col = index % cols
  const row = Math.floor(index / cols)
  return { x: 60 + col * 210, y: 340 + row * 132 }
}

/** Title/chrome band inside manual group nodes — used when auto-sizing / aligning children. */
const GROUP_LAYOUT_CHROME_PX = 52

/** Inset from group edges to device bounds after Auto size (flow coordinates, y=0 = top of group node). */
const AUTO_SIZE_EDGE_PAD_PX = 24
/** Matches `.map-manual-group__drag-surface` `margin-bottom` (`--space-px-4`). */
const AUTO_SIZE_DRAG_SURFACE_MARGIN_BOTTOM_PX = 4
/** Measured RF height can sit slightly under the painted card (border/shadow/subpixels). */
const AUTO_SIZE_DEVICE_BOUNDS_SLOP_PX = 4

function layoutDeviceMeasuredSize(n: Node): { w: number; h: number } {
  return {
    w: n.measured?.width ?? n.width ?? 180,
    h: n.measured?.height ?? n.height ?? 116
  }
}

/** Build IPC payload: absolute positions + membership; group bounds for SQLite `map_manual_groups`. */
function collectPersistPayload(nodes: Node[], networkId: string): MapLayoutSavePayload {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const positions: MapLayoutSavePayload['positions'] = []
  const manualGroupLayouts: NonNullable<MapLayoutSavePayload['manualGroupLayouts']> = []

  for (const n of nodes) {
    if (n.type === 'manualGroup') {
      const d = n.data as { name: string; width: number; height: number }
      manualGroupLayouts.push({
        id: n.id,
        name: d.name,
        x: n.position.x,
        y: n.position.y,
        width: d.width,
        height: d.height
      })
      continue
    }
    if (n.type === 'device') {
      const abs = absoluteNodePosition(n, byId)
      const parent = n.parentId ? byId.get(n.parentId) : undefined
      const manualGroupId = parent?.type === 'manualGroup' ? parent.id : null
      const dd = n.data as DeviceNodeData
      const row: MapLayoutSavePayload['positions'][number] = {
        nodeKey: n.id,
        x: abs.x,
        y: abs.y,
        manualGroupId
      }
      if (dd.mapManualLayout && dd.mapDeviceCollapsed) row.mapDeviceCollapsed = true
      positions.push(row)
      continue
    }
    if (n.type === 'gateway' || n.id === MAP_GATEWAY_NODE_ID) {
      const abs = absoluteNodePosition(n, byId)
      const parent = n.parentId ? byId.get(n.parentId) : undefined
      const manualGroupId = parent?.type === 'manualGroup' ? parent.id : null
      positions.push({ nodeKey: n.id, x: abs.x, y: abs.y, manualGroupId })
    }
  }

  return { networkId, positions, manualGroupLayouts }
}

// Note: `savedBundle` is treated as a view cache of the SQLite authoritative layout (GET_MAP_LAYOUT).
// Live interaction state stays in React Flow `nodes`; persisted truth comes from `getMapLayout` + invalidation.

interface GroupHandlers {
  commitRename: (id: string, name: string) => void
  deleteGroup: (id: string) => void
  onResizeSessionStart: (id: string) => void
  onResizeLive: (id: string, bounds: GroupBounds) => void
  onResizeSessionEnd: (id: string, bounds: GroupBounds) => void
}

interface DeviceLayoutHandlers {
  toggleCollapsed: (id: string) => void
}

function manualGroupBaseData(g: MapManualGroup, handlers: GroupHandlers) {
  return {
    name: g.name,
    width: g.width,
    height: g.height,
    contentsLocked: g.contentsLocked,
    onCommitRename: (nextName: string) => handlers.commitRename(g.id, nextName),
    onDelete: () => handlers.deleteGroup(g.id)
  }
}

function manualGroupFlowNodeFromRow(g: MapManualGroup, handlers: GroupHandlers): Node {
  const base = manualGroupBaseData(g, handlers)
  const data = g.contentsLocked
    ? base
    : {
        ...base,
        onResizeSessionStart: () => handlers.onResizeSessionStart(g.id),
        onResizeLive: (b: GroupBounds) => handlers.onResizeLive(g.id, b),
        onResizeSessionEnd: (b: GroupBounds) => handlers.onResizeSessionEnd(g.id, b)
      }
  return {
    id: g.id,
    type: 'manualGroup',
    position: { x: g.x, y: g.y },
    zIndex: 0,
    style: { width: g.width, height: g.height },
    dragHandle: '.map-manual-group__drag-surface',
    data,
    draggable: true,
    selectable: true
  }
}

type DragStartSnap =
  | { kind: 'device'; id: string; layout: DeviceLayoutSnap }
  | { kind: 'manualGroup'; id: string; pos: XYPosition }
  | { kind: 'gateway'; id: string; pos: XYPosition }

/**
 * Merges saved bundle + live `prev` so status refreshes do not reset layout (manual mode only).
 * Manual groups render behind devices (`zIndex`); membership comes from persisted `manualGroupId` only.
 * Auto-group modes use `buildAutoLayoutNodes` instead — never mix those nodes into this payload.
 */
function buildMapNodes(
  prev: Node[],
  devices: Device[],
  bundle: MapLayoutBundle,
  gatewayIp: string | null,
  handlers: GroupHandlers,
  deviceHandlers: DeviceLayoutHandlers,
  traceSnapHover: TraceSnapHoverTarget | null = null
): Node[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  const prevPos = new Map(prev.map((n) => [n.id, n.position]))
  const groupMap = new Map(bundle.manualGroups.map((g) => [g.id, g]))

  const gwSaved = bundle.positions[MAP_GATEWAY_NODE_ID]
  const gwPos =
    prevPos.get(MAP_GATEWAY_NODE_ID) ??
    (gwSaved ? { x: gwSaved.x, y: gwSaved.y } : { x: 400, y: 120 })

  const gatewayNode: Node = {
    id: MAP_GATEWAY_NODE_ID,
    type: 'gateway',
    position: gwPos,
    zIndex: 1,
    data: { gatewayIp },
    draggable: true,
    selectable: true
  }

  const groupNodes: Node[] = bundle.manualGroups.map((g) => {
    const base = manualGroupBaseData(g, handlers)
    const data = g.contentsLocked
      ? base
      : {
          ...base,
          onResizeSessionStart: () => handlers.onResizeSessionStart(g.id),
          onResizeLive: (b: GroupBounds) => handlers.onResizeLive(g.id, b),
          onResizeSessionEnd: (b: GroupBounds) => handlers.onResizeSessionEnd(g.id, b)
        }
    return {
      id: g.id,
      type: 'manualGroup',
      position: prevById.get(g.id)?.position ?? { x: g.x, y: g.y },
      zIndex: 0,
      style: { width: g.width, height: g.height },
      dragHandle: '.map-manual-group__drag-surface',
      data,
      draggable: true,
      selectable: true
    }
  })

  const deviceNodes: Node[] = []
  devices.forEach((d, idx) => {
    const rec = bundle.positions[d.id]
    const prevNode = prevById.get(d.id)
    const recParent =
      rec?.manualGroupId && groupMap.has(rec.manualGroupId) ? rec.manualGroupId : undefined
    const prevManualParent =
      prevNode?.type === 'device' && prevNode.parentId && groupMap.has(prevNode.parentId)
        ? prevNode.parentId
        : undefined

    /**
     * Membership:
     * - Persisted `manualGroupId` in the bundle is authoritative for restore/hydration (fixes first paint
     *   where `prev` was built before `getMapLayout` returned, or any transient ungrouped `prev`).
     * - Live manual parent wins when it disagrees with a stale bundle (e.g. moved to another group
     *   before debounced save + bundle refresh).
     * - Optimistic drag-in: `prevManualParent` set while `recParent` still null.
     */
    let targetParent: string | undefined
    if (recParent != null && prevManualParent != null && recParent !== prevManualParent) {
      targetParent = prevManualParent
    } else {
      targetParent = recParent ?? prevManualParent
    }

    const prevDev = prevNode?.type === 'device' ? (prevNode.data as DeviceNodeData) : undefined
    const mapDeviceCollapsed =
      prevDev?.mapDeviceCollapsed !== undefined
        ? prevDev.mapDeviceCollapsed
        : Boolean(rec?.mapDeviceCollapsed)
    const deviceData: DeviceNodeData = {
      device: d,
      mapManualLayout: true,
      mapDeviceCollapsed,
      onToggleMapDeviceCollapsed: () => deviceHandlers.toggleCollapsed(d.id),
      traceSnapHover
    }

    if (targetParent) {
      const g = groupMap.get(targetParent)!
      const lockedChild = Boolean(g.contentsLocked)
      let pos: XYPosition
      if (prevNode?.type === 'device' && prevNode.parentId === targetParent) {
        pos = prevNode.position
      } else {
        const ax = rec?.x ?? defaultDevicePosition(idx, devices.length).x
        const ay = rec?.y ?? defaultDevicePosition(idx, devices.length).y
        pos = { x: ax - g.x, y: ay - g.y }
      }
      deviceNodes.push({
        id: d.id,
        type: 'device',
        parentId: targetParent,
        position: pos,
        zIndex: 2,
        data: deviceData,
        draggable: !lockedChild,
        selectable: true
      })
    } else {
      let pos: XYPosition
      if (prevNode?.type === 'device') {
        pos = prevNode.position
      } else if (rec) {
        pos = { x: rec.x, y: rec.y }
      } else {
        pos = defaultDevicePosition(idx, devices.length)
      }
      deviceNodes.push({
        id: d.id,
        type: 'device',
        position: pos,
        zIndex: 2,
        data: deviceData,
        draggable: true,
        selectable: true
      })
    }
  })

  return [gatewayNode, ...groupNodes, ...deviceNodes]
}

/**
 * Automatic gateway→device edges are treated as `DMX`-class links for precedence (same class as legacy `Data` v1).
 *
 * POC precedence (Step 6 correction):
 * 1. Exact triple — hide `gw→d` when a manual row matches `(MAP_GATEWAY_NODE_ID, d.id, DMX)` (future gateway-sourced manuals).
 * 2. DMX / Network destination — hide `gw→d` when any persisted **DMX** or **Network** manual trace has
 *    `destinationDeviceId === d`, so device→device non-Power traces can replace the “uplink” automatic edge to that device only.
 *    Power manuals do not participate in this narrow rule (no Power auto edges today).
 */
const AUTO_GATEWAY_EDGE_CONNECTION_TYPE: MapManualTraceConnectionType = 'DMX'

const MANUAL_TRACE_DEST_SUPPRESSES_AUTO_GW: ReadonlySet<MapManualTraceConnectionType> = new Set(['DMX', 'Network'])

function buildEdges(devices: Device[], manualTraces: MapManualTrace[]): Edge[] {
  const manualKeysExact = new Set(manualTraces.map((t) => mapManualTraceKeyFromRow(t)))
  const nonPowerManualDestinationDeviceIds = new Set(
    manualTraces
      .filter((t) => MANUAL_TRACE_DEST_SUPPRESSES_AUTO_GW.has(t.connectionType))
      .map((t) => t.destinationDeviceId)
  )
  return devices
    .filter((d) => {
      const autoKey = mapManualTraceLogicalKey(
        MAP_GATEWAY_NODE_ID,
        d.id,
        AUTO_GATEWAY_EDGE_CONNECTION_TYPE
      )
      if (manualKeysExact.has(autoKey)) return false
      if (nonPowerManualDestinationDeviceIds.has(d.id)) return false
      return true
    })
    .map((d) => ({
      id: `e-gw-${d.id}`,
      source: MAP_GATEWAY_NODE_ID,
      target: d.id,
      style: { ...MAP_EDGE_STYLE },
      animated: false
    }))
}

interface MapMarqueeOverlayProps {
  flowRect: FlowRect
  wrapEl: HTMLDivElement | null
  flowToScreenPosition: (p: XYPosition) => XYPosition
  /** Bumps when viewport changes so screen coords recompute while dragging. */
  viewportRev: number
}

function MapMarqueeOverlay({
  flowRect,
  wrapEl,
  flowToScreenPosition,
  viewportRev
}: MapMarqueeOverlayProps): JSX.Element | null {
  void viewportRev
  if (!wrapEl) return null
  const wrap = wrapEl.getBoundingClientRect()
  const c1 = flowToScreenPosition({ x: flowRect.x, y: flowRect.y })
  const c2 = flowToScreenPosition({
    x: flowRect.x + flowRect.width,
    y: flowRect.y + flowRect.height
  })
  const left = Math.min(c1.x, c2.x) - wrap.left
  const top = Math.min(c1.y, c2.y) - wrap.top
  const width = Math.abs(c2.x - c1.x)
  const height = Math.abs(c2.y - c1.y)
  return (
    <div className="map-flow__marquee-layer" aria-hidden>
      <div className="map-flow__marquee-rect" style={{ left, top, width, height }} />
    </div>
  )
}

interface MapTracePathDraftOverlayProps {
  /** Locked start anchor in flow space (snap-based). */
  startFlow: XYPosition | null
  /** Committed intermediate route geometry (not endpoints). */
  points: XYPosition[]
  previewFlow: XYPosition | null
  wrapEl: HTMLDivElement | null
  flowToScreenPosition: (p: XYPosition) => XYPosition
  /** Bumps on viewport move so screen coords track pan/zoom while drafting. */
  viewportRev: number
  /** Active trace family for centralized stroke tokens (presentation only). */
  traceFamily: MapManualTraceConnectionType
}

/** In-progress trace polyline in flow space, drawn in screen space over the map wrapper (POC). */
function MapTracePathDraftOverlay({
  startFlow,
  points,
  previewFlow,
  wrapEl,
  flowToScreenPosition,
  viewportRev,
  traceFamily
}: MapTracePathDraftOverlayProps): JSX.Element | null {
  void viewportRev
  if (!wrapEl) return null
  if (startFlow == null && points.length === 0 && previewFlow == null) return null
  const wrap = wrapEl.getBoundingClientRect()
  const toLocal = (p: XYPosition) => {
    const s = flowToScreenPosition(p)
    return { x: s.x - wrap.left, y: s.y - wrap.top }
  }
  const strokePts: XYPosition[] =
    startFlow != null ? [startFlow, ...points] : points
  const polyPts =
    strokePts.length >= 2 ? strokePts.map((p) => `${toLocal(p).x},${toLocal(p).y}`).join(' ') : ''
  const lastFlow = points.length > 0 ? points[points.length - 1]! : startFlow
  const last = lastFlow ? toLocal(lastFlow) : null
  const previewLocal = previewFlow ? toLocal(previewFlow) : null
  return (
    <svg
      className={draftTracePathOverlayRootClassName(traceFamily)}
      aria-hidden
      width={Math.max(1, wrap.width)}
      height={Math.max(1, wrap.height)}
    >
      {polyPts ? (
        <polyline className="map-trace-path-draft-overlay__poly" points={polyPts} fill="none" />
      ) : null}
      {last && previewLocal ? (
        <line
          className="map-trace-path-draft-overlay__preview"
          x1={last.x}
          y1={last.y}
          x2={previewLocal.x}
          y2={previewLocal.y}
        />
      ) : null}
      {startFlow ? (() => {
        const { x, y } = toLocal(startFlow)
        return <circle className="map-trace-path-draft-overlay__vertex" cx={x} cy={y} r={4} />
      })() : null}
      {points.map((p, i) => {
        const { x, y } = toLocal(p)
        return <circle key={i} className="map-trace-path-draft-overlay__vertex" cx={x} cy={y} r={4} />
      })}
    </svg>
  )
}

interface MapPersistedManualTracesOverlayProps {
  traces: MapManualTrace[]
  wrapEl: HTMLDivElement | null
  flowToScreenPosition: (p: XYPosition) => XYPosition
  viewportRev: number
}

/** Persisted manual traces in flow space → screen SVG (same transform path as draft path). */
function MapPersistedManualTracesOverlay({
  traces,
  wrapEl,
  flowToScreenPosition,
  viewportRev
}: MapPersistedManualTracesOverlayProps): JSX.Element | null {
  void viewportRev
  if (!wrapEl || traces.length === 0) return null
  const wrap = wrapEl.getBoundingClientRect()
  const toLocal = (p: XYPosition) => {
    const s = flowToScreenPosition(p)
    return { x: s.x - wrap.left, y: s.y - wrap.top }
  }
  return (
    <svg
      className="map-manual-traces-overlay"
      aria-hidden
      width={Math.max(1, wrap.width)}
      height={Math.max(1, wrap.height)}
    >
      {traces.map((t) => {
        const pts = t.path
        if (pts.length < 2) return null
        const polyPts = pts.map((p) => `${toLocal(p).x},${toLocal(p).y}`).join(' ')
        const cls = persistedManualTracePolylineClassName(t.connectionType)
        return <polyline key={t.traceId} className={cls} points={polyPts} fill="none" />
      })}
    </svg>
  )
}

interface MapCanvasProps {
  devices: Device[]
  networkInfo: NetworkInfo | null
  networkId: string | null
  deviceGroups: DeviceGroup[]
  onSaveDevice: (payload: SaveDevicePayload) => Promise<void>
}

function MapCanvas({
  devices,
  networkInfo,
  networkId,
  deviceGroups,
  onSaveDevice
}: MapCanvasProps): JSX.Element {
  const { confirmAction } = useConfirmAction()
  const api = window.ssApi
  const {
    getNodes,
    getIntersectingNodes,
    screenToFlowPosition,
    flowToScreenPosition,
    fitView,
    getNodesBounds,
    setCenter,
    getZoom,
    zoomIn,
    zoomOut,
    zoomTo
  } = useReactFlow()
  const [nodes, setNodesState, onNodesChangeBase] = useNodesState<Node>([])
  /** Selection is app-owned (`mapSelection`); ignore RF `select` changes to avoid split-brain + multi-drag. */
  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const filtered = changes.filter((c) => c.type !== 'select')
      if (filtered.length === 0) return
      onNodesChangeBase(filtered)
    },
    [onNodesChangeBase]
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [persistedManualTraces, setPersistedManualTraces] = useState<MapManualTrace[]>([])
  const persistedManualTracesRef = useRef(persistedManualTraces)
  persistedManualTracesRef.current = persistedManualTraces
  /** Step 2.4: in-session traces completed via snap-end authoring (not persisted yet). */
  const [sessionManualTraces, setSessionManualTraces] = useState<MapManualTrace[]>([])
  const manualTracesForView = useMemo(
    () => [...sessionManualTraces, ...persistedManualTraces],
    [persistedManualTraces, sessionManualTraces]
  )
  const manualTracesForViewRef = useRef(manualTracesForView)
  manualTracesForViewRef.current = manualTracesForView
  const [savedBundle, setSavedBundle] = useState<MapLayoutBundle>({ manualGroups: [], positions: {} })
  /** Bumped when an authoritative bundle is fetched (load/invalidation). Forces rebuild from bundle. */
  const [bundleReloadTick, setBundleReloadTick] = useState(0)
  const prevBundleReloadTickRef = useRef(0)
  const [layoutMode, setLayoutMode] = useState<MapLayoutMode>('manual')
  /**
   * Bumped only when the map graph is fully replaced via `buildMapNodes` / `buildAutoLayoutNodes` (bundle,
   * devices, or mode). Drives selection→`node.selected` sync **without** listing `nodes` in effect deps.
   * Listing `nodes` caused "Maximum update depth exceeded": any resize/dimension update changed `nodes` →
   * selection `useLayoutEffect` → `setNodesState` → React Flow `StoreUpdater` → `onNodesChange` → `nodes`
   * again → repeat until the renderer died.
   */
  const [mapGraphRebuildTick, setMapGraphRebuildTick] = useState(0)
  /** Phase 2C.4 — pan bounds from content + margin + minimum world floor (`translateExtent`). */
  const translateExtent = useMemo(() => {
    const rect = nodes.length === 0 ? { x: 0, y: 0, width: 0, height: 0 } : getNodesBounds(nodes)
    return computeMapTranslateExtent(rect)
  }, [nodes, mapGraphRebuildTick, getNodesBounds])
  /** After auto modes, rebuild manual nodes from DB snapshot instead of merging auto positions. */
  const prevLayoutModeRef = useRef<MapLayoutMode>('manual')
  /** Debounced persist must read latest mode when the timer fires (avoid saving after switching to auto). */
  const layoutModeRef = useRef<MapLayoutMode>(layoutMode)
  layoutModeRef.current = layoutMode
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didInitialFit = useRef(false)
  const flowWrapRef = useRef<HTMLDivElement>(null)
  /** Step 5/9: Add Device popover — declared early so effects can reference it without TDZ issues. */
  const [pocAddDeviceOpen, setPocAddDeviceOpen] = useState(false)
  const [pocAddTileHover, setPocAddTileHover] = useState<MapPocVisualDeviceType | null>(null)
  const pocAddDeviceSurfaceRef = useRef<HTMLDivElement | null>(null)
  /** Trace type popover (Step 11) — same outside-dismiss pattern as Add Device. */
  const [traceTypeMenuOpen, setTraceTypeMenuOpen] = useState(false)
  const [traceTypeMenuHover, setTraceTypeMenuHover] = useState<MapManualTraceConnectionType | null>(null)
  const traceTypeMenuSurfaceRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusCreatedDeviceIdRef = useRef<string | null>(null)
  const pocCreateCascadeRef = useRef<{ lastAt: number; step: number }>({ lastAt: 0, step: -1 })
  /** POC naming (Step 8): in-session tie-break when numbering races ON_DEVICES_CHANGED. */
  const pocNameSeqRef = useRef<Partial<Record<MapPocVisualDeviceType, number>>>({})
  /**
   * POC create+place: first device paint can happen before `getMapLayout` returns the new row.
   * Stash intended flow coords here so manual `buildMapNodes` can merge them for one frame without
   * a visible jump to `defaultDevicePosition`. Cleared when bundle catches up or device disappears.
   */
  const pocPendingInitialPlacementRef = useRef<
    Record<string, { x: number; y: number; manualGroupId: string | null }>
  >({})
  const [inspectorInnerWidthPx, setInspectorInnerWidthPx] = useState(readStoredMapInspectorWidth)
  const inspectorInnerWidthRef = useRef(inspectorInnerWidthPx)
  inspectorInnerWidthRef.current = inspectorInnerWidthPx
  const inspectorResizeDragRef = useRef<{ startX: number; startW: number } | null>(null)

  const finishInspectorResize = useCallback((e: React.PointerEvent<HTMLDivElement>, useEventClientX: boolean) => {
    const d = inspectorResizeDragRef.current
    if (!d) return
    inspectorResizeDragRef.current = null
    if (useEventClientX) {
      /* Handle is on the inspector’s left: drag left → wider panel. */
      const w = Math.min(
        MAP_INSPECTOR_WIDTH_MAX,
        Math.max(MAP_INSPECTOR_WIDTH_MIN, d.startW + (d.startX - e.clientX))
      )
      inspectorInnerWidthRef.current = w
      setInspectorInnerWidthPx(w)
    }
    try {
      localStorage.setItem(MAP_INSPECTOR_WIDTH_LS_KEY, String(inspectorInnerWidthRef.current))
    } catch {
      /* ignore */
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const onInspectorResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary || e.button !== 0) return
      inspectorResizeDragRef.current = { startX: e.clientX, startW: inspectorInnerWidthPx }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      e.preventDefault()
    },
    [inspectorInnerWidthPx]
  )

  const onInspectorResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = inspectorResizeDragRef.current
    if (!d) return
    const w = Math.min(
      MAP_INSPECTOR_WIDTH_MAX,
      Math.max(MAP_INSPECTOR_WIDTH_MIN, d.startW + (d.startX - e.clientX))
    )
    inspectorInnerWidthRef.current = w
    setInspectorInnerWidthPx(w)
  }, [])

  const onInspectorResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary || e.button !== 0) return
      finishInspectorResize(e, true)
    },
    [finishInspectorResize]
  )

  const onInspectorResizePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      finishInspectorResize(e, false)
    },
    [finishInspectorResize]
  )

  const onInspectorResizeLostPointerCapture = useCallback(() => {
    if (!inspectorResizeDragRef.current) return
    inspectorResizeDragRef.current = null
    try {
      localStorage.setItem(MAP_INSPECTOR_WIDTH_LS_KEY, String(inspectorInnerWidthRef.current))
    } catch {
      /* ignore */
    }
  }, [])

  /** Phase 2C.2 — marquee in flow space; overlay maps via flowToScreenPosition. */
  const [marqueeFlow, setMarqueeFlow] = useState<{
    start: XYPosition
    current: XYPosition
  } | null>(null)
  const marqueePointerIdRef = useRef<number | null>(null)
  const marqueeDraftRef = useRef<{ start: XYPosition; current: XYPosition } | null>(null)
  const marqueeStartClientRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeDidActivateRef = useRef(false)
  const marqueeActiveRef = useRef(false)
  const suppressNextPaneClickClearRef = useRef(false)
  const [marqueeViewportTick, setMarqueeViewportTick] = useState(0)
  const spacePressedRef = useRef(false)
  const [spacePressed, setSpacePressed] = useState(false)

  /** Drop stray focus from RF nodes after Escape/pane click so focus rings don’t mimic selection. */
  const blurNonInputFocusInMap = useCallback(() => {
    const root = flowWrapRef.current
    if (!root) return
    requestAnimationFrame(() => {
      const ae = document.activeElement
      if (!(ae instanceof HTMLElement) || !root.contains(ae)) return
      if (ae.closest('input, textarea, select, [contenteditable="true"]')) return
      ae.blur()
    })
  }, [])

  /** Phase 2C.1 — canonical selection; synced to React Flow `node.selected` for styling only. */
  const [mapSelection, setMapSelection] = useState<MapSelection>(initialMapSelection)
  /** Cross-surface (v1 Step 3): list-driven equipment ids — reflection only on `node.selected`. */
  const { selectedEquipmentIds, setSelectedEquipmentIds } = useSelectionState()
  /** Clears shared ids only for `none`; sets when selection includes devices; otherwise leaves shared unchanged. */
  const commitSharedEquipmentFromMapSelection = useCallback((sel: MapSelection) => {
    if (sel.kind === 'none') {
      setSelectedEquipmentIds(new Set())
      return
    }
    const ids = mapSelectionToSharedEquipmentIds(sel)
    if (ids.size > 0) setSelectedEquipmentIds(ids)
  }, [setSelectedEquipmentIds])
  /** Inspector-only: device to show while canvas keeps a locked manual group selected (see `onNodeClick`). */
  const [inspectorPeekDeviceId, setInspectorPeekDeviceId] = useState<string | null>(null)
  /**
   * Step 3 POC: trace authoring mode (type only). `null` = inactive. When set, `traceType` is the
   * connection kind for a future manual trace — no path, endpoints, or persistence yet.
   */
  const [mapTraceAuthoring, setMapTraceAuthoring] = useState<{
    traceType: MapManualTraceConnectionType
  } | null>(null)
  /**
   * Step 2.1: snap-start draft anchoring (S1 → S2).
   * Stores canonical endpoint identity (deviceId + snapPointId), not coordinates.
   */
  const [traceDraftStartEndpoint, setTraceDraftStartEndpoint] = useState<TraceSnapHoverTarget | null>(null)
  const traceDraftStartEndpointRef = useRef<TraceSnapHoverTarget | null>(null)
  traceDraftStartEndpointRef.current = traceDraftStartEndpoint
  /**
   * Step 2.2: once a snap-anchored draft exists, the first empty-canvas click enters routing (S3) by
   * committing the first intermediate geometry point; further clicks append geometry only.
   */
  const [traceDraftRouting, setTraceDraftRouting] = useState(false)
  /** Step 2.3: draft-time end snap hover qualification (valid / invalid / neutral). */
  const [traceDraftEndSnapHover, setTraceDraftEndSnapHover] = useState<TraceDraftEndSnapHover>({ kind: 'neutral' })
  const traceDraftEndSnapHoverRef = useRef<TraceDraftEndSnapHover>({ kind: 'neutral' })
  traceDraftEndSnapHoverRef.current = traceDraftEndSnapHover
  /** Step 4 POC: flow-space polyline while trace mode is on — not persisted or bound to devices. */
  const [tracePathDraftPoints, setTracePathDraftPoints] = useState<XYPosition[]>([])
  const [tracePathPreviewFlow, setTracePathPreviewFlow] = useState<XYPosition | null>(null)
  const [tracePathViewportTick, setTracePathViewportTick] = useState(0)
  const mapTraceAuthoringRef = useRef(mapTraceAuthoring)
  const tracePathDraftPointsRef = useRef(tracePathDraftPoints)
  const tracePathPreviewFlowRef = useRef(tracePathPreviewFlow)
  mapTraceAuthoringRef.current = mapTraceAuthoring
  tracePathDraftPointsRef.current = tracePathDraftPoints
  tracePathPreviewFlowRef.current = tracePathPreviewFlow
  const [tracePocCommitFeedback, setTracePocCommitFeedback] = useState<TracePocCommitFeedback>(null)
  const [traceCommitSaving, setTraceCommitSaving] = useState(false)
  const tracePocFeedbackTimerRef = useRef<number | null>(null)

  const dismissTracePocCommitFeedback = useCallback(() => {
    if (tracePocFeedbackTimerRef.current != null) {
      window.clearTimeout(tracePocFeedbackTimerRef.current)
      tracePocFeedbackTimerRef.current = null
    }
    setTracePocCommitFeedback(null)
  }, [])

  const presentTracePocCommitFeedback = useCallback(
    (fb: Exclude<TracePocCommitFeedback, null>, dismissMs: number) => {
      if (tracePocFeedbackTimerRef.current != null) {
        window.clearTimeout(tracePocFeedbackTimerRef.current)
        tracePocFeedbackTimerRef.current = null
      }
      setTracePocCommitFeedback(fb)
      tracePocFeedbackTimerRef.current = window.setTimeout(() => {
        tracePocFeedbackTimerRef.current = null
        setTracePocCommitFeedback(null)
      }, dismissMs)
    },
    []
  )

  useEffect(() => {
    return () => {
      if (tracePocFeedbackTimerRef.current != null) {
        window.clearTimeout(tracePocFeedbackTimerRef.current)
      }
    }
  }, [])
  /** Step 12: proximity highlight target for visible trace snaps (presentation only). */
  const [traceSnapHover, setTraceSnapHover] = useState<TraceSnapHoverTarget | null>(null)
  const traceSnapHoverRef = useRef<TraceSnapHoverTarget | null>(null)
  traceSnapHoverRef.current = traceSnapHover
  const traceCommitInFlightRef = useRef(false)
  /**
   * Bumped when trace authoring is reset (exit, network change, type switch) so an in-flight save
   * cannot clear a newly started draft or clobber state after the user left trace mode.
   */
  const tracePoCEpochRef = useRef(0)

  const canCenterOnSelection = useMemo(() => {
    const ids = mapSelectionToViewportNodeIds(mapSelection, layoutMode)
    if (ids.length === 0) return false
    const idSet = new Set(getNodes().map((n) => n.id))
    return ids.some((id) => idSet.has(id))
  }, [getNodes, layoutMode, mapGraphRebuildTick, mapSelection, nodes])

  const handleFitAllMap = useCallback(() => {
    void fitView({ padding: 0.14, minZoom: 0.35, maxZoom: 1.5, duration: 320 })
  }, [fitView])

  const handleCenterOnSelection = useCallback(() => {
    const ids = mapSelectionToViewportNodeIds(mapSelection, layoutMode)
    const nds = getNodes()
    const existing = ids.filter((id) => nds.some((n) => n.id === id))
    if (existing.length === 0) return
    const b = getNodesBounds(existing)
    void setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom: getZoom(), duration: 260 })
  }, [getNodes, getNodesBounds, getZoom, layoutMode, mapSelection, setCenter])

  const handleResetZoomView = useCallback(() => {
    void zoomTo(MAP_DEFAULT_ZOOM, { duration: 220 })
  }, [zoomTo])

  const handleZoomInMap = useCallback(() => {
    void zoomIn({ duration: 160 })
  }, [zoomIn])

  const handleZoomOutMap = useCallback(() => {
    void zoomOut({ duration: 160 })
  }, [zoomOut])

  /** Avoid re-validating manual-group selection when `savedBundle` is a new object with the same group ids. */
  const prevManualGroupIdsSigRef = useRef<string>('')

  /** Command stacks — manual layout only; cleared when network changes or layout reset. */
  const undoStackRef = useRef<MapLayoutCommand[]>([])
  const redoStackRef = useRef<MapLayoutCommand[]>([])
  const [mapHistTick, setMapHistTick] = useState(0)
  /** True when history may be recorded/applied (connected LAN + Manual layout). */
  const canRecordHistoryRef = useRef(false)
  /** Drag start snapshot — one entry per completed drag (see `onNodeDragStop`). */
  const dragStartRef = useRef<DragStartSnap | null>(null)
  const schedulePersistRef = useRef<() => void>(() => {})

  /**
   * Renderer-side normalization to match main's `normalizeNetworkId`:
   * - trims + removes whitespace
   * - splits on `|` and drops empty parts
   * - collapses legacy `ssid|gateway|cidr` → canonical `gateway|cidr`
   */
  const normalizedNetworkId = useMemo(() => {
    const cleaned = String(networkId ?? '')
      .trim()
      .replace(/\s+/g, '')
    if (!cleaned) return ''
    const parts = cleaned.split('|').filter(Boolean)
    if (parts.length >= 3) {
      const [_ssid, gw, ...rest] = parts
      return [gw, rest.join('|')].join('|')
    }
    return parts.join('|')
  }, [networkId])

  /**
   * Step 2.4: snap-end completion entry (in-memory only).
   * Converts an anchored draft + optional intermediate geometry into a `MapManualTrace` without persistence.
   */
  const commitSnapDraftToSession = useCallback(
    (args: { clientX: number; clientY: number; endDeviceId: string; endSnapPointId: string }) => {
      const auth = mapTraceAuthoringRef.current
      const start = traceDraftStartEndpointRef.current
      const nid = normalizedNetworkId
      const wrap = flowWrapRef.current
      if (!auth || !start || !nid || !wrap) return false

      const hover = traceDraftEndSnapHoverRef.current
      const isHoverValidEnd =
        hover.kind === 'validEnd' &&
        hover.target.deviceId === args.endDeviceId &&
        hover.target.snapPointId === args.endSnapPointId
      if (!isHoverValidEnd) return false

      const inferred = inferSnapIdsForManualTrace(auth.traceType)
      if (args.endSnapPointId !== inferred.destinationSnapPointId) return false

      const srcAnchor = getTraceSnapAnchorFlowPosition(wrap, screenToFlowPosition, start.deviceId, start.snapPointId)
      const dstAnchor = getTraceSnapAnchorFlowPosition(
        wrap,
        screenToFlowPosition,
        args.endDeviceId,
        inferred.destinationSnapPointId
      )
      if (!srcAnchor || !dstAnchor) return false

      const intermediates = tracePathDraftPointsRef.current.map((p) => ({ x: p.x, y: p.y }))
      const path: { x: number; y: number }[] = [{ x: srcAnchor.x, y: srcAnchor.y }, ...intermediates, { x: dstAnchor.x, y: dstAnchor.y }]

      const traceId = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const row: MapManualTrace = {
        kind: 'manual',
        traceId,
        networkId: nid,
        sourceDeviceId: start.deviceId,
        destinationDeviceId: args.endDeviceId,
        connectionType: auth.traceType,
        sourceSnapPointId: start.snapPointId,
        destinationSnapPointId: inferred.destinationSnapPointId,
        path
      }

      setSessionManualTraces((prev) => {
        const next = [row, ...prev]
        setEdges(buildEdges(devices, [...next, ...persistedManualTracesRef.current]))
        return next
      })

      // Return to TraceArmed (S1): clear draft + hover qualification, keep trace mode active.
      setTraceDraftStartEndpoint(null)
      setTraceDraftRouting(false)
      setTraceDraftEndSnapHover({ kind: 'neutral' })
      setTracePathDraftPoints([])
      setTracePathPreviewFlow(null)
      setTraceSnapHover(null)
      setTracePathViewportTick((t) => t + 1)
      return true
    },
    [devices, normalizedNetworkId, screenToFlowPosition]
  )

  useEffect(() => {
    let cancelled = false
    const nid = networkId?.trim() ?? ''
    if (!nid) {
      setSavedBundle({ manualGroups: [], positions: {} })
      setPersistedManualTraces([])
      setSessionManualTraces([])
      return
    }
    void Promise.all([api.getMapLayout(nid), api.getMapManualTraces(nid)]).then(([bundle, traces]) => {
      if (cancelled) return
      setSavedBundle(bundle)
      setPersistedManualTraces(traces)
      setSessionManualTraces([])
      setBundleReloadTick((t) => t + 1)
    })
    return () => {
      cancelled = true
    }
  }, [api, networkId])

  /** Peer window (or same) saved layout / manual traces — reload authoritative data. */
  useEffect(() => {
    return api.onMapLayoutInvalidated((p) => {
      const nid = networkId?.trim() ?? ''
      if (!nid) return
      if (!normalizedNetworkId || p.networkId !== normalizedNetworkId) return
      void Promise.all([api.getMapLayout(nid), api.getMapManualTraces(nid)]).then(([bundle, traces]) => {
        setSavedBundle(bundle)
        setPersistedManualTraces(traces)
        setSessionManualTraces([])
        setBundleReloadTick((t) => t + 1)
      })
    })
  }, [api, networkId, normalizedNetworkId])

  useEffect(() => {
    return api.onMapManualGroupLockChanged((p) => {
      setSavedBundle((b) => ({
        ...b,
        manualGroups: b.manualGroups.map((g) => (g.id === p.id ? { ...g, contentsLocked: p.locked } : g))
      }))
    })
  }, [api])

  const persistNow = useCallback(async () => {
    if (layoutMode !== 'manual') return
    const nid = networkId?.trim()
    if (!nid) return
    const payload = collectPersistPayload(getNodes(), nid)
    await api.saveMapLayout(payload)
    // Authoritative refresh enters via GET_MAP_LAYOUT (initial load) + ON_MAP_LAYOUT_INVALIDATED.
  }, [api, getNodes, layoutMode, networkId])

  /** Immediate full layout write + bundle refresh (undo restore delete / group re-create). */
  const persistLayoutSnapshot = useCallback(
    async (nds: Node[]) => {
      const nid = networkId?.trim()
      if (!nid || layoutModeRef.current !== 'manual') return
      await api.saveMapLayout(collectPersistPayload(nds, nid))
    },
    [api, networkId]
  )

  const handleManualGroupAutoSize = useCallback(
    (groupId: string) => {
      if (layoutModeRef.current !== 'manual') return
      const nid = networkId?.trim()
      if (!nid) return
      const nds = getNodes()
      const g = nds.find((n) => n.id === groupId && n.type === 'manualGroup')
      if (!g) return
      const gd = g.data as { name: string; width: number; height: number }
      const members = nds.filter((n) => n.type === 'device' && n.parentId === groupId)
      let minX = 0
      let minY = GROUP_LAYOUT_CHROME_PX
      let maxX = 220
      let maxY = GROUP_LAYOUT_CHROME_PX + 100
      if (members.length > 0) {
        minX = Infinity
        minY = Infinity
        maxX = -Infinity
        maxY = -Infinity
        for (const m of members) {
          const { w, h } = layoutDeviceMeasuredSize(m)
          const x0 = m.position.x
          const y0 = m.position.y
          const x1 = x0 + Math.ceil(w)
          const y1 = y0 + Math.ceil(h)
          minX = Math.min(minX, x0)
          minY = Math.min(minY, y0)
          maxX = Math.max(maxX, x1)
          maxY = Math.max(maxY, y1)
        }
      }
      const minW = MANUAL_GROUP_MIN_W
      const minH = MANUAL_GROUP_MIN_H
      /*
       * Height must span from y=0 (group top) to below the lowest device. Using (maxY - minY + 2*pad) is wrong:
       * that is only the padded *cluster* height; when minY > 0 it can be < maxY and clips the bottom.
       */
      const newW = Math.max(minW, Math.ceil(maxX + AUTO_SIZE_EDGE_PAD_PX))
      const newH = Math.max(
        minH,
        Math.ceil(
          maxY + AUTO_SIZE_EDGE_PAD_PX + AUTO_SIZE_DRAG_SURFACE_MARGIN_BOTTOM_PX + AUTO_SIZE_DEVICE_BOUNDS_SLOP_PX
        )
      )
      const next = nds.map((n) => {
        if (n.id !== groupId || n.type !== 'manualGroup') return n
        const style = { ...(n.style as CSSProperties), width: newW, height: newH }
        const prevData = n.data as {
          name: string
          width: number
          height: number
          contentsLocked?: boolean
          onCommitRename: (s: string) => void
          onDelete: () => void
        }
        return {
          ...n,
          style,
          data: { ...prevData, name: gd.name, width: newW, height: newH }
        }
      })
      setNodesState(next)
      void persistLayoutSnapshot(next)
    },
    [getNodes, networkId, persistLayoutSnapshot, setNodesState]
  )

  const handleManualGroupAutoAlign = useCallback(
    (groupId: string) => {
      if (layoutModeRef.current !== 'manual') return
      const nid = networkId?.trim()
      if (!nid) return
      const nds = getNodes()
      const g = nds.find((n) => n.id === groupId && n.type === 'manualGroup')
      if (!g) return
      const cellW = 200
      const cellH = 126
      const cols = 2
      const ox = 20
      const oy = GROUP_LAYOUT_CHROME_PX + 12
      const members = nds
        .filter((n) => n.type === 'device' && n.parentId === groupId)
        .slice()
        .sort((a, b) => {
          const da = (a.data as { device: Device }).device
          const db = (b.data as { device: Device }).device
          return da.name.localeCompare(db.name, undefined, { sensitivity: 'base' })
        })
      const next = nds.map((n) => {
        const idx = members.findIndex((m) => m.id === n.id)
        if (idx < 0) return n
        const col = idx % cols
        const row = Math.floor(idx / cols)
        return {
          ...n,
          position: { x: ox + col * cellW, y: oy + row * cellH }
        }
      })
      setNodesState(next)
      void persistLayoutSnapshot(next)
    },
    [getNodes, networkId, persistLayoutSnapshot, setNodesState]
  )

  const handleManualGroupSetLock = useCallback(
    (groupId: string, locked: boolean) => {
      if (layoutModeRef.current !== 'manual') return
      if (!locked) {
        setInspectorPeekDeviceId((peek) => {
          if (peek == null) return null
          const dn = getNodes().find((n) => n.id === peek && n.type === 'device')
          return dn?.parentId === groupId ? null : peek
        })
      }
      void api.setMapManualGroupLock({ id: groupId, locked })
    },
    [api, getNodes]
  )

  useEffect(() => {
    return api.onMapManualGroupLayoutAction((p) => {
      if (p.action === 'autoSize') handleManualGroupAutoSize(p.groupId)
      else handleManualGroupAutoAlign(p.groupId)
    })
  }, [api, handleManualGroupAutoAlign, handleManualGroupAutoSize])

  const clearMapHistory = useCallback(() => {
    undoStackRef.current = []
    redoStackRef.current = []
    setMapHistTick((t) => t + 1)
  }, [])

  const pushMapHistory = useCallback((cmd: MapLayoutCommand) => {
    if (!canRecordHistoryRef.current) return
    undoStackRef.current.push(cmd)
    redoStackRef.current = []
    setMapHistTick((t) => t + 1)
  }, [])

  const handleMapUndo = useCallback(async () => {
    if (!canRecordHistoryRef.current) return
    const cmd = undoStackRef.current.pop()
    if (!cmd) return
    await cmd.undo()
    redoStackRef.current.push(cmd)
    setMapHistTick((t) => t + 1)
    schedulePersistRef.current()
  }, [])

  const handleMapRedo = useCallback(async () => {
    if (!canRecordHistoryRef.current) return
    const cmd = redoStackRef.current.pop()
    if (!cmd) return
    await cmd.redo()
    undoStackRef.current.push(cmd)
    setMapHistTick((t) => t + 1)
    schedulePersistRef.current()
  }, [])

  const commitGroupRename = useCallback(
    (id: string, name: string) => {
      const nid = networkId?.trim()
      if (!nid) return
      const trimmed = name.trim()
      if (!trimmed) return
      const gn = getNodes().find((n) => n.id === id && n.type === 'manualGroup')
      const oldName = String((gn?.data as { name?: string } | undefined)?.name ?? '').trim()
      if (oldName === trimmed) return
      void (async () => {
        await api.renameMapManualGroup({ id, name: trimmed })
        if (!canRecordHistoryRef.current) return
        pushMapHistory({
          type: 'renameManualGroup',
          undo: async () => {
            await api.renameMapManualGroup({ id, name: oldName || 'Group' })
          },
          redo: async () => {
            await api.renameMapManualGroup({ id, name: trimmed })
          }
        })
      })()
    },
    [api, getNodes, networkId, pushMapHistory]
  )

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      const nid = networkId?.trim()
      if (!nid) return
      const ndsBefore = getNodes()
      const groupNode = ndsBefore.find((n) => n.id === groupId && n.type === 'manualGroup')
      if (!groupNode) return
      const gd = groupNode.data as { name: string; width: number; height: number }
      const byId = new Map(ndsBefore.map((n) => [n.id, n]))
      const members: { deviceId: string; abs: XYPosition }[] = []
      for (const n of ndsBefore) {
        if (n.type === 'device' && n.parentId === groupId) {
          members.push({ deviceId: n.id, abs: absoluteNodePosition(n, byId) })
        }
      }
      const snapshot = {
        name: gd.name,
        x: groupNode.position.x,
        y: groupNode.position.y,
        width: gd.width,
        height: gd.height,
        members
      }
      const redoState = { restoredId: undefined as string | undefined }

      const ok = await confirmAction({
        title: 'Delete map group?',
        message:
          'Remove this group from the map. Devices on the map stay placed; they are only unassigned from the group.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        destructive: true
      })
      if (!ok) return
      await persistNow()
      logDeleteFlowPreDelete('map:deleteManualGroup')
      await api.deleteMapManualGroup(groupId)
      recoverKeyboardAfterDestructiveAction('map:deleteManualGroup', {
        clearGraphSelection: () => {
          setInspectorPeekDeviceId(null)
          setMapSelection(clearSelection())
          setNodesState((ns) => ns.map((n) => ({ ...n, selected: false })))
          setEdges((es) => es.map((e) => ({ ...e, selected: false })))
        }
      })
      if (canRecordHistoryRef.current) {
        pushMapHistory({
          type: 'deleteManualGroup',
          undo: async () => {
            const g = await api.createMapManualGroup({
              networkId: nid,
              name: snapshot.name,
              x: snapshot.x,
              y: snapshot.y,
              width: snapshot.width,
              height: snapshot.height
            })
            redoState.restoredId = g.id
            let next = getNodes()
            if (!next.some((n) => n.id === g.id)) {
              next = [...next, manualGroupFlowNodeFromRow(g, groupHandlers.current)]
            }
            for (const m of snapshot.members) {
              next = patchDeviceLayout(next, m.deviceId, {
                manualGroupId: g.id,
                abs: m.abs
              })
            }
            setNodesState(next)
            await persistLayoutSnapshot(next)
          },
          redo: async () => {
            const rid = redoState.restoredId
            if (!rid) return
            await api.deleteMapManualGroup(rid)
          }
        })
      }
    },
    [
      api,
      confirmAction,
      getNodes,
      networkId,
      persistLayoutSnapshot,
      persistNow,
      pushMapHistory,
      setEdges,
      setMapSelection,
      setNodesState
    ]
  )

  const schedulePersist = useCallback(() => {
    if (layoutMode !== 'manual') return
    const nid = networkId?.trim()
    if (!nid) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null
      if (layoutModeRef.current !== 'manual') return
      const payload = collectPersistPayload(getNodes(), nid)
      void (async () => {
        try {
          await api.saveMapLayout(payload)
        } catch {
          /* ignore */
        }
      })()
    }, 400)
  }, [api, getNodes, layoutMode, networkId])

  schedulePersistRef.current = schedulePersist

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [])

  const groupResizeStartRef = useRef<{ id: string; bounds: GroupBounds } | null>(null)

  /**
   * Live resize only: update RF nodes. Must NOT touch `savedBundle` — that triggers the manual-map
   * `useEffect` and full `buildMapNodes`, which rebuilds the graph every frame and can blank the renderer.
   */
  const applyManualGroupBoundsLive = useCallback(
    (id: string, p: GroupBounds) => {
      setNodesState((ns) => {
        const cur = ns.find((n) => n.id === id && n.type === 'manualGroup')
        if (!cur) return ns
        const prevData = cur.data as { width: number; height: number }
        if (
          Math.abs(cur.position.x - p.x) < 0.01 &&
          Math.abs(cur.position.y - p.y) < 0.01 &&
          Math.abs(prevData.width - p.width) < 0.01 &&
          Math.abs(prevData.height - p.height) < 0.01
        ) {
          return ns
        }
        return ns.map((n) => {
          if (n.id !== id || n.type !== 'manualGroup') return n
          const data = n.data as Record<string, unknown>
          return {
            ...n,
            position: { x: p.x, y: p.y },
            style: { ...(n.style as CSSProperties), width: p.width, height: p.height },
            data: { ...data, width: p.width, height: p.height }
          }
        })
      })
    },
    [setNodesState]
  )

  /** Persisted mirror + nodes (resize end, undo, redo). */
  const commitManualGroupBounds = useCallback(
    (id: string, p: GroupBounds) => {
      setNodesState((ns) =>
        ns.map((n) => {
          if (n.id !== id || n.type !== 'manualGroup') return n
          const data = n.data as Record<string, unknown>
          return {
            ...n,
            position: { x: p.x, y: p.y },
            style: { ...(n.style as CSSProperties), width: p.width, height: p.height },
            data: { ...data, width: p.width, height: p.height }
          }
        })
      )
      setSavedBundle((b) => ({
        ...b,
        manualGroups: b.manualGroups.map((g) =>
          g.id === id ? { ...g, x: p.x, y: p.y, width: p.width, height: p.height } : g
        )
      }))
    },
    [setNodesState, setSavedBundle]
  )

  const onGroupResizeSessionStart = useCallback(
    (id: string) => {
      const n = getNodes().find((x) => x.id === id && x.type === 'manualGroup')
      if (!n) return
      if (Boolean((n.data as { contentsLocked?: boolean }).contentsLocked)) return
      const d = n.data as { width: number; height: number }
      const snap = sanitizeGroupBounds(
        { x: n.position.x, y: n.position.y, width: d.width, height: d.height },
        MANUAL_GROUP_MIN_W,
        MANUAL_GROUP_MIN_H
      )
      if (!snap) return
      groupResizeStartRef.current = { id, bounds: snap }
    },
    [getNodes]
  )

  const onGroupResizeLive = useCallback(
    (id: string, raw: GroupBounds) => {
      const p = sanitizeGroupBounds(raw, MANUAL_GROUP_MIN_W, MANUAL_GROUP_MIN_H)
      if (!p) return
      applyManualGroupBoundsLive(id, p)
    },
    [applyManualGroupBoundsLive]
  )

  const onGroupResizeSessionEnd = useCallback(
    (id: string, raw: GroupBounds) => {
      const n = getNodes().find((x) => x.id === id && x.type === 'manualGroup')
      if (!n || Boolean((n.data as { contentsLocked?: boolean }).contentsLocked)) {
        groupResizeStartRef.current = null
        return
      }
      const p = sanitizeGroupBounds(raw, MANUAL_GROUP_MIN_W, MANUAL_GROUP_MIN_H)
      const start = groupResizeStartRef.current
      groupResizeStartRef.current = null
      if (!p) return
      commitManualGroupBounds(id, p)
      schedulePersist()
      if (!start || start.id !== id || sameGroupBounds(start.bounds, p)) return
      pushMapHistory({
        type: 'resizeManualGroup',
        undo: () => commitManualGroupBounds(id, start.bounds),
        redo: () => commitManualGroupBounds(id, p)
      })
    },
    [commitManualGroupBounds, getNodes, pushMapHistory, schedulePersist]
  )

  const deviceLayoutHandlersRef = useRef<DeviceLayoutHandlers>({
    toggleCollapsed: () => {}
  })

  const toggleDeviceCollapsed = useCallback((id: string) => {
    setNodesState((ns) => {
      const next = ns.map((n) => {
        if (n.id !== id || n.type !== 'device') return n
        const dd = n.data as DeviceNodeData
        if (!dd.mapManualLayout) return n
        return {
          ...n,
          data: { ...dd, mapDeviceCollapsed: !dd.mapDeviceCollapsed }
        }
      })
      queueMicrotask(() => schedulePersistRef.current())
      return next
    })
  }, [])

  const handleCollapseAllDevices = useCallback(() => {
    setNodesState((ns) => {
      const next = ns.map((n) => {
        if (n.type !== 'device') return n
        const dd = n.data as DeviceNodeData
        if (!dd.mapManualLayout) return n
        return { ...n, data: { ...dd, mapDeviceCollapsed: true } }
      })
      queueMicrotask(() => schedulePersistRef.current())
      return next
    })
  }, [])

  const handleExpandAllDevices = useCallback(() => {
    setNodesState((ns) => {
      const next = ns.map((n) => {
        if (n.type !== 'device') return n
        const dd = n.data as DeviceNodeData
        if (!dd.mapManualLayout) return n
        return { ...n, data: { ...dd, mapDeviceCollapsed: false } }
      })
      queueMicrotask(() => schedulePersistRef.current())
      return next
    })
  }, [])

  deviceLayoutHandlersRef.current = { toggleCollapsed: toggleDeviceCollapsed }

  const groupHandlers = useRef<GroupHandlers>({
    commitRename: commitGroupRename,
    deleteGroup: handleDeleteGroup,
    onResizeSessionStart: () => {},
    onResizeLive: () => {},
    onResizeSessionEnd: () => {}
  })
  groupHandlers.current = {
    commitRename: commitGroupRename,
    deleteGroup: handleDeleteGroup,
    onResizeSessionStart: onGroupResizeSessionStart,
    onResizeLive: onGroupResizeLive,
    onResizeSessionEnd: onGroupResizeSessionEnd
  }

  useEffect(() => {
    const gw = networkInfo?.gateway ?? null
    const prevMode = prevLayoutModeRef.current
    if (layoutMode !== 'manual') {
      setNodesState(buildAutoLayoutNodes(devices, layoutMode, gw))
      setMapGraphRebuildTick((t) => t + 1)
      setEdges(buildEdges(devices, manualTracesForView))
      prevLayoutModeRef.current = layoutMode
      return
    }
    const reseedFromSaved = prevMode !== 'manual' || prevBundleReloadTickRef.current !== bundleReloadTick
    /* Merge pending POC positions (see `pocPendingInitialPlacementRef`) before SQLite bundle has the row. */
    const pending = pocPendingInitialPlacementRef.current
    const deviceIdSet = new Set(devices.map((d) => d.id))
    for (const id of Object.keys(pending)) {
      if (!deviceIdSet.has(id)) {
        delete pending[id]
        continue
      }
      if (savedBundle.positions[id] != null) {
        delete pending[id]
      }
    }
    const mergedPositions: MapLayoutSnapshot = { ...savedBundle.positions }
    for (const [id, p] of Object.entries(pending)) {
      if (mergedPositions[id] == null && deviceIdSet.has(id)) {
        mergedPositions[id] = { x: p.x, y: p.y, manualGroupId: p.manualGroupId }
      }
    }
    const effectiveBundle: MapLayoutBundle = {
      manualGroups: savedBundle.manualGroups,
      positions: mergedPositions
    }
    setNodesState((prev) =>
      buildMapNodes(
        reseedFromSaved ? [] : prev,
        devices,
        effectiveBundle,
        gw,
        groupHandlers.current,
        deviceLayoutHandlersRef.current,
        traceSnapHoverRef.current
      )
    )
    setMapGraphRebuildTick((t) => t + 1)
    setEdges(buildEdges(devices, manualTracesForView))
    prevLayoutModeRef.current = layoutMode
    prevBundleReloadTickRef.current = bundleReloadTick
  }, [
    bundleReloadTick,
    devices,
    layoutMode,
    manualTracesForView,
    savedBundle,
    networkInfo?.gateway,
    setEdges,
    setNodesState
  ])

  useEffect(() => {
    if (layoutMode === 'manual') return
    const id = requestAnimationFrame(() => {
      void fitView({ padding: 0.14, duration: 220 })
    })
    return () => cancelAnimationFrame(id)
  }, [devices.length, fitView, layoutMode])

  useEffect(() => {
    if (nodes.length === 0 || didInitialFit.current) return
    didInitialFit.current = true
    const id = requestAnimationFrame(() => {
      fitView({ padding: 0.18, duration: 200 })
    })
    return () => cancelAnimationFrame(id)
  }, [nodes.length, fitView])

  useEffect(() => {
    clearMapHistory()
    setInspectorPeekDeviceId(null)
    setMapSelection(clearSelection())
    prevManualGroupIdsSigRef.current = ''
  }, [networkId, clearMapHistory])

  useEffect(() => {
    setInspectorPeekDeviceId(null)
    setMapSelection((s) => reconcileSelectionForLayoutMode(s, layoutMode))
  }, [layoutMode])

  useEffect(() => {
    const ids = new Set(devices.map((d) => d.id))
    setMapSelection((s) => {
      if (s.kind === 'multi') {
        const next = s.deviceIds.filter((id) => ids.has(id))
        const gs = s.manualGroupIds ?? []
        const incGw = Boolean(s.includeGateway)
        if (next.length === 0) {
          if (gs.length > 0) return selectMixedDevicesAndGroups([], gs, { includeGateway: incGw })
          if (incGw) return selectGateway()
          return clearSelection()
        }
        if (next.length === s.deviceIds.length) return s
        if (gs.length === 0 && !incGw) return selectDevicesMulti(next)
        return selectMixedDevicesAndGroups(next, gs, { includeGateway: incGw })
      }
      return selectionStillValidForDevices(s, ids) ? s : clearSelection()
    })
  }, [devices])

  useEffect(() => {
    const ids = new Set(savedBundle.manualGroups.map((g) => g.id))
    const sig = [...ids].sort().join(',')
    if (sig === prevManualGroupIdsSigRef.current) return
    prevManualGroupIdsSigRef.current = sig
    setMapSelection((s) => (selectionStillValidForManualGroups(s, ids) ? s : clearSelection()))
  }, [savedBundle])

  useLayoutEffect(() => {
    setNodesState((nds) => {
      let changed = false
      const next = nds.map((n) => {
        const mapSel = nodeMatchesMapSelection(n, mapSelection, layoutMode, nds)
        const sharedListHighlight = n.type === 'device' && selectedEquipmentIds.has(n.id)
        const sel = mapSel || sharedListHighlight
        if (n.selected === sel) return n
        changed = true
        return { ...n, selected: sel }
      })
      return changed ? next : nds
    })
  }, [layoutMode, mapSelection, mapGraphRebuildTick, selectedEquipmentIds, setNodesState])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (layoutModeRef.current !== 'manual' || !canRecordHistoryRef.current) return
      const el = e.target
      if (el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]')) {
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) {
          e.preventDefault()
          void handleMapRedo()
        } else {
          e.preventDefault()
          void handleMapUndo()
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        void handleMapRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleMapRedo, handleMapUndo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = e.target
      if (el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]')) {
        return
      }
      setPocAddDeviceOpen(false)
      setPocAddTileHover(null)
      setTraceTypeMenuOpen(false)
      setTraceTypeMenuHover(null)
      setInspectorPeekDeviceId(null)
      setMapTraceAuthoring(null)
      const next = clearSelection()
      setMapSelection(next)
      commitSharedEquipmentFromMapSelection(next)
      blurNonInputFocusInMap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blurNonInputFocusInMap, commitSharedEquipmentFromMapSelection, setMapSelection])

  useEffect(() => {
    if (!pocAddDeviceOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const root = pocAddDeviceSurfaceRef.current
      const t = e.target
      if (!root || !(t instanceof Node)) return
      if (root.contains(t)) return
      setPocAddTileHover(null)
      setPocAddDeviceOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [pocAddDeviceOpen])

  useEffect(() => {
    if (!traceTypeMenuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const root = traceTypeMenuSurfaceRef.current
      const t = e.target
      if (!root || !(t instanceof Node)) return
      if (root.contains(t)) return
      setTraceTypeMenuHover(null)
      setTraceTypeMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [traceTypeMenuOpen])

  useEffect(() => {
    if (!mapTraceAuthoring) {
      setTraceTypeMenuOpen(false)
      setTraceTypeMenuHover(null)
    }
  }, [mapTraceAuthoring])

  /**
   * Capture layout at drag start; `onNodeDragStop` compares to final layout and pushes one history entry.
   * No entries during pointermove — only after drag completes (manual mode).
   */
  const commitManualTracePoc = useCallback(
    async (sourceDeviceId: string, destinationDeviceId: string): Promise<boolean> => {
      const auth = mapTraceAuthoring
      if (!auth || traceCommitInFlightRef.current) return false
      const path = tracePathDraftPointsRef.current
      if (path.length < 1) {
        const msg =
          'Add at least one point on the empty map (click the canvas), then choose the source device again.'
        presentTracePocCommitFeedback({ variant: 'invalid', message: msg }, 8000)
        console.warn('[map trace POC]', msg)
        return false
      }
      if (sourceDeviceId === destinationDeviceId) {
        const msg = 'Destination must be a different device than the source.'
        presentTracePocCommitFeedback({ variant: 'invalid', message: msg }, 8000)
        console.warn('[map trace POC]', msg)
        return false
      }
      const srcDev = devices.find((d) => d.id === sourceDeviceId)
      const dstDev = devices.find((d) => d.id === destinationDeviceId)
      if (!srcDev || !dstDev) {
        const msg = 'One of the devices is no longer on this map. Refresh the layout or pick devices again.'
        presentTracePocCommitFeedback({ variant: 'invalid', message: msg }, 8000)
        console.warn('[map trace POC]', msg)
        return false
      }
      if (auth.traceType === 'Power' && srcDev.deviceType !== 'Router') {
        const msg = 'Power traces (POC): the source device must be a Router.'
        presentTracePocCommitFeedback({ variant: 'invalid', message: msg }, 8000)
        console.warn('[map trace POC]', msg)
        return false
      }
      const nid = networkId?.trim()
      if (!nid) {
        const msg = 'Select a network in the app header before saving a trace.'
        presentTracePocCommitFeedback({ variant: 'invalid', message: msg }, 8000)
        console.warn('[map trace POC]', msg)
        return false
      }
      const snaps = inferSnapIdsForManualTrace(auth.traceType)
      const wrap = flowWrapRef.current
      const srcAnchor =
        wrap != null
          ? getTraceSnapAnchorFlowPosition(wrap, screenToFlowPosition, sourceDeviceId, snaps.sourceSnapPointId)
          : null
      const dstAnchor =
        wrap != null
          ? getTraceSnapAnchorFlowPosition(
              wrap,
              screenToFlowPosition,
              destinationDeviceId,
              snaps.destinationSnapPointId
            )
          : null
      let pathForSave: { x: number; y: number }[]
      if (path.length === 1) {
        pathForSave =
          srcAnchor != null && dstAnchor != null
            ? [{ x: srcAnchor.x, y: srcAnchor.y }, { x: dstAnchor.x, y: dstAnchor.y }]
            : path.map((p) => ({ x: p.x, y: p.y }))
      } else {
        pathForSave = path.map((p) => ({ x: p.x, y: p.y }))
        if (srcAnchor != null) pathForSave[0] = { x: srcAnchor.x, y: srcAnchor.y }
        if (dstAnchor != null && pathForSave.length >= 2) {
          pathForSave[pathForSave.length - 1] = { x: dstAnchor.x, y: dstAnchor.y }
        }
      }
      const epochAtStart = tracePoCEpochRef.current
      traceCommitInFlightRef.current = true
      setTraceCommitSaving(true)
      try {
        await api.upsertMapManualTrace({
          networkId: nid,
          sourceDeviceId,
          destinationDeviceId,
          connectionType: auth.traceType,
          sourceSnapPointId: snaps.sourceSnapPointId,
          destinationSnapPointId: snaps.destinationSnapPointId,
          path: pathForSave
        })
        if (tracePoCEpochRef.current !== epochAtStart) {
          presentTracePocCommitFeedback(
            {
              variant: 'info',
              message:
                'Trace mode or network changed while saving. This attempt was not stored — try again if you still need the trace.'
            },
            7200
          )
          return false
        }
        setTracePathDraftPoints([])
        setTracePathPreviewFlow(null)
        presentTracePocCommitFeedback(
          {
            variant: 'success',
            message:
              'Your manual trace was saved for this network. You can draw another path or exit trace mode (Esc or Cancel trace).'
          },
          5600
        )
        return true
      } catch (e) {
        if (tracePoCEpochRef.current === epochAtStart) {
          const detail = e instanceof Error ? e.message : String(e)
          presentTracePocCommitFeedback(
            {
              variant: 'error',
              message:
                detail.trim().length > 0
                  ? `${detail} If this repeats, check connectivity and try again.`
                  : 'The save request failed. If this repeats, check connectivity and try again.'
            },
            10000
          )
          console.warn('[map trace POC] save failed', detail)
        }
        return false
      } finally {
        traceCommitInFlightRef.current = false
        setTraceCommitSaving(false)
      }
    },
    [api, devices, mapTraceAuthoring, networkId, presentTracePocCommitFeedback, screenToFlowPosition]
  )

  /** Connection-type toggle mid-authoring: reset endpoint + hint so bindings match the active type. */
  const applyTraceAuthoringConnectionType = useCallback((traceType: MapManualTraceConnectionType) => {
    tracePoCEpochRef.current += 1
    setMapTraceAuthoring({ traceType })
    setTraceDraftStartEndpoint(null)
    setTraceDraftRouting(false)
    setTraceDraftEndSnapHover({ kind: 'neutral' })
    setTracePathDraftPoints([])
    setTracePathPreviewFlow(null)
    dismissTracePocCommitFeedback()
  }, [dismissTracePocCommitFeedback])

  const onNodeDragStart = useCallback(
    (_: unknown, node: Node) => {
      if (layoutModeRef.current !== 'manual') {
        dragStartRef.current = null
        return
      }
      const byId = new Map(getNodes().map((n) => [n.id, n]))
      const live = byId.get(node.id) ?? node
      if (live.type === 'device') {
        dragStartRef.current = { kind: 'device', id: live.id, layout: snapDeviceLayout(live, byId) }
      } else if (live.type === 'manualGroup') {
        dragStartRef.current = { kind: 'manualGroup', id: live.id, pos: { ...live.position } }
      } else if (live.type === 'gateway' || live.id === MAP_GATEWAY_NODE_ID) {
        dragStartRef.current = { kind: 'gateway', id: MAP_GATEWAY_NODE_ID, pos: { ...live.position } }
      } else {
        dragStartRef.current = null
      }
    },
    [getNodes]
  )

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const snap = dragStartRef.current
      dragStartRef.current = null

      if (layoutModeRef.current !== 'manual') {
        return
      }

      const nds = getNodes()
      const next =
        node.type === 'device'
          ? applyDeviceGroupDropResolution(nds, node.id, getIntersectingNodes)
          : nds

      setNodesState(next)

      const finalNode = next.find((n) => n.id === node.id)
      if (!snap || !finalNode || !canRecordHistoryRef.current) {
        schedulePersist()
        return
      }

      const byId = new Map(next.map((n) => [n.id, n]))

      if (snap.kind === 'device' && snap.id === node.id && finalNode.type === 'device') {
        const endLayout = snapDeviceLayout(finalNode, byId)
        if (!sameDeviceLayout(snap.layout, endLayout)) {
          const before = snap.layout
          const after: DeviceLayoutSnap = {
            manualGroupId: endLayout.manualGroupId,
            abs: { ...endLayout.abs }
          }
          pushMapHistory({
            type: 'moveDevice',
            undo: () => {
              setNodesState((n) => patchDeviceLayout(n, snap.id, before))
            },
            redo: () => {
              setNodesState((n) => patchDeviceLayout(n, snap.id, after))
            }
          })
        }
      } else if (snap.kind === 'manualGroup' && snap.id === node.id && finalNode.type === 'manualGroup') {
        const endPos = { ...finalNode.position }
        if (!sameXY(snap.pos, endPos)) {
          const start = { ...snap.pos }
          pushMapHistory({
            type: 'moveManualGroup',
            undo: () => setNodesState((n) => patchManualGroupPosition(n, snap.id, start)),
            redo: () => setNodesState((n) => patchManualGroupPosition(n, snap.id, endPos))
          })
        }
      } else if (
        snap.kind === 'gateway' &&
        snap.id === MAP_GATEWAY_NODE_ID &&
        finalNode.id === MAP_GATEWAY_NODE_ID
      ) {
        const endPos = { ...finalNode.position }
        if (!sameXY(snap.pos, endPos)) {
          const start = { ...snap.pos }
          pushMapHistory({
            type: 'moveGateway',
            undo: () => setNodesState((n) => patchGatewayPosition(n, MAP_GATEWAY_NODE_ID, start)),
            redo: () => setNodesState((n) => patchGatewayPosition(n, MAP_GATEWAY_NODE_ID, endPos))
          })
        }
      }

      schedulePersist()
    },
    [getIntersectingNodes, getNodes, pushMapHistory, schedulePersist, setNodesState, setSavedBundle]
  )

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: Node) => {
      const nds = getNodes()
      if (mapTraceAuthoring) {
        const t = e.target
        if (t instanceof HTMLElement && t.closest('.map-device-node__snap-point')) {
          // In trace mode, snap intent must beat device-body intent. Clicking a snap must not
          // be interpreted as a device-body click (selection or otherwise).
          e.stopPropagation()
          return
        }
      }
      if (node.type === 'device') {
        if (deviceChildOfLockedManualGroup(node, nds) && node.parentId) {
          const next = selectManualGroup(node.parentId)
          setMapSelection(next)
          setInspectorPeekDeviceId(node.id)
          return
        }
        setInspectorPeekDeviceId(null)
        const next = selectDevice(node.id)
        setMapSelection(next)
        commitSharedEquipmentFromMapSelection(next)
      } else if (node.type === 'manualGroup') {
        setInspectorPeekDeviceId(null)
        setMapSelection(selectManualGroup(node.id))
        setSelectedEquipmentIds(getDeviceIdsInMapGroup(node.id, nds))
      } else if (node.type === 'autoGroup') {
        setInspectorPeekDeviceId(null)
        const p = parseAutoGroupNodeId(node.id)
        if (p) setMapSelection(selectAutoGroup(p.groupKey, p.autoGroupBy))
        setSelectedEquipmentIds(getDeviceIdsInMapGroup(node.id, nds))
      } else if (node.type === 'gateway' || node.id === MAP_GATEWAY_NODE_ID) {
        setInspectorPeekDeviceId(null)
        setMapSelection(selectGateway())
      }
    },
    [
      commitSharedEquipmentFromMapSelection,
      getNodes,
      mapTraceAuthoring,
      setSelectedEquipmentIds,
      tracePathDraftPoints.length
    ]
  )

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault()
      e.stopPropagation()
      if (layoutModeRef.current !== 'manual') return
      if (node.type === 'manualGroup') {
        const locked = Boolean((node.data as { contentsLocked?: boolean } | undefined)?.contentsLocked ?? true)
        void api.showMapNodeContextMenu({
          x: e.clientX,
          y: e.clientY,
          target: { kind: 'manualGroup', id: node.id, contentsLocked: locked }
        })
      } else if (node.type === 'device') {
        // Reserve device right-click for future actions; keep minimal for now.
        void api.showMapNodeContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'device', id: node.id } })
      }
    },
    [api]
  )

  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      if (suppressNextPaneClickClearRef.current) {
        suppressNextPaneClickClearRef.current = false
        blurNonInputFocusInMap()
        return
      }
      if (mapTraceAuthoring) {
        if (traceDraftStartEndpoint) {
          const p = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          setTracePathDraftPoints((prev) => [...prev, p])
          setTraceDraftRouting(true)
        }
        setInspectorPeekDeviceId(null)
        const next = clearSelection()
        setMapSelection(next)
        commitSharedEquipmentFromMapSelection(next)
        blurNonInputFocusInMap()
        return
      }
      setInspectorPeekDeviceId(null)
      const next = clearSelection()
      setMapSelection(next)
      commitSharedEquipmentFromMapSelection(next)
      blurNonInputFocusInMap()
    },
    [
      blurNonInputFocusInMap,
      commitSharedEquipmentFromMapSelection,
      mapTraceAuthoring,
      screenToFlowPosition,
      traceDraftStartEndpoint
    ]
  )

  useEffect(() => {
    marqueeActiveRef.current = marqueeFlow != null
  }, [marqueeFlow])

  useEffect(() => {
    if (layoutMode !== 'manual') setMapTraceAuthoring(null)
  }, [layoutMode])

  /** Switching LAN exits trace authoring; `mapTraceAuthoring` effect bumps epoch once paths clear. */
  useEffect(() => {
    setMapTraceAuthoring(null)
  }, [networkId])

  useEffect(() => {
    if (!mapTraceAuthoring) {
      tracePoCEpochRef.current += 1
      setTraceDraftStartEndpoint(null)
      setTraceDraftRouting(false)
      setTraceDraftEndSnapHover({ kind: 'neutral' })
      setTracePathDraftPoints([])
      setTracePathPreviewFlow(null)
      dismissTracePocCommitFeedback()
      setTraceSnapHover(null)
      setTraceCommitSaving(false)
    }
  }, [dismissTracePocCommitFeedback, mapTraceAuthoring])

  /** Drop stale snap highlight when trace family changes (inferred target snap id changes). */
  useEffect(() => {
    setTraceSnapHover(null)
    setTraceDraftEndSnapHover({ kind: 'neutral' })
  }, [mapTraceAuthoring?.traceType])

  useEffect(() => {
    if (layoutMode !== 'manual') {
      setTraceSnapHover(null)
      setTraceDraftEndSnapHover({ kind: 'neutral' })
    }
  }, [layoutMode])

  useEffect(() => {
    if (layoutMode !== 'manual') return
    setNodesState((prev) => {
      let changed = false
      const nextNodes = prev.map((n) => {
        if (n.type !== 'device') return n
        const dd = n.data as DeviceNodeData
        const nextSnap = traceSnapHover
        const prevSnap = dd.traceSnapHover ?? null
        const snapSame =
          (prevSnap == null && nextSnap == null) ||
          (prevSnap != null &&
            nextSnap != null &&
            prevSnap.deviceId === nextSnap.deviceId &&
            prevSnap.snapPointId === nextSnap.snapPointId)

        const nextDraft = traceDraftEndSnapHover
        const prevDraft = dd.traceDraftEndSnapHover ?? { kind: 'neutral' as const }
        const draftSame =
          prevDraft.kind === nextDraft.kind &&
          (nextDraft.kind === 'neutral' ||
            (nextDraft.kind === 'validEnd' &&
              prevDraft.kind === 'validEnd' &&
              prevDraft.target.deviceId === nextDraft.target.deviceId &&
              prevDraft.target.snapPointId === nextDraft.target.snapPointId) ||
            (nextDraft.kind === 'invalidEnd' &&
              prevDraft.kind === 'invalidEnd' &&
              prevDraft.target.deviceId === nextDraft.target.deviceId &&
              prevDraft.target.snapPointId === nextDraft.target.snapPointId))

        if (snapSame && draftSame) return n
        changed = true
        return { ...n, data: { ...dd, traceSnapHover: nextSnap, traceDraftEndSnapHover: nextDraft } }
      })
      return changed ? nextNodes : prev
    })
  }, [traceDraftEndSnapHover, traceSnapHover, layoutMode, setNodesState])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      const el = e.target
      if (el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]')) return
      spacePressedRef.current = true
      setSpacePressed(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      spacePressedRef.current = false
      setSpacePressed(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onKeyUp as unknown as EventListener)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onKeyUp as unknown as EventListener)
    }
  }, [])

  const onMarqueeViewportMove = useCallback(() => {
    if (marqueeActiveRef.current) setMarqueeViewportTick((n) => n + 1)
  }, [])

  const onViewportMoveForOverlays = useCallback(() => {
    onMarqueeViewportMove()
    if (
      (mapTraceAuthoringRef.current &&
        (traceDraftStartEndpointRef.current != null ||
          tracePathDraftPointsRef.current.length > 0 ||
          tracePathPreviewFlowRef.current != null)) ||
      manualTracesForViewRef.current.length > 0
    ) {
      setTracePathViewportTick((n) => n + 1)
    }
  }, [onMarqueeViewportMove])

  const onMapFlowPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (layoutModeRef.current !== 'manual' || e.button !== 0 || !e.isPrimary) return
      if (spacePressedRef.current) return
      const auth = mapTraceAuthoringRef.current
      if (auth) {
        const t = e.target
        if (t instanceof HTMLElement) {
          const snapEl = t.closest('.map-device-node__snap-point')
          if (snapEl instanceof HTMLElement) {
            if (traceDraftStartEndpointRef.current) {
              const deviceId = snapEl.dataset.deviceId
              const snapPointId = snapEl.dataset.snapPointId
              if (deviceId && snapPointId) {
                const didCommit = commitSnapDraftToSession({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  endDeviceId: deviceId,
                  endSnapPointId: snapPointId
                })
                if (didCommit) {
                  e.preventDefault()
                  e.stopPropagation()
                  blurNonInputFocusInMap()
                  return
                }
              }
              e.preventDefault()
              e.stopPropagation()
              blurNonInputFocusInMap()
              return
            }
            const deviceId = snapEl.dataset.deviceId
            const snapPointId = snapEl.dataset.snapPointId
            const meta = snapPointId ? getSnapIdentity(snapPointId) : undefined
            const isFamilySnap = meta?.type === auth.traceType
            if (deviceId && snapPointId && isFamilySnap && !traceDraftStartEndpointRef.current) {
              // S1 (TraceArmed) → S2 (DraftAnchored): snap click starts draft anchored to canonical endpoint identity.
              e.preventDefault()
              e.stopPropagation()
              dismissTracePocCommitFeedback()
              setTraceDraftStartEndpoint({ deviceId, snapPointId })
              setTraceDraftRouting(false)
              setTraceDraftEndSnapHover({ kind: 'neutral' })
              setTracePathDraftPoints([])
              setTracePathPreviewFlow(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
              blurNonInputFocusInMap()
              return
            }
            // In trace mode, snaps must not fall through to body click/drag even if not a valid start snap.
            e.preventDefault()
            e.stopPropagation()
            blurNonInputFocusInMap()
            return
          }
        }
        return
      }
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t.closest('.react-flow__node')) return
      if (t.closest('.react-flow__edge')) return
      if (t.closest('input, textarea, select, [contenteditable="true"], button')) return
      if (t.closest('.map-flow-viewport-panel')) return
      if (!t.closest('.react-flow')) return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      marqueeDraftRef.current = { start: pos, current: pos }
      marqueePointerIdRef.current = e.pointerId
      marqueeStartClientRef.current = { x: e.clientX, y: e.clientY }
      marqueeDidActivateRef.current = false
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [blurNonInputFocusInMap, commitSnapDraftToSession, dismissTracePocCommitFeedback, screenToFlowPosition]
  )

  const onMapFlowPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const auth = mapTraceAuthoringRef.current
      const wrap = flowWrapRef.current
      if (auth && wrap && layoutModeRef.current === 'manual') {
        const draftStart = traceDraftStartEndpointRef.current
        if (draftStart) {
          setTraceSnapHover(null)
          const q = pickTraceDraftEndSnapHover(e.clientX, e.clientY, wrap, auth.traceType, draftStart.deviceId)
          setTraceDraftEndSnapHover((prev) => {
            if (prev.kind !== q.kind) return q
            if (q.kind === 'neutral') return prev
            if (
              prev.kind !== 'neutral' &&
              prev.target.deviceId === q.target.deviceId &&
              prev.target.snapPointId === q.target.snapPointId
            ) {
              return prev
            }
            return q
          })
        } else {
          setTraceDraftEndSnapHover({ kind: 'neutral' })
          const hit = pickTraceSnapHoverTarget(
            e.clientX,
            e.clientY,
            wrap,
            auth.traceType,
            null
          )
          setTraceSnapHover((prev) => {
            if (prev?.deviceId === hit?.deviceId && prev?.snapPointId === hit?.snapPointId) return prev
            return hit
          })
        }
      } else {
        setTraceSnapHover((prev) => (prev ? null : prev))
        setTraceDraftEndSnapHover((prev) => (prev.kind === 'neutral' ? prev : { kind: 'neutral' }))
      }
      if (mapTraceAuthoringRef.current && traceDraftStartEndpointRef.current) {
        const t = e.target
        if (
          t instanceof HTMLElement &&
          !t.closest('.map-flow-viewport-panel') &&
          flowWrapRef.current?.contains(t)
        ) {
          setTracePathPreviewFlow(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }
      }
      if (marqueePointerIdRef.current !== e.pointerId || !marqueeDraftRef.current) return
      if (spacePressedRef.current) return
      const startClient = marqueeStartClientRef.current
      if (!startClient) return
      const dx = e.clientX - startClient.x
      const dy = e.clientY - startClient.y
      const dist = Math.hypot(dx, dy)
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const start = marqueeDraftRef.current.start
      marqueeDraftRef.current = { start, current: pos }
      if (!marqueeDidActivateRef.current) {
        // Avoid swallowing simple clicks; only show marquee once the pointer meaningfully moves.
        if (dist < 4) return
        marqueeDidActivateRef.current = true
      }
      setMarqueeFlow({ start, current: pos })
      e.preventDefault()
    },
    [screenToFlowPosition]
  )

  const onMapFlowPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (marqueePointerIdRef.current !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      marqueePointerIdRef.current = null
      const draft = marqueeDraftRef.current
      marqueeDraftRef.current = null
      marqueeStartClientRef.current = null
      const didActivate = marqueeDidActivateRef.current
      marqueeDidActivateRef.current = false
      setMarqueeFlow(null)
      if (!draft) return
      if (!didActivate) {
        // Treat as an empty-pane click (reliable clear) and ignore the ensuing RF onPaneClick.
        suppressNextPaneClickClearRef.current = true
        setInspectorPeekDeviceId(null)
        const cleared = clearSelection()
        setMapSelection(cleared)
        commitSharedEquipmentFromMapSelection(cleared)
        blurNonInputFocusInMap()
        return
      }
      const rect = normalizeFlowRect(draft.start, draft.current)
      if (rect.width < 2 && rect.height < 2) return
      suppressNextPaneClickClearRef.current = true
      const nds = getNodes()
      const leftToRight = draft.current.x >= draft.start.x
      const mode: MarqueeHitMode = leftToRight ? 'contain' : 'intersect'
      let deviceIds = deviceIdsInFlowRect(nds, rect, mode)
      deviceIds = deviceIds.filter((id) => {
        const dn = nds.find((x) => x.id === id)
        return dn ? !deviceChildOfLockedManualGroup(dn, nds) : false
      })
      const groupIds = pickManualGroupIdsInRect(nds, rect, mode)
      const gwHit = gatewayInFlowRect(nds, rect, mode)
      const additive = e.shiftKey
      setInspectorPeekDeviceId(null)
      setMapSelection((cur) => {
        const next = applyMarqueeMapSelection(
          cur,
          { devices: deviceIds, groups: groupIds, gateway: gwHit },
          additive
        )
        commitSharedEquipmentFromMapSelection(next)
        return next
      })
    },
    [blurNonInputFocusInMap, commitSharedEquipmentFromMapSelection, getNodes, setMapSelection]
  )

  const handleCenterView = useCallback(() => {
    void fitView({ padding: 0.2, duration: 280 })
  }, [fitView])

  const handleResetLayout = useCallback(async () => {
    if (layoutMode !== 'manual') return
    const nid = networkId?.trim()
    if (!nid) return
    await api.resetMapLayout(nid)
    clearMapHistory()
    setInspectorPeekDeviceId(null)
    setMapSelection(clearSelection())
    setSavedBundle({ manualGroups: [], positions: {} })
    const gw = networkInfo?.gateway ?? null
    setNodesState(
      buildMapNodes(
        [],
        devices,
        { manualGroups: [], positions: {} },
        gw,
        groupHandlers.current,
        deviceLayoutHandlersRef.current,
        null
      )
    )
    setMapGraphRebuildTick((t) => t + 1)
    setSessionManualTraces([])
    setEdges(buildEdges(devices, manualTracesForView))
    window.setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 60)
  }, [
    api,
    clearMapHistory,
    devices,
    fitView,
    layoutMode,
    manualTracesForView,
    networkId,
    networkInfo?.gateway,
    setEdges,
    setMapGraphRebuildTick,
    setMapSelection,
    setNodesState
  ])

  const handleNewGroup = useCallback(async () => {
    if (layoutMode !== 'manual') return
    const nid = networkId?.trim()
    if (!nid) return
    const el = flowWrapRef.current
    const rect = el?.getBoundingClientRect()
    const center =
      rect != null
        ? screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          })
        : { x: 400, y: 280 }
    const g = await api.createMapManualGroup({
      networkId: nid,
      name: 'New group',
      x: center.x - DEFAULT_NEW_GROUP_W / 2,
      y: center.y - DEFAULT_NEW_GROUP_H / 2,
      width: DEFAULT_NEW_GROUP_W,
      height: DEFAULT_NEW_GROUP_H
    })
    if (canRecordHistoryRef.current) {
      const gid = g.id
      const snap = {
        name: g.name,
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height
      }
      pushMapHistory({
        type: 'createManualGroup',
        undo: async () => {
          await api.deleteMapManualGroup(gid)
        },
        redo: async () => {
          await api.createMapManualGroup({
            networkId: nid,
            name: snap.name,
            x: snap.x,
            y: snap.y,
            width: snap.width,
            height: snap.height
          })
        }
      })
    }
  }, [api, layoutMode, networkId, pushMapHistory, screenToFlowPosition])

  const canPersist = Boolean(networkId?.trim())
  const manualChrome = layoutMode === 'manual'
  const multiSelectDeviceCount = mapSelectionDeviceCount(mapSelection)
  const multiSelectGroupCount = mapSelectionManualGroupCount(mapSelection)
  const multiSelectGatewayCount = mapSelectionGatewayCount(mapSelection)
  const multiSelectStatusParts: string[] = []
  if (multiSelectGatewayCount > 0) multiSelectStatusParts.push('Gateway')
  if (multiSelectGroupCount > 0) {
    multiSelectStatusParts.push(`${multiSelectGroupCount} group${multiSelectGroupCount === 1 ? '' : 's'}`)
  }
  if (multiSelectDeviceCount > 0) {
    multiSelectStatusParts.push(`${multiSelectDeviceCount} device${multiSelectDeviceCount === 1 ? '' : 's'}`)
  }
  canRecordHistoryRef.current = manualChrome && canPersist
  void mapHistTick
  const canMapUndo = manualChrome && undoStackRef.current.length > 0
  const canMapRedo = manualChrome && redoStackRef.current.length > 0

  const focusCreatedDevice = useCallback(
    (deviceId: string) => {
      pendingFocusCreatedDeviceIdRef.current = deviceId
      setInspectorPeekDeviceId(null)
      const next = selectDevice(deviceId)
      setMapSelection(next)
      commitSharedEquipmentFromMapSelection(next)
      blurNonInputFocusInMap()
    },
    [blurNonInputFocusInMap, commitSharedEquipmentFromMapSelection, setMapSelection]
  )

  useEffect(() => {
    const id = pendingFocusCreatedDeviceIdRef.current
    if (!id) return
    const node = nodes.find((n) => n.id === id && n.type === 'device')
    if (!node) return
    pendingFocusCreatedDeviceIdRef.current = null

    const wrap = flowWrapRef.current?.getBoundingClientRect()
    if (!wrap) return
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const abs = absoluteNodePosition(node, byId)
    const screen = flowToScreenPosition(abs)

    const margin = 28
    const visible =
      screen.x >= wrap.left + margin &&
      screen.x <= wrap.right - margin &&
      screen.y >= wrap.top + margin &&
      screen.y <= wrap.bottom - margin

    if (!visible) {
      void setCenter(abs.x + POC_PLACEMENT_DEVICE_W / 2, abs.y + POC_PLACEMENT_DEVICE_H / 2, {
        zoom: getZoom(),
        duration: 220
      })
    }
  }, [flowToScreenPosition, getZoom, nodes, setCenter])

  const createPocMapDevice = useCallback(
    async (slug: MapPocVisualDeviceType) => {
      /**
       * POC vertical slice: toolbar “Add Device” → real `saveDevice` + `saveMapLayout`, select/fit,
       * one `pushMapHistory` entry for create+place. Undo/redo for that entry is recorded only when
       * `pushMapHistory` runs (manual layout + saved network); no drag palette / click-to-place.
       */
      const deviceType = mapPocVisualDeviceTypeDefaultDeviceType(slug)
      const label = mapPocVisualDeviceTypeLabel(slug)
      const nextName = (() => {
        /* Names like "Lighting Fixture 3" from existing persisted POC rows (`deviceTypeCustom` slug). */
        // Seed from already-loaded persisted device list; tie-break with a local ref to avoid
        // collisions when the user creates multiple devices faster than ON_DEVICES_CHANGED pushes.
        const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+(\\\\d+)$`, 'i')
        let maxSeen = 0
        for (const d of devices) {
          if (d.deviceTypeCustom?.trim() !== slug) continue
          const m = re.exec(d.name.trim())
          if (!m) continue
          const n = Number(m[1])
          if (Number.isFinite(n)) maxSeen = Math.max(maxSeen, n)
        }
        const prev = pocNameSeqRef.current[slug] ?? 0
        const next = Math.max(maxSeen, prev) + 1
        pocNameSeqRef.current[slug] = next
        return `${label} ${next}`
      })()
      const nid = networkId?.trim() ?? ''
      const flowViewportCenterTopLeft = (): { x: number; y: number } => {
        const el = flowWrapRef.current
        const rect = el?.getBoundingClientRect()
        const center =
          rect != null
            ? screenToFlowPosition({
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
              })
            : { x: 400, y: 280 }
        return {
          x: center.x - POC_PLACEMENT_DEVICE_W / 2,
          y: center.y - POC_PLACEMENT_DEVICE_H / 2
        }
      }
      const nextCascadeOffset = (): { dx: number; dy: number } => {
        const now = Date.now()
        const s = pocCreateCascadeRef.current
        if (now - s.lastAt > POC_CREATE_CASCADE_RESET_AFTER_MS) {
          s.step = -1
        }
        s.lastAt = now
        s.step = (s.step + 1) % POC_CREATE_CASCADE_STEPS
        return { dx: s.step * POC_CREATE_CASCADE_DX, dy: s.step * POC_CREATE_CASCADE_DY }
      }
      try {
        for (let attempt = 0; attempt < 16; attempt++) {
          const b = new Uint8Array(1)
          crypto.getRandomValues(b)
          const ip = `203.0.113.${2 + (b[0] % 253)}`
          const savePayload: SaveDevicePayload = {
            name: nextName,
            ip,
            subnet: '',
            gateway: '',
            deviceType,
            deviceTypeCustom: slug
          }
          try {
            const created = await api.saveDevice(savePayload)
            const base = flowViewportCenterTopLeft()
            const off = nextCascadeOffset()
            const pos = { x: base.x + off.dx, y: base.y + off.dy }
            if (nid && layoutModeRef.current === 'manual') {
              pocPendingInitialPlacementRef.current[created.id] = {
                x: pos.x,
                y: pos.y,
                manualGroupId: null
              }
            }
            if (nid) {
              try {
                await api.saveMapLayout({
                  networkId: nid,
                  positions: [{ nodeKey: created.id, x: pos.x, y: pos.y, manualGroupId: null }]
                })
              } catch {
                delete pocPendingInitialPlacementRef.current[created.id]
                throw new Error('Could not save map layout for new device')
              }
            }
            focusCreatedDevice(created.id)
            const cmdState = { deviceId: created.id }
            pushMapHistory({
              type: 'pocCreateMapDevice',
              undo: async () => {
                logDeleteFlowPreDelete('map:pocUndoCreateDevice')
                delete pocPendingInitialPlacementRef.current[cmdState.deviceId]
                await api.deleteDevice(cmdState.deviceId)
                setInspectorPeekDeviceId(null)
                const cleared = clearSelection()
                setMapSelection(cleared)
                commitSharedEquipmentFromMapSelection(cleared)
                setNodesState((ns) => ns.map((n) => ({ ...n, selected: false })))
                setEdges((es) => es.map((e) => ({ ...e, selected: false })))
                blurNonInputFocusInMap()
                /* Keyboard IPC resets in-page focus; await then refocus map so nav (“List view”) does not steal it. */
                await prepareAppWindowForKeyboardInput('map:pocUndoCreateDevice')
                requestAnimationFrame(() => {
                  try {
                    flowWrapRef.current?.focus({ preventScroll: true })
                  } catch {
                    /* ignore */
                  }
                })
              },
              redo: async () => {
                const d = await api.saveDevice(savePayload)
                cmdState.deviceId = d.id
                if (nid && layoutModeRef.current === 'manual') {
                  pocPendingInitialPlacementRef.current[d.id] = {
                    x: pos.x,
                    y: pos.y,
                    manualGroupId: null
                  }
                }
                if (nid) {
                  try {
                    await api.saveMapLayout({
                      networkId: nid,
                      positions: [{ nodeKey: d.id, x: pos.x, y: pos.y, manualGroupId: null }]
                    })
                  } catch {
                    delete pocPendingInitialPlacementRef.current[d.id]
                    throw new Error('Could not save map layout for new device')
                  }
                }
                focusCreatedDevice(d.id)
              }
            })
            return
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg.includes('already')) continue
            throw e
          }
        }
        throw new Error('Could not add device (IP collision retries exhausted)')
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Could not add device')
      }
    },
    [
      api,
      devices,
      networkId,
      pushMapHistory,
      screenToFlowPosition,
      setEdges,
      setInspectorPeekDeviceId,
      setMapSelection,
      setNodesState,
      focusCreatedDevice,
      commitSharedEquipmentFromMapSelection,
      blurNonInputFocusInMap
    ]
  )

  return (
    <div className="map-flow-wrap">
      <div className="map-view-workspace">
        {!canPersist ? (
          <p className="muted map-flow__hint map-view-workspace__connect-hint">
            Connect to a network to save map positions. You can still drag nodes locally.
          </p>
        ) : null}
        <div className="map-flow-toolbar map-flow-toolbar--spaced map-view-workspace__toolbar">
        <label className="map-flow-toolbar__mode">
          <span className="map-flow-toolbar__mode-label">Layout</span>
          <select
            value={layoutMode}
            onChange={(e) => setLayoutMode(e.target.value as MapLayoutMode)}
            aria-label="Map layout mode"
          >
            <option value="manual">Manual layout</option>
            <option value="vendor">Group by vendor</option>
            <option value="deviceType">Group by device type</option>
            <option value="subnet">Group by subnet</option>
          </select>
        </label>
        <div ref={pocAddDeviceSurfaceRef} style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className="secondary"
            aria-haspopup="menu"
            aria-expanded={pocAddDeviceOpen}
            onClick={() =>
              setPocAddDeviceOpen((v) => {
                const next = !v
                if (!next) setPocAddTileHover(null)
                if (next) {
                  setTraceTypeMenuOpen(false)
                  setTraceTypeMenuHover(null)
                }
                return next
              })
            }
          >
            Add Device
          </button>
          {pocAddDeviceOpen ? (
            <div
              role="menu"
              aria-label="Add equipment"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                zIndex: 20,
                background: 'var(--panel-bg, #111827)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                padding: 8,
                minWidth: 248,
                boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
              }}
            >
              {(['lighting_fixture', 'network_switch', 'dmx_node'] as const).map((t, i, arr) => {
                const hovered = pocAddTileHover === t
                const dt = mapPocVisualDeviceTypeDefaultDeviceType(t)
                return (
                  <button
                    key={t}
                    type="button"
                    role="menuitem"
                    aria-label={`Add ${mapPocVisualDeviceTypeLabel(t)}`}
                    onMouseEnter={() => setPocAddTileHover(t)}
                    onMouseLeave={() => setPocAddTileHover((cur) => (cur === t ? null : cur))}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      margin: 0,
                      marginBottom: i < arr.length - 1 ? 8 : 0,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                      color: 'inherit',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    onClick={() => {
                      setPocAddDeviceOpen(false)
                      setPocAddTileHover(null)
                      void createPocMapDevice(t)
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 40,
                        height: 40,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(0,0,0,0.18)',
                        fontSize: 20,
                        lineHeight: 1,
                        flex: '0 0 auto'
                      }}
                    >
                      {mapPocVisualDeviceTypeEmoji(t)}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, lineHeight: 1.2 }}>{mapPocVisualDeviceTypeLabel(t)}</span>
                      <span className="muted" style={{ fontSize: 12, lineHeight: 1.2 }}>
                        Device type: {dt}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        {mapTraceAuthoring ? (
          <span className="map-flow-toolbar__trace-poc" role="group" aria-label="Trace authoring (POC)">
            <div ref={traceTypeMenuSurfaceRef} style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                type="button"
                className="secondary"
                aria-haspopup="menu"
                aria-expanded={traceTypeMenuOpen}
                aria-label={`Trace type, current ${mapTraceAuthoring.traceType}`}
                onClick={() =>
                  setTraceTypeMenuOpen((open) => {
                    const next = !open
                    if (next) {
                      setPocAddDeviceOpen(false)
                      setPocAddTileHover(null)
                    }
                    return next
                  })
                }
              >
                Trace type…{' '}
                <span className="muted" style={{ fontWeight: 600 }}>
                  ({mapTraceAuthoring.traceType})
                </span>
              </button>
              {traceTypeMenuOpen ? (
                <div
                  role="menu"
                  aria-label="Trace connection type"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    zIndex: 20,
                    background: 'var(--panel-bg, #111827)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    padding: 8,
                    minWidth: 200,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
                  }}
                >
                  {(['Power', 'DMX', 'Network'] as const).map((family, i, arr) => {
                    const suffix = traceFamilyToCssSuffix(family)
                    const hovered = traceTypeMenuHover === family
                    const selected = mapTraceAuthoring.traceType === family
                    return (
                      <button
                        key={family}
                        type="button"
                        role="menuitem"
                        aria-label={`Trace type ${family}`}
                        aria-current={selected ? 'true' : undefined}
                        className={`secondary map-flow-toolbar__trace-poc-btn map-flow-toolbar__trace-poc-btn--${suffix}${
                          selected ? ' map-flow-toolbar__trace-poc-btn--selected' : ''
                        }`}
                        onMouseEnter={() => setTraceTypeMenuHover(family)}
                        onMouseLeave={() => setTraceTypeMenuHover((cur) => (cur === family ? null : cur))}
                        style={{
                          width: '100%',
                          display: 'block',
                          margin: 0,
                          marginBottom: i < arr.length - 1 ? 8 : 0,
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.14)',
                          background: hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                          color: 'inherit',
                          font: 'inherit',
                          textAlign: 'left',
                          cursor: 'pointer',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                        onClick={() => {
                          setTraceTypeMenuOpen(false)
                          setTraceTypeMenuHover(null)
                          applyTraceAuthoringConnectionType(family)
                        }}
                      >
                        <span style={{ fontWeight: 600, lineHeight: 1.2 }}>{family}</span>
                        {selected ? (
                          <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                            Current
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setTraceTypeMenuOpen(false)
                setTraceTypeMenuHover(null)
                setMapTraceAuthoring(null)
              }}
            >
              Cancel trace
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="secondary"
            disabled={!manualChrome}
            title={
              !manualChrome
                ? 'Switch to Manual layout to use trace mode'
                : 'Enter trace authoring (POC): choose Power, DMX, or Network'
            }
            onClick={() => {
              setPocAddDeviceOpen(false)
              setPocAddTileHover(null)
              dismissTracePocCommitFeedback()
              setMapTraceAuthoring({ traceType: 'DMX' })
            }}
          >
            Trace mode…
          </button>
        )}
        <button type="button" className="secondary" onClick={handleCenterView}>
          Center view
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleMapUndo()}
          disabled={!canMapUndo}
          title={!manualChrome ? 'Undo is only available in Manual layout' : 'Undo (Ctrl+Z)'}
        >
          Undo
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleMapRedo()}
          disabled={!canMapRedo}
          title={!manualChrome ? 'Redo is only available in Manual layout' : 'Redo (Ctrl+Shift+Z or Ctrl+Y)'}
        >
          Redo
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleCollapseAllDevices}
          disabled={!manualChrome}
          title={!manualChrome ? 'Switch to Manual layout to collapse device cards' : 'Collapse all device cards on the map'}
        >
          Collapse all
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleExpandAllDevices}
          disabled={!manualChrome}
          title={!manualChrome ? 'Switch to Manual layout to expand device cards' : 'Expand all device cards on the map'}
        >
          Expand all
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleNewGroup()}
          disabled={!canPersist || !manualChrome}
          title={!manualChrome ? 'Switch to Manual layout to add groups' : undefined}
        >
          + New group
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleResetLayout()}
          disabled={!canPersist || !manualChrome}
          title={!manualChrome ? 'Switch to Manual layout to reset saved positions' : undefined}
        >
          Reset layout
        </button>
      </div>
        <div
          className="map-view-body-grid"
          style={
            { ['--map-inspector-inner-w']: `${inspectorInnerWidthPx}px` } as React.CSSProperties
          }
        >
          <div className="map-view-body-grid__gutter">
            {!manualChrome ? (
              <div className="map-flow-readonly-banner" role="status">
                <span className="map-flow-readonly-banner__title">Auto grouped view</span>
                <span className="map-flow-readonly-banner__meta muted">
                  Manual layout unchanged · read-only · switch to Manual layout to edit positions and groups
                </span>
              </div>
            ) : null}
            {manualChrome ? (
              <>
                {mapTraceAuthoring ? (
                  <div
                    className="map-flow-trace-authoring-banner"
                    role="status"
                    data-trace-family={traceFamilyToCssSuffix(mapTraceAuthoring.traceType)}
                  >
                    <span className="map-flow-trace-authoring-banner__title">Trace authoring (POC)</span>
                    <span className="map-flow-trace-authoring-banner__meta muted">
                      Type <strong>{mapTraceAuthoring.traceType}</strong>
                      {' · '}click empty map to add path points · dashed preview from last point
                      {' · '}
                      Esc or Cancel trace to exit
                    </span>
                    {traceCommitSaving ? (
                      <p
                        className="map-flow-trace-authoring-banner__busy"
                        role="status"
                        aria-live="polite"
                        aria-busy="true"
                      >
                        Saving trace…
                      </p>
                    ) : null}
                    {tracePocCommitFeedback ? (
                      <div
                        className={`map-flow-trace-authoring-banner__feedback map-flow-trace-authoring-banner__feedback--${tracePocCommitFeedback.variant}`}
                        role="alert"
                        aria-live="assertive"
                      >
                        <span className="map-flow-trace-authoring-banner__feedback-title">
                          {tracePocCommitFeedback.variant === 'success'
                            ? 'Saved'
                            : tracePocCommitFeedback.variant === 'invalid'
                              ? "Can't save"
                              : tracePocCommitFeedback.variant === 'error'
                                ? 'Save failed'
                                : 'Notice'}
                        </span>
                        <span className="map-flow-trace-authoring-banner__feedback-msg">
                          {tracePocCommitFeedback.message}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <p className="muted map-flow__hint map-flow__hint--marquee">
                  Manual: left-drag empty space = marquee · Shift+marquee adds · middle-drag or Space+left-drag = pan ·
                  right-click = menu
                </p>
              </>
            ) : (
              <p className="muted map-flow__hint map-flow__hint--marquee">
                Auto view: read-only · left-drag or middle-drag empty space = pan · no marquee
              </p>
            )}
          </div>
          <div className="map-view-body-grid__inspector-top-spacer" aria-hidden />
          <div
            className={`map-flow map-view-body-grid__map${!manualChrome ? ' map-flow--auto-view' : ''}${mapTraceAuthoring ? ' map-flow--trace-authoring' : ''}`}
            ref={flowWrapRef}
            tabIndex={-1}
            {...(mapTraceAuthoring
              ? { 'data-trace-family': traceFamilyToCssSuffix(mapTraceAuthoring.traceType) }
              : {})}
            onPointerDownCapture={onMapFlowPointerDownCapture}
            onPointerMove={onMapFlowPointerMove}
            onPointerUp={onMapFlowPointerUp}
            onPointerLeave={() => {
              if (mapTraceAuthoringRef.current) {
                setTracePathPreviewFlow(null)
                setTraceSnapHover(null)
                setTraceDraftEndSnapHover({ kind: 'neutral' })
              }
            }}
            onMouseDownCapture={(e) => {
              // Suppress Windows/browser middle-click autoscroll UI so RF pan works.
              if (e.button === 1) e.preventDefault()
            }}
            onAuxClick={(e) => {
              if (e.button === 1) e.preventDefault()
            }}
            onContextMenu={(e) => {
              // Canvas context menu deferred; for now reserve right-click and prevent pan/selection side-effects.
              e.preventDefault()
            }}
          >
            <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onPaneContextMenu={(e) => {
            e.preventDefault()
          }}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onMove={onViewportMoveForOverlays}
          nodesDraggable={manualChrome}
          elementsSelectable={false}
          nodesFocusable={false}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          selectionOnDrag={false}
          panOnDrag={
            manualChrome
              ? spacePressed
                ? [0, 1]
                : [1]
              : [0, 1]
          }
          nodesConnectable={false}
          edgesFocusable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          minZoom={0.35}
          maxZoom={1.5}
          translateExtent={translateExtent}
          proOptions={{ hideAttribution: true }}
            >
              <Background color="#2e3440" gap={20} size={1} />
              <Panel position="top-left" className="map-flow-viewport-panel">
                <div className="map-flow-viewport-panel__inner" role="toolbar" aria-label="Map view navigation">
                  <button
                    type="button"
                    className="map-flow-viewport-panel__btn secondary"
                    title="Fit all nodes in view"
                    onClick={() => void handleFitAllMap()}
                  >
                    Fit all
                  </button>
                  <button
                    type="button"
                    className="map-flow-viewport-panel__btn secondary"
                    title="Center on current selection (zoom unchanged)"
                    disabled={!canCenterOnSelection}
                    onClick={() => void handleCenterOnSelection()}
                  >
                    Center selection
                  </button>
                  <button
                    type="button"
                    className="map-flow-viewport-panel__btn secondary"
                    title={`Reset zoom to ${MAP_DEFAULT_ZOOM * 100}%`}
                    onClick={() => void handleResetZoomView()}
                  >
                    Reset zoom
                  </button>
                  <button
                    type="button"
                    className="map-flow-viewport-panel__btn secondary"
                    title="Zoom in"
                    onClick={() => void handleZoomInMap()}
                  >
                    Zoom in
                  </button>
                  <button
                    type="button"
                    className="map-flow-viewport-panel__btn secondary"
                    title="Zoom out"
                    onClick={() => void handleZoomOutMap()}
                  >
                    Zoom out
                  </button>
                </div>
              </Panel>
            </ReactFlow>
            {manualChrome && multiSelectStatusParts.length > 0 ? (
              <div className="map-flow__status-overlay" role="status" aria-live="polite">
                <span className="muted">{multiSelectStatusParts.join(' + ')} selected</span>
              </div>
            ) : null}
            {manualChrome && marqueeFlow ? (
              <MapMarqueeOverlay
                flowRect={normalizeFlowRect(marqueeFlow.start, marqueeFlow.current)}
                wrapEl={flowWrapRef.current}
                flowToScreenPosition={flowToScreenPosition}
                viewportRev={marqueeViewportTick}
              />
            ) : null}
            {manualChrome && mapTraceAuthoring ? (
              <MapTracePathDraftOverlay
                startFlow={
                  traceDraftStartEndpoint && flowWrapRef.current
                    ? getTraceSnapAnchorFlowPosition(
                        flowWrapRef.current,
                        screenToFlowPosition,
                        traceDraftStartEndpoint.deviceId,
                        traceDraftStartEndpoint.snapPointId
                      )
                    : null
                }
                points={tracePathDraftPoints}
                previewFlow={tracePathPreviewFlow}
                wrapEl={flowWrapRef.current}
                flowToScreenPosition={flowToScreenPosition}
                viewportRev={tracePathViewportTick}
                traceFamily={mapTraceAuthoring.traceType}
              />
            ) : null}
            {manualTracesForView.length > 0 ? (
              <MapPersistedManualTracesOverlay
                traces={manualTracesForView}
                wrapEl={flowWrapRef.current}
                flowToScreenPosition={flowToScreenPosition}
                viewportRev={tracePathViewportTick}
              />
            ) : null}
          </div>
          <div
            className="map-view-inspector__resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector panel"
            onPointerDown={onInspectorResizePointerDown}
            onPointerMove={onInspectorResizePointerMove}
            onPointerUp={onInspectorResizePointerUp}
            onPointerCancel={onInspectorResizePointerCancel}
            onLostPointerCapture={onInspectorResizeLostPointerCapture}
          />
          <aside className="map-view-inspector" aria-label="Map selection details">
            <MapViewInspector
              layoutMode={layoutMode}
              mapSelection={mapSelection}
              devices={devices}
              savedBundle={savedBundle}
              networkInfo={networkInfo}
              networkId={networkId}
              nodes={nodes}
              actionsEnabled={manualChrome && canPersist}
              deviceGroups={deviceGroups}
              onSaveDevice={onSaveDevice}
              onManualGroupAutoSize={handleManualGroupAutoSize}
              onManualGroupAutoAlign={handleManualGroupAutoAlign}
              onManualGroupSetLock={handleManualGroupSetLock}
              onCommitManualGroupRename={manualChrome && canPersist ? commitGroupRename : undefined}
              inspectorPeekDeviceId={inspectorPeekDeviceId}
            />
          </aside>
        </div>
      </div>
    </div>
  )
}

export interface MapViewProps {
  devices: Device[]
  networkInfo: NetworkInfo | null
  deviceGroups: DeviceGroup[]
  onSaveDevice: (payload: SaveDevicePayload) => Promise<void>
}

/**
 * Map View shell: React Flow in a theme-colored canvas. Manual layout + manual groups are SQLite-scoped
 * by `networkId`. Phase 2B auto-grouping modes are computed in-memory only (`mapAutoLayout.ts`).
 */
export function MapView({ devices, networkInfo, deviceGroups, onSaveDevice }: MapViewProps): JSX.Element {
  const networkId = networkInfo?.networkId ?? null
  const flowKey = networkId ?? 'no-network'

  return (
    <section className="section map-view-section">
      <div className="section-header">
        <h2>Map view</h2>
      </div>
      <ReactFlowProvider key={flowKey}>
        <MapCanvas
          devices={devices}
          networkInfo={networkInfo}
          networkId={networkId}
          deviceGroups={deviceGroups}
          onSaveDevice={onSaveDevice}
        />
      </ReactFlowProvider>
    </section>
  )
}
