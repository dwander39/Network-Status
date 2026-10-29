import { describe, expect, it } from 'vitest'
import {
  parseContextMenuRequest,
  parsePurgeDeviceCachePayload,
  sanitizeSelectedIds,
  sanitizeSettingsPatch
} from '../../src/main/ipcValidation'

describe('sanitizeSettingsPatch', () => {
  it('keeps valid fields of a normal settings save', () => {
    expect(
      sanitizeSettingsPatch({
        pingIntervalMs: 5000,
        arpIntervalMs: 45000,
        notifyOnOffline: true,
        listenAdapterNames: ['Ethernet', 'Wi-Fi', 'Ethernet'],
        arpCacheMode: 'app_owned',
        eventLogSeverityOverrides: { DEVICE_OFFLINE: 'critical' }
      })
    ).toEqual({
      pingIntervalMs: 5000,
      arpIntervalMs: 45000,
      notifyOnOffline: true,
      listenAdapterNames: ['Ethernet', 'Wi-Fi'],
      arpCacheMode: 'app_owned',
      eventLogSeverityOverrides: { DEVICE_OFFLINE: 'critical' }
    })
  })

  it('drops wrongly typed, out-of-range and unknown values', () => {
    expect(
      sanitizeSettingsPatch({
        pingIntervalMs: 'fast',
        arpIntervalMs: -1,
        arpEntryTtlMs: Number.POSITIVE_INFINITY,
        notifyOnOffline: 'yes',
        arpCacheMode: 'something',
        listenAdapterNames: [1, 2],
        unknownKey: 'x',
        __proto__: { polluted: true }
      })
    ).toEqual({})
    expect(sanitizeSettingsPatch({ listenAdapterNames: Array.from({ length: 65 }, (_, i) => `a${i}`) })).toEqual({})
  })

  it('filters severity overrides to known event types and severities', () => {
    expect(
      sanitizeSettingsPatch({
        eventLogSeverityOverrides: { DEVICE_ONLINE: 'warning', BOGUS: 'critical', SYSTEM_ERROR: 'catastrophic' }
      })
    ).toEqual({ eventLogSeverityOverrides: { DEVICE_ONLINE: 'warning' } })
  })

  it('rejects a non-object payload', () => {
    expect(() => sanitizeSettingsPatch(null)).toThrow()
    expect(() => sanitizeSettingsPatch([])).toThrow()
    expect(() => sanitizeSettingsPatch('x')).toThrow()
  })
})

describe('parsePurgeDeviceCachePayload', () => {
  it('accepts exactly the two scopes', () => {
    expect(parsePurgeDeviceCachePayload({ scope: 'all', includeArp: true })).toEqual({ scope: 'all', includeArp: true })
    expect(parsePurgeDeviceCachePayload({ scope: 'current_network' })).toEqual({ scope: 'current_network', includeArp: false })
  })
  it('rejects anything else instead of guessing a destructive scope', () => {
    for (const bad of [null, {}, { scope: 'ALL' }, { scope: 'everything' }, 'all']) {
      expect(() => parsePurgeDeviceCachePayload(bad)).toThrow()
    }
    expect(parsePurgeDeviceCachePayload({ scope: 'all', includeArp: 'yes' }).includeArp).toBe(false)
  })
})

describe('sanitizeSelectedIds', () => {
  it('keeps string ids and drops other values', () => {
    expect(sanitizeSelectedIds(['a', 2, null, 'b'])).toEqual(['a', 'b'])
    expect(sanitizeSelectedIds('a')).toEqual([])
  })
  it('rejects an unbounded selection', () => {
    expect(() => sanitizeSelectedIds(Array.from({ length: 10_001 }, (_, i) => String(i)))).toThrow()
  })
})

describe('parseContextMenuRequest', () => {
  it('accepts device and manual-group targets with finite coordinates', () => {
    expect(parseContextMenuRequest({ x: 10.4, y: 20, target: { kind: 'device', id: 'd1' } })).toEqual({
      x: 10.4,
      y: 20,
      target: { kind: 'device', id: 'd1' }
    })
    expect(
      parseContextMenuRequest({ x: 0, y: 0, target: { kind: 'manualGroup', id: 'g', contentsLocked: true } }).target
    ).toEqual({ kind: 'manualGroup', id: 'g', contentsLocked: true })
  })
  it('rejects malformed requests', () => {
    for (const bad of [
      null,
      { x: NaN, y: 0, target: { kind: 'device', id: 'd' } },
      { x: '1', y: 0, target: { kind: 'device', id: 'd' } },
      { x: 0, y: 0, target: { kind: 'other', id: 'd' } },
      { x: 0, y: 0, target: { kind: 'device', id: 5 } },
      { x: 0, y: 0 }
    ]) {
      expect(() => parseContextMenuRequest(bad)).toThrow()
    }
  })
})
