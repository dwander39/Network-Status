/**
 * Predefined trace snap anchors on map device nodes (POC).
 * Persist as opaque strings (e.g. `MapManualTrace.sourceSnapPointId`).
 *
 * Canonical id → { type, role } and trace inference live in `mapDeviceSnapIdentity.ts`.
 */

import type { MapManualTraceConnectionType } from './types'
import { snapPointIdsForTraceConnection } from './mapDeviceSnapIdentity'

export {
  MAP_DEVICE_SNAP_DATA_IN,
  MAP_DEVICE_SNAP_DATA_OUT,
  MAP_DEVICE_SNAP_NETWORK_IN,
  MAP_DEVICE_SNAP_NETWORK_OUT,
  MAP_DEVICE_SNAP_POWER_IN,
  MAP_DEVICE_SNAP_POWER_OUT,
  SNAP_ID_BY_TRACE_KIND_AND_ROLE,
  SNAP_ID_TO_IDENTITY,
  getSnapIdentity,
  getSnapRole,
  getSnapType,
  snapPointIdsForTraceConnection,
  type MapDevicePredefinedSnapPointId,
  type MapDeviceSnapIdentity,
  type MapDeviceSnapSemanticRole,
  type MapDeviceSnapSemanticType
} from './mapDeviceSnapIdentity'

/** Inferred endpoint snap ids from connection type (direction: source → destination). */
export function inferSnapIdsForManualTrace(
  connectionType: MapManualTraceConnectionType
): { sourceSnapPointId: string; destinationSnapPointId: string } {
  return snapPointIdsForTraceConnection(connectionType)
}
