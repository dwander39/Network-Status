/**
 * Phase 2B — automatic grouping views (runtime only).
 *
 * Separation from manual layout:
 * - Manual groups + positions live in SQLite (`map_manual_groups`, `map_layout_positions`) and are
 *   edited only in "Manual layout" mode.
 * - Auto grouping builds ephemeral React Flow nodes in memory. IDs use the `auto:` prefix so they
 *   never collide with persisted manual group UUIDs and are never sent to `saveMapLayout`.
 *
 * Runtime grouping: devices are bucketed by vendor / display type / subnet with stable fallback
 * labels. Ordering rules (groups + devices) are deterministic so the map does not “jump” on refresh.
 *
 * Temporary layout: each bucket becomes one `autoGroup` parent node; devices are children placed on
 * a fixed grid inside the container. No physics, no persistence.
 */

import type { Node, XYPosition } from '@xyflow/react'
import { getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import type { Device } from '@shared/types'

import { MAP_GATEWAY_NODE_ID } from './flowIds'

/** Modes that imply ephemeral groups only (no DB writes for group geometry). */
export type MapAutoGroupMode = 'vendor' | 'deviceType' | 'subnet'

/** Canonical bucket labels for missing data — used for sorting (always last) and header styling. */
const UNKNOWN_VENDOR_LABEL = 'Unknown Vendor'
const UNKNOWN_TYPE_LABEL = 'Unknown Type'
const UNKNOWN_SUBNET_LABEL = 'Unknown Subnet'

const UNKNOWN_BY_MODE: Record<MapAutoGroupMode, string> = {
  vendor: UNKNOWN_VENDOR_LABEL,
  deviceType: UNKNOWN_TYPE_LABEL,
  subnet: UNKNOWN_SUBNET_LABEL
}

/** Short labels for auto-group headers (read-only view clarity). */
const GROUPING_KIND_LABEL: Record<MapAutoGroupMode, string> = {
  vendor: 'Vendor',
  deviceType: 'Device type',
  subnet: 'Subnet'
}

const INNER_PAD = 18
/** Must cover header chrome in CSS (kind + title + count); devices start below this. */
const HEADER_H = 54
const CELL_W = 212
const CELL_H = 140
const CELL_GAP = 14
/** Fewer columns = less crowded grids in auto view. */
const MAX_COLS = 3
const FLOW_MAX_X = 1280
const GROUP_GAP_X = 44
const GROUP_GAP_Y = 48
const GATEWAY_Y = 52
const GROUPS_START_Y = 148

function isUnknownBucket(label: string, mode: MapAutoGroupMode): boolean {
  return label === UNKNOWN_BY_MODE[mode]
}

function groupLabelForDevice(d: Device, mode: MapAutoGroupMode): string {
  switch (mode) {
    case 'vendor':
      return d.vendor?.trim() ? d.vendor.trim() : UNKNOWN_VENDOR_LABEL
    case 'deviceType': {
      const t = getDeviceTypeDisplayLabel(d).trim()
      return t.length > 0 ? t : UNKNOWN_TYPE_LABEL
    }
    case 'subnet':
      return d.subnet?.trim() ? d.subnet.trim() : UNKNOWN_SUBNET_LABEL
    default:
      return 'Unknown'
  }
}

/** Stable id for React Flow; not persisted — `auto:` namespace avoids clashes with DB ids. */
export function autoGroupNodeId(mode: MapAutoGroupMode, label: string): string {
  return `auto:${mode}:${encodeURIComponent(label)}`
}

/** Inverse of `autoGroupNodeId` for selection / hit-testing (Phase 2C). */
export function parseAutoGroupNodeId(id: string): { autoGroupBy: MapAutoGroupMode; groupKey: string } | null {
  if (!id.startsWith('auto:')) return null
  const rest = id.slice('auto:'.length)
  const colon = rest.indexOf(':')
  if (colon < 0) return null
  const mode = rest.slice(0, colon)
  const encoded = rest.slice(colon + 1)
  if (mode !== 'vendor' && mode !== 'deviceType' && mode !== 'subnet') return null
  try {
    return { autoGroupBy: mode as MapAutoGroupMode, groupKey: decodeURIComponent(encoded) }
  } catch {
    return null
  }
}

/**
 * Group key ordering: known buckets first (mode-specific), “Unknown *” buckets last, then alpha.
 * Subnet mode: IPv4 + optional prefix length sorted numerically when parseable.
 */
function compareSubnetLabels(a: string, b: string): number {
  const ka = parseIpv4CidrSortKey(a)
  const kb = parseIpv4CidrSortKey(b)
  if (ka && kb) {
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const da = ka[i] ?? 0
      const db = kb[i] ?? 0
      if (da !== db) return da - db
    }
    return 0
  }
  if (ka && !kb) return -1
  if (!ka && kb) return 1
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

/** [o1,o2,o3,o4,prefixLen] for common LAN CIDR strings; else null → string sort fallback. */
function parseIpv4CidrSortKey(s: string): number[] | null {
  const t = s.trim()
  if (!t) return null
  const slash = t.indexOf('/')
  const addr = slash >= 0 ? t.slice(0, slash).trim() : t
  const maskStr = slash >= 0 ? t.slice(slash + 1).trim() : ''
  const octets = addr.split('.').map((x) => parseInt(x.trim(), 10))
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null
  const prefix = maskStr !== '' ? parseInt(maskStr, 10) : 32
  const p = Number.isFinite(prefix) && prefix >= 0 && prefix <= 32 ? prefix : 32
  return [...octets, p]
}

function sortGroupKeys(labels: string[], mode: MapAutoGroupMode): string[] {
  const marker = UNKNOWN_BY_MODE[mode]
  const known = labels.filter((l) => l !== marker)
  const unknowns = labels.filter((l) => l === marker)

  known.sort((a, b) => {
    if (mode === 'subnet') return compareSubnetLabels(a, b)
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
  unknowns.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return [...known, ...unknowns]
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => parseInt(p, 10))
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null
  return nums
}

/**
 * Stable device order within a bucket: display name (trimmed) → IPv4 numeric → id.
 * Same inputs always yield the same order across rerenders.
 */
function compareDevicesInAutoGroup(a: Device, b: Device): number {
  const na = a.name.trim()
  const nb = b.name.trim()
  const nameCmp = na.localeCompare(nb, undefined, { sensitivity: 'base' })
  if (nameCmp !== 0) return nameCmp

  const pa = parseIpv4(a.ip)
  const pb = parseIpv4(b.ip)
  if (pa && pb) {
    for (let i = 0; i < 4; i++) {
      if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
    }
  } else {
    const ipCmp = a.ip.localeCompare(b.ip, undefined, { numeric: true })
    if (ipCmp !== 0) return ipCmp
  }
  return a.id.localeCompare(b.id)
}

function gridDims(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 1, rows: 1 }
  const cols = Math.min(MAX_COLS, count)
  const rows = Math.ceil(count / cols)
  return { cols, rows }
}

function groupFrameSize(deviceCount: number): { width: number; height: number } {
  const { cols, rows } = gridDims(deviceCount)
  const w = INNER_PAD * 2 + cols * CELL_W + (cols > 1 ? (cols - 1) * CELL_GAP : 0)
  const h = INNER_PAD * 2 + HEADER_H + rows * CELL_H + (rows > 1 ? (rows - 1) * CELL_GAP : 0)
  return { width: w, height: h }
}

/**
 * Buckets devices, sorts groups and members, then places non-overlapping auto-group frames + child device nodes.
 */
export function buildAutoLayoutNodes(devices: Device[], mode: MapAutoGroupMode, gatewayIp: string | null): Node[] {
  const buckets = new Map<string, Device[]>()
  for (const d of devices) {
    const label = groupLabelForDevice(d, mode)
    const list = buckets.get(label)
    if (list) list.push(d)
    else buckets.set(label, [d])
  }

  const sortedKeys = sortGroupKeys([...buckets.keys()], mode)
  const groupingKindLabel = GROUPING_KIND_LABEL[mode]

  const groupMetas = sortedKeys.map((label) => {
    const members = buckets.get(label)!
    members.sort(compareDevicesInAutoGroup)
    const { width, height } = groupFrameSize(members.length)
    return {
      label,
      members,
      width,
      height,
      isUnknownBucket: isUnknownBucket(label, mode)
    }
  })

  let x = 52
  let y = GROUPS_START_Y
  let rowH = 0
  const groupPositions: XYPosition[] = []
  for (const g of groupMetas) {
    if (x + g.width > FLOW_MAX_X && x > 52) {
      x = 52
      y += rowH + GROUP_GAP_Y
      rowH = 0
    }
    groupPositions.push({ x, y })
    rowH = Math.max(rowH, g.height)
    x += g.width + GROUP_GAP_X
  }

  const gatewayNode: Node = {
    id: MAP_GATEWAY_NODE_ID,
    type: 'gateway',
    position: { x: 420, y: GATEWAY_Y },
    zIndex: 2,
    data: { gatewayIp },
    draggable: false,
    selectable: true
  }

  const groupNodes: Node[] = []
  const deviceNodes: Node[] = []

  groupMetas.forEach((g, i) => {
    const pos = groupPositions[i]!
    const gid = autoGroupNodeId(mode, g.label)
    groupNodes.push({
      id: gid,
      type: 'autoGroup',
      position: pos,
      zIndex: 0,
      style: { width: g.width, height: g.height },
      draggable: false,
      selectable: false,
      data: {
        title: g.label,
        deviceCount: g.members.length,
        width: g.width,
        height: g.height,
        groupingKindLabel,
        isUnknownBucket: g.isUnknownBucket
      }
    })

    const { cols } = gridDims(g.members.length)
    const originX = INNER_PAD
    const originY = INNER_PAD + HEADER_H

    g.members.forEach((d, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      deviceNodes.push({
        id: d.id,
        type: 'device',
        parentId: gid,
        position: {
          x: originX + col * (CELL_W + CELL_GAP),
          y: originY + row * (CELL_H + CELL_GAP)
        },
        zIndex: 1,
        data: { device: d },
        draggable: false,
        selectable: true,
        extent: 'parent'
      })
    })
  })

  return [gatewayNode, ...groupNodes, ...deviceNodes]
}
