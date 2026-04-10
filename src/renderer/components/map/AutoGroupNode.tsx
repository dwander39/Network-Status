import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'

/**
 * Ephemeral map container for Phase 2B auto-grouping only.
 * Not persisted — unlike `ManualGroupNode`, no rename/delete/drag; styling aligns via shared map tokens.
 * Read-only: parent graph sets `nodesDraggable={false}` in auto modes; no drag handle UI here.
 */
export type AutoGroupFlowNode = Node<
  {
    title: string
    deviceCount: number
    width: number
    height: number
    /** e.g. "Vendor" — clarifies which dimension produced this bucket. */
    groupingKindLabel: string
    /** Softer chrome for fallback buckets (Unknown Vendor / Type / Subnet). */
    isUnknownBucket: boolean
  },
  'autoGroup'
>

function AutoGroupNodeInner({ data, selected }: NodeProps<AutoGroupFlowNode>): JSX.Element {
  const n = data.deviceCount
  const countLabel = `${n} ${n === 1 ? 'device' : 'devices'}`

  return (
    <div
      className={`map-auto-group${data.isUnknownBucket ? ' map-auto-group--unknown' : ''}${
        selected ? ' map-auto-group--selected' : ''
      }`}
      style={{ width: data.width, height: data.height }}
    >
      <div className="map-auto-group__header">
        <div className="map-auto-group__header-text">
          <span className="map-auto-group__kind">{data.groupingKindLabel}</span>
          <span className="map-auto-group__title" title={data.title}>
            {data.title}
          </span>
        </div>
        <span className="map-auto-group__count" aria-label={countLabel}>
          {countLabel}
        </span>
      </div>
    </div>
  )
}

export const AutoGroupNode = memo(AutoGroupNodeInner)
