import { DEVICE_TYPE_CUSTOM_MAX_LEN } from './deviceTypeDisplay'
import { isValidIPv4 } from './ipValidation'
import type { Device } from './types'

/** Same rule as `DeviceForm`: show custom type when adding, Unknown, or already has a custom label. */
export function showDeviceTypeCustomField(device: Pick<Device, 'deviceType' | 'deviceTypeCustom'> | null): boolean {
  if (!device) return true
  return device.deviceType === 'Unknown' || Boolean(device.deviceTypeCustom?.trim())
}

export interface DeviceFormFieldValues {
  name: string
  ip: string
  subnet: string
  gateway: string
  deviceTypeCustom: string
}

/** Mirrors validation in `DeviceForm` submit (source of truth for add/edit device). */
export function validateDeviceFormFieldValues(
  values: DeviceFormFieldValues,
  showCustomTypeField: boolean
): string | null {
  if (!values.name.trim()) return 'Name is required.'
  if (!isValidIPv4(values.ip)) return 'IP address must be valid IPv4.'
  if (values.subnet.trim() && !isValidIPv4(values.subnet)) return 'Subnet mask must be valid IPv4.'
  if (values.gateway.trim() && !isValidIPv4(values.gateway)) return 'Gateway must be valid IPv4.'
  if (showCustomTypeField && values.deviceTypeCustom.trim().length > DEVICE_TYPE_CUSTOM_MAX_LEN) {
    return `Custom type must be at most ${DEVICE_TYPE_CUSTOM_MAX_LEN} characters.`
  }
  return null
}
