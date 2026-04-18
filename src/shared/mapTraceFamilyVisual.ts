/**
 * Presentation helpers for typed trace families (Power / DMX / Network).
 * Stroke/fill values live in `design-tokens.css` as `--map-trace-family-*`; logic must not depend on this module.
 */

import type { MapManualTraceConnectionType } from './types'

/** Lowercase BEM / `data-trace-family` token (not the persisted connection_type string). */
export type MapTraceFamilyVisualSuffix = 'power' | 'dmx' | 'network'

export function traceFamilyToCssSuffix(family: MapManualTraceConnectionType): MapTraceFamilyVisualSuffix {
  switch (family) {
    case 'Power':
      return 'power'
    case 'DMX':
      return 'dmx'
    case 'Network':
      return 'network'
  }
}

/** Classes for persisted manual trace polylines (stroke from tokens via `--poly--*` rules). */
export function persistedManualTracePolylineClassName(family: MapManualTraceConnectionType): string {
  const s = traceFamilyToCssSuffix(family)
  return `map-manual-traces-overlay__poly map-manual-traces-overlay__poly--${s}`
}

/** SVG root class for in-progress draft path; descendant selectors apply family stroke. */
export function draftTracePathOverlayRootClassName(family: MapManualTraceConnectionType): string {
  const s = traceFamilyToCssSuffix(family)
  return `map-trace-path-draft-overlay map-trace-path-draft-overlay--${s}`
}
