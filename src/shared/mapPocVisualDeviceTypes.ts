import type { Device, DeviceType } from './types'

/**
 * Map View — visual device creation POC (v1), Step 1.
 * Three starter kinds (`Lighting Fixture`, `Network Switch`, `DMX Node`); **temporary** use of
 * `deviceTypeCustom` as a stable slug carrier until a real equipment-type model exists.
 * Map badge uses emoji + label here; `mapPocVisualDeviceTypeDefaultDeviceType` supplies the persisted
 * `device_type` column for new POC rows only (not a general taxonomy).
 */
export const MAP_POC_VISUAL_DEVICE_TYPE_SLUGS = ['lighting_fixture', 'network_switch', 'dmx_node'] as const

export type MapPocVisualDeviceType = (typeof MAP_POC_VISUAL_DEVICE_TYPE_SLUGS)[number]

const SLUG_SET: ReadonlySet<string> = new Set(MAP_POC_VISUAL_DEVICE_TYPE_SLUGS)

/** Distinct emoji per POC type (Map node badge). */
export function mapPocVisualDeviceTypeEmoji(t: MapPocVisualDeviceType): string {
  switch (t) {
    case 'lighting_fixture':
      return '💡'
    case 'network_switch':
      return '🔀'
    case 'dmx_node':
      return '🎛️'
  }
}

/** Human label for UI (Map badge); matches product names. */
export function mapPocVisualDeviceTypeLabel(t: MapPocVisualDeviceType): string {
  switch (t) {
    case 'lighting_fixture':
      return 'Lighting Fixture'
    case 'network_switch':
      return 'Network Switch'
    case 'dmx_node':
      return 'DMX Node'
  }
}

export function parseMapPocVisualDeviceType(
  d: Pick<Device, 'deviceTypeCustom'>
): MapPocVisualDeviceType | null {
  const s = d.deviceTypeCustom?.trim()
  if (!s) return null
  return SLUG_SET.has(s) ? (s as MapPocVisualDeviceType) : null
}

/** Persisted `device_type` for POC creates only (small fixed mapping per slug). */
export function mapPocVisualDeviceTypeDefaultDeviceType(t: MapPocVisualDeviceType): DeviceType {
  switch (t) {
    case 'lighting_fixture':
      return 'IoT'
    case 'network_switch':
      return 'Router'
    case 'dmx_node':
      return 'IoT'
  }
}
