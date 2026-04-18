/**
 * Canonical semantic identity for predefined map trace snap point ids (POC).
 * Persisted traces store opaque ids; this module is the single place that maps id → { type, role }.
 */

import type { MapManualTraceConnectionType } from './types'

/** In / Out relative to device topology for trace authoring (source uses Out, destination uses In). */
export type MapDeviceSnapSemanticRole = 'In' | 'Out'

/** Family of the anchor; aligned with `MapManualTraceConnectionType` (v1.1). */
export type MapDeviceSnapSemanticType = MapManualTraceConnectionType

export type MapDeviceSnapIdentity = {
  type: MapDeviceSnapSemanticType
  role: MapDeviceSnapSemanticRole
}

/** Stable string ids on handles / persisted rows (do not rename without migration). */
export const MAP_DEVICE_SNAP_DATA_IN = 'data-in'
export const MAP_DEVICE_SNAP_DATA_OUT = 'data-out'
export const MAP_DEVICE_SNAP_POWER_IN = 'power-in'
export const MAP_DEVICE_SNAP_POWER_OUT = 'power-out'
export const MAP_DEVICE_SNAP_NETWORK_IN = 'network-in'
export const MAP_DEVICE_SNAP_NETWORK_OUT = 'network-out'

/**
 * Authoritative pairing: trace kind → role → snap id.
 * Inference uses Out at source and In at destination for the active `connectionType`.
 */
export const SNAP_ID_BY_TRACE_KIND_AND_ROLE: Record<
  MapManualTraceConnectionType,
  Record<MapDeviceSnapSemanticRole, string>
> = {
  Power: { In: MAP_DEVICE_SNAP_POWER_IN, Out: MAP_DEVICE_SNAP_POWER_OUT },
  DMX: { In: MAP_DEVICE_SNAP_DATA_IN, Out: MAP_DEVICE_SNAP_DATA_OUT },
  Network: { In: MAP_DEVICE_SNAP_NETWORK_IN, Out: MAP_DEVICE_SNAP_NETWORK_OUT }
}

function buildSnapIdToIdentity(): Record<string, MapDeviceSnapIdentity> {
  const out: Record<string, MapDeviceSnapIdentity> = {}
  for (const type of ['Power', 'DMX', 'Network'] as const) {
    const row = SNAP_ID_BY_TRACE_KIND_AND_ROLE[type]
    out[row.In] = { type, role: 'In' }
    out[row.Out] = { type, role: 'Out' }
  }
  return out
}

/** snap id → explicit type + role (all predefined anchors). */
export const SNAP_ID_TO_IDENTITY: Readonly<Record<string, MapDeviceSnapIdentity>> = buildSnapIdToIdentity()

export type MapDevicePredefinedSnapPointId =
  (typeof SNAP_ID_BY_TRACE_KIND_AND_ROLE)[MapManualTraceConnectionType][MapDeviceSnapSemanticRole]

export function getSnapIdentity(snapId: string): MapDeviceSnapIdentity | undefined {
  return SNAP_ID_TO_IDENTITY[snapId]
}

export function getSnapType(snapId: string): MapDeviceSnapSemanticType | undefined {
  return getSnapIdentity(snapId)?.type
}

export function getSnapRole(snapId: string): MapDeviceSnapSemanticRole | undefined {
  return getSnapIdentity(snapId)?.role
}

/** Inferred endpoint snap ids for a manual trace row (source → destination). */
export function snapPointIdsForTraceConnection(
  connectionType: MapManualTraceConnectionType
): { sourceSnapPointId: string; destinationSnapPointId: string } {
  const ids = SNAP_ID_BY_TRACE_KIND_AND_ROLE[connectionType]
  return {
    sourceSnapPointId: ids.Out,
    destinationSnapPointId: ids.In
  }
}
