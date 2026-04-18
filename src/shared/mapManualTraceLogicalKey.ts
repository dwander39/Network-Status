import type { MapManualTrace, MapManualTraceConnectionType } from './types'

/** Stable tuple key for precedence: same network + this triple = one manual replaces matching auto edge. */
export function mapManualTraceLogicalKey(
  sourceDeviceId: string,
  destinationDeviceId: string,
  connectionType: MapManualTraceConnectionType
): string {
  return `${sourceDeviceId}\t${destinationDeviceId}\t${connectionType}`
}

export function mapManualTraceKeyFromRow(t: MapManualTrace): string {
  return mapManualTraceLogicalKey(t.sourceDeviceId, t.destinationDeviceId, t.connectionType)
}
