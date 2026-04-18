import type { MapManualTraceConnectionType } from './types'

const KNOWN: ReadonlySet<MapManualTraceConnectionType> = new Set(['Power', 'DMX', 'Network'])

/** Normalize legacy `Data` rows (v1) to `DMX`; unknown values default to `DMX`. */
export function normalizeMapManualTraceConnectionType(raw: string): MapManualTraceConnectionType {
  const t = String(raw).trim()
  if (t === 'Data') return 'DMX'
  if (KNOWN.has(t as MapManualTraceConnectionType)) return t as MapManualTraceConnectionType
  return 'DMX'
}
