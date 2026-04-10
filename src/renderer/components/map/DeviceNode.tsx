import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { emojiForDeviceTypeDisplay, getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import type { Device, DeviceType } from '@shared/types'

export type DeviceFlowNode = Node<{ device: Device }, 'device'>

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
  const statusClass =
    d.lastStatus === 'online'
      ? 'status-online'
      : d.lastStatus === 'offline'
        ? 'status-offline'
        : 'status-unknown'
  const displayType = getDeviceTypeDisplayLabel(d)
  const emoji = emojiForDeviceTypeDisplay(d, emojiForDeviceType)

  return (
    <div className={`map-device-node${selected ? ' map-device-node--selected' : ''}`}>
      <Handle className="map-flow__handle" type="target" position={Position.Top} />
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
      <Handle className="map-flow__handle" type="source" position={Position.Bottom} />
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeInner)
