import { describe, expect, it } from 'vitest'
import { normalizeMapManualTraceConnectionType } from '@shared/mapManualTraceConnectionType'
import { mapManualTraceLogicalKey } from '@shared/mapManualTraceLogicalKey'
import { maxPocVisualDeviceNameSeq, parseMapPocVisualDeviceType } from '@shared/mapPocVisualDeviceTypes'

describe('normalizeMapManualTraceConnectionType', () => {
  it('keeps known types, maps legacy Data to DMX, and defaults unknowns to DMX', () => {
    expect(normalizeMapManualTraceConnectionType('Power')).toBe('Power')
    expect(normalizeMapManualTraceConnectionType(' Network ')).toBe('Network')
    expect(normalizeMapManualTraceConnectionType('Data')).toBe('DMX')
    expect(normalizeMapManualTraceConnectionType('fibre')).toBe('DMX')
  })
})

describe('mapManualTraceLogicalKey', () => {
  it('is direction- and type-sensitive', () => {
    const k = mapManualTraceLogicalKey('a', 'b', 'Power')
    expect(k).toBe(mapManualTraceLogicalKey('a', 'b', 'Power'))
    expect(k).not.toBe(mapManualTraceLogicalKey('b', 'a', 'Power'))
    expect(k).not.toBe(mapManualTraceLogicalKey('a', 'b', 'DMX'))
  })
})

describe('parseMapPocVisualDeviceType', () => {
  it('recognizes POC slugs only', () => {
    expect(parseMapPocVisualDeviceType({ deviceTypeCustom: ' dmx_node ' })).toBe('dmx_node')
    expect(parseMapPocVisualDeviceType({ deviceTypeCustom: 'Core switch' })).toBeNull()
    expect(parseMapPocVisualDeviceType({ deviceTypeCustom: null })).toBeNull()
  })
})

describe('maxPocVisualDeviceNameSeq', () => {
  // Regression: the inline regex in MapView double-escaped `\d`, so persisted numbers were never
  // seen and POC names restarted at "… 1" after every reload.
  it('finds the highest persisted number for the same POC type', () => {
    const devices = [
      { name: 'Lighting Fixture 2', deviceTypeCustom: 'lighting_fixture' },
      { name: 'lighting fixture 11', deviceTypeCustom: 'lighting_fixture' },
      { name: 'Lighting Fixture 40', deviceTypeCustom: 'dmx_node' },
      { name: 'Lighting Fixture spare', deviceTypeCustom: 'lighting_fixture' }
    ]
    expect(maxPocVisualDeviceNameSeq('lighting_fixture', devices)).toBe(11)
  })

  it('returns 0 when nothing matches', () => {
    expect(maxPocVisualDeviceNameSeq('network_switch', [{ name: 'Switch 3', deviceTypeCustom: 'network_switch' }])).toBe(0)
  })
})
