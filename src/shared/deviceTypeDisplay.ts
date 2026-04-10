import type { Device, DeviceType } from './types'

export const DEVICE_TYPE_CUSTOM_MAX_LEN = 64

/** User override label; empty after trim is treated as none. */
export function normalizeDeviceTypeCustom(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const t = raw.trim()
  if (!t) return null
  return t.length > DEVICE_TYPE_CUSTOM_MAX_LEN ? t.slice(0, DEVICE_TYPE_CUSTOM_MAX_LEN) : t
}

/**
 * Label shown in list, map, and alert “device type” matching.
 * Prefers user `deviceTypeCustom` when set; otherwise the inferred enum.
 */
export function getDeviceTypeDisplayLabel(d: Pick<Device, 'deviceType' | 'deviceTypeCustom'>): string {
  const c = d.deviceTypeCustom?.trim()
  if (c) return c
  return d.deviceType
}

/** Emoji for map node: custom types use generic icon. */
export function emojiForDeviceTypeDisplay(
  d: Pick<Device, 'deviceType' | 'deviceTypeCustom'>,
  emojiForEnum: (t: DeviceType) => string
): string {
  if (d.deviceTypeCustom?.trim()) return '❔'
  return emojiForEnum(d.deviceType)
}
