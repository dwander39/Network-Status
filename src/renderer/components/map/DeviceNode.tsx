import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { emojiForDeviceTypeDisplay, getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import {
  mapPocVisualDeviceTypeEmoji,
  mapPocVisualDeviceTypeLabel,
  parseMapPocVisualDeviceType
} from '@shared/mapPocVisualDeviceTypes'
import { inferSnapIdsForManualTrace, MAP_DEVICE_SNAP_DATA_IN, MAP_DEVICE_SNAP_DATA_OUT } from '@shared/mapDeviceSnapPoints'
import { traceFamilyToCssSuffix } from '@shared/mapTraceFamilyVisual'
import type { TraceSnapHoverTarget } from '@shared/mapTraceSnapHoverPick'
import type { TraceDraftEndSnapHover } from '@shared/mapTraceSnapDraftEndHoverPick'
import type { Device, DeviceType, MapManualTraceConnectionType } from '@shared/types'

const DMX_TRACE_FAMILY: MapManualTraceConnectionType = 'DMX'

export type DeviceNodeData = {
  device: Device
  /** Manual map only — collapse UI and persistence apply when set. */
  mapManualLayout?: boolean
  mapDeviceCollapsed?: boolean
  onToggleMapDeviceCollapsed?: () => void
  /** Step 12: map-local proximity highlight (presentation only). */
  traceSnapHover?: TraceSnapHoverTarget | null
  /** Step 2.3: draft-time end snap hover qualification (presentation only). */
  traceDraftEndSnapHover?: TraceDraftEndSnapHover
  /** Phase 2: active authoring family (controls which snap handles are rendered). */
  traceAuthoringType?: MapManualTraceConnectionType | null
}

export type DeviceFlowNode = Node<DeviceNodeData, 'device'>

/** Icon-only density control (expanded card: collapse to compact row). */
const ICON_COLLAPSE = '\u25BE'
/** Icon-only density control (collapsed row: expand full card). */
const ICON_EXPAND = '\u25B8'

function emojiForDeviceType(t: DeviceType): string {
  switch (t) {
    case 'Laptop':
      return '🖥️'
    case 'Phone':
      return '📱'
    case 'Printer':
      return '🖨️'
    case 'Router':
      return '📡'
    case 'IoT':
      return '🔌'
    default:
      return '❔'
  }
}

function statusLabel(status: Device['lastStatus']): string {
  if (status === 'online') return 'Online'
  if (status === 'offline') return 'Offline'
  return 'Unknown'
}

/** Layout: name / [ type ] / IP / status (dot + label). Selection chrome comes from MapCanvas `node.selected`. */
function DeviceNodeInner({ data, selected }: NodeProps<DeviceFlowNode>): JSX.Element {
  const d = data.device
  const manual = Boolean(data.mapManualLayout)
  const collapsed = Boolean(data.mapDeviceCollapsed)
  const statusClass =
    d.lastStatus === 'online'
      ? 'status-online'
      : d.lastStatus === 'offline'
        ? 'status-offline'
        : 'status-unknown'
  const pocType = parseMapPocVisualDeviceType(d)
  const displayType = pocType != null ? mapPocVisualDeviceTypeLabel(pocType) : getDeviceTypeDisplayLabel(d)
  const emoji =
    pocType != null ? mapPocVisualDeviceTypeEmoji(pocType) : emojiForDeviceTypeDisplay(d, emojiForDeviceType)

  const stopControl = (e: React.SyntheticEvent) => {
    e.stopPropagation()
  }

  const collapseTitle = collapsed ? 'Expand device card' : 'Collapse device card'

  const activeType: MapManualTraceConnectionType =
    data.traceAuthoringType ?? DMX_TRACE_FAMILY
  const inferred = inferSnapIdsForManualTrace(activeType)
  const snapInId = inferred.destinationSnapPointId
  const snapOutId = inferred.sourceSnapPointId

  const hover = data.traceSnapHover
  const draftHover = data.traceDraftEndSnapHover ?? { kind: 'neutral' as const }
  const dmxInHover =
    hover != null && hover.deviceId === d.id && hover.snapPointId === snapInId
  const dmxOutHover =
    hover != null && hover.deviceId === d.id && hover.snapPointId === snapOutId
  const dmxInDraftValid =
    draftHover.kind === 'validEnd' &&
    draftHover.target.deviceId === d.id &&
    draftHover.target.snapPointId === snapInId
  const dmxOutDraftValid =
    draftHover.kind === 'validEnd' &&
    draftHover.target.deviceId === d.id &&
    draftHover.target.snapPointId === snapOutId
  const dmxInDraftInvalid =
    draftHover.kind === 'invalidEnd' &&
    draftHover.target.deviceId === d.id &&
    draftHover.target.snapPointId === snapInId
  const dmxOutDraftInvalid =
    draftHover.kind === 'invalidEnd' &&
    draftHover.target.deviceId === d.id &&
    draftHover.target.snapPointId === snapOutId

  return (
    <div
      className={`map-device-node${selected ? ' map-device-node--selected' : ''}${collapsed ? ' map-device-node--collapsed' : ''}${manual && !collapsed ? ' map-device-node--manual-expanded' : ''}`}
    >
      <Handle className="map-flow__handle" type="target" position={Position.Top} />
      <Handle
        id={snapInId}
        className={`map-device-node__snap-point map-device-node__snap-point--in nodrag nopan${
          dmxInDraftValid
            ? ' map-device-node__snap-point--trace-hover-valid'
            : dmxInDraftInvalid
              ? ' map-device-node__snap-point--trace-hover-invalid'
              : dmxInHover
                ? ' map-device-node__snap-point--trace-hover'
                : ''
        }`}
        type="target"
        position={Position.Left}
        isConnectable={false}
        data-trace-family={traceFamilyToCssSuffix(activeType)}
        data-device-id={d.id}
        data-snap-point-id={snapInId}
        title={`Trace anchor: ${activeType} in`}
        aria-label={`Trace anchor ${activeType} in`}
      />
      <Handle
        id={snapOutId}
        className={`map-device-node__snap-point map-device-node__snap-point--out nodrag nopan${
          dmxOutDraftValid
            ? ' map-device-node__snap-point--trace-hover-valid'
            : dmxOutDraftInvalid
              ? ' map-device-node__snap-point--trace-hover-invalid'
              : dmxOutHover
                ? ' map-device-node__snap-point--trace-hover'
                : ''
        }`}
        type="source"
        position={Position.Right}
        isConnectable={false}
        data-trace-family={traceFamilyToCssSuffix(activeType)}
        data-device-id={d.id}
        data-snap-point-id={snapOutId}
        title={`Trace anchor: ${activeType} out`}
        aria-label={`Trace anchor ${activeType} out`}
      />
      {collapsed ? (
        <div className="map-device-node__collapsed-row">
          <span
            className={`status-dot map-device-node__collapsed-dot ${statusClass}`}
            title={d.lastStatus}
            aria-hidden
          />
          <span className="map-device-node__name map-device-node__name--collapsed">{d.name}</span>
          {manual ? (
            <button
              type="button"
              className="map-device-node__density-btn map-device-node__density-btn--row-end nodrag nopan"
              title={collapseTitle}
              aria-label={collapseTitle}
              aria-expanded={false}
              onClick={(e) => {
                stopControl(e)
                data.onToggleMapDeviceCollapsed?.()
              }}
              onPointerDown={stopControl}
              onMouseDown={stopControl}
            >
              <span aria-hidden>{ICON_EXPAND}</span>
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {manual ? (
            <button
              type="button"
              className="map-device-node__density-btn map-device-node__density-btn--corner nodrag nopan"
              title={collapseTitle}
              aria-label={collapseTitle}
              aria-expanded
              onClick={(e) => {
                stopControl(e)
                data.onToggleMapDeviceCollapsed?.()
              }}
              onPointerDown={stopControl}
              onMouseDown={stopControl}
            >
              <span aria-hidden>{ICON_COLLAPSE}</span>
            </button>
          ) : null}
          <div className="map-device-node__name">{d.name}</div>
          <div className="map-device-node__type-badge muted">
            <span className="map-device-node__bracket">[</span>
            <span className="map-device-node__badge-core">
              {' '}
              {emoji}
              {'  '}
              {displayType}{' '}
            </span>
            <span className="map-device-node__bracket">]</span>
          </div>
          <div className="map-device-node__ip">{d.ip}</div>
          <div className="map-device-node__status">
            <span className={`status-dot ${statusClass}`} title={d.lastStatus} aria-hidden />
            <span className="map-device-node__status-label">{statusLabel(d.lastStatus)}</span>
          </div>
        </>
      )}
      <Handle className="map-flow__handle" type="source" position={Position.Bottom} />
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeInner)
