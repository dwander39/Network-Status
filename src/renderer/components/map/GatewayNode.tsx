import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

export type GatewayFlowNode = Node<{ gatewayIp: string | null }, 'gateway'>

/** Central router/gateway — slightly larger card, same borders/fonts as device nodes. */
function GatewayNodeInner({ data, selected }: NodeProps<GatewayFlowNode>): JSX.Element {
  const ip = data.gatewayIp?.trim() || '—'
  return (
    <div className={`map-gateway-node${selected ? ' map-gateway-node--selected' : ''}`}>
      <div className="map-device-node__name">Gateway</div>
      <div className="map-device-node__type-badge muted map-gateway-node__badge-line">
        <span className="map-device-node__bracket">[</span>
        <span className="map-device-node__badge-core">
          {' '}
          {'📡'}
          {'  '}
          Router{' '}
        </span>
        <span className="map-device-node__bracket">]</span>
      </div>
      <div className="map-device-node__ip map-gateway-node__ip-line">{ip}</div>
      <Handle className="map-flow__handle" type="source" position={Position.Bottom} />
    </div>
  )
}

export const GatewayNode = memo(GatewayNodeInner)
