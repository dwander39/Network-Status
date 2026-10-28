import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { Device } from '@shared/types'
import { MAP_GATEWAY_NODE_ID } from '../../src/renderer/components/map/flowIds'
import {
  autoGroupNodeId,
  buildAutoLayoutNodes,
  parseAutoGroupNodeId
} from '../../src/renderer/components/map/mapAutoLayout'
import { deviceIdsInFlowRect, normalizeFlowRect } from '../../src/renderer/components/map/mapMarquee'
import {
  computeMapTranslateExtent,
  MAP_TRANSLATE_EXTENT_MARGIN_FLOW,
  MAP_TRANSLATE_EXTENT_MIN_HALF
} from '../../src/renderer/components/map/mapViewport'

function device(id: string, vendor: string | null): Device {
  return {
    id,
    name: id,
    ip: `10.0.0.${id.length}`,
    subnet: '255.255.255.0',
    gateway: '10.0.0.1',
    macAddress: null,
    vendor,
    deviceType: 'Unknown',
    deviceTypeCustom: null,
    lastStatus: 'unknown',
    lastChecked: null,
    groupId: null,
    groupName: null
  }
}

describe('auto group node ids', () => {
  it('round-trips labels with reserved characters', () => {
    const id = autoGroupNodeId('vendor', 'Acme: Labs/Ltd')
    expect(parseAutoGroupNodeId(id)).toEqual({ autoGroupBy: 'vendor', groupKey: 'Acme: Labs/Ltd' })
  })

  it('rejects non-auto and unknown-mode ids', () => {
    expect(parseAutoGroupNodeId('device-123')).toBeNull()
    expect(parseAutoGroupNodeId('auto:color:red')).toBeNull()
  })
})

describe('buildAutoLayoutNodes', () => {
  it('emits gateway, one frame per bucket (Unknown last), and parented device nodes', () => {
    const nodes = buildAutoLayoutNodes(
      [device('a', 'Zeta'), device('b', null), device('c', 'Acme'), device('d', 'Acme')],
      'vendor',
      '10.0.0.1'
    )
    expect(nodes[0]).toMatchObject({ id: MAP_GATEWAY_NODE_ID, type: 'gateway', data: { gatewayIp: '10.0.0.1' } })

    const groups = nodes.filter((n) => n.type === 'autoGroup')
    expect(groups.map((g) => (g.data as { title: string }).title)).toEqual(['Acme', 'Zeta', 'Unknown Vendor'])
    expect(groups.map((g) => (g.data as { deviceCount: number }).deviceCount)).toEqual([2, 1, 1])

    const devices = nodes.filter((n) => n.type === 'device')
    expect(devices).toHaveLength(4)
    expect(devices.find((n) => n.id === 'b')?.parentId).toBe(autoGroupNodeId('vendor', 'Unknown Vendor'))
  })
})

describe('marquee hit testing', () => {
  it('normalizes rectangles drawn in any direction', () => {
    expect(normalizeFlowRect({ x: 10, y: 50 }, { x: 0, y: 20 })).toEqual({ x: 0, y: 20, width: 10, height: 30 })
  })

  it('distinguishes intersect and contain modes using absolute (parented) positions', () => {
    const nodes = [
      { id: 'g', type: 'manualGroup', position: { x: 100, y: 100 }, data: {} },
      { id: 'd1', type: 'device', parentId: 'g', position: { x: 10, y: 10 }, width: 50, height: 50, data: {} },
      { id: 'd2', type: 'device', position: { x: 500, y: 500 }, width: 50, height: 50, data: {} }
    ] as Node[]
    const rect = { x: 100, y: 100, width: 40, height: 40 }
    expect(deviceIdsInFlowRect(nodes, rect, 'intersect')).toEqual(['d1'])
    expect(deviceIdsInFlowRect(nodes, rect, 'contain')).toEqual([])
    expect(deviceIdsInFlowRect(nodes, { x: 100, y: 100, width: 100, height: 100 }, 'contain')).toEqual(['d1'])
  })
})

describe('computeMapTranslateExtent', () => {
  it('falls back to the minimum floor for empty/degenerate bounds', () => {
    const h = MAP_TRANSLATE_EXTENT_MIN_HALF
    expect(computeMapTranslateExtent({ x: 0, y: 0, width: 0, height: 0 })).toEqual([
      [-h, -h],
      [h, h]
    ])
  })

  it('adds the margin around large content', () => {
    const m = MAP_TRANSLATE_EXTENT_MARGIN_FLOW
    const [[minX, minY], [maxX, maxY]] = computeMapTranslateExtent({ x: 0, y: 0, width: 4000, height: 3000 })
    expect([minX, minY, maxX, maxY]).toEqual([-m, -m, 4000 + m, 3000 + m])
  })
})
