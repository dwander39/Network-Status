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

/** Per-field outcomes for unified mutation / inspector paths (no throw). */
export interface DeviceFieldValidationRejection {
  fieldKey: string
  reason: string
  code?: string
}

/**
 * Central validation for user-editable device form fields. Used by the main-process mutation
 * service and by `validateDeviceFormFieldValues` for renderer forms.
 */
export function collectDeviceFormValidationRejections(
  values: DeviceFormFieldValues,
  showCustomTypeField: boolean
): DeviceFieldValidationRejection[] {
  const rejected: DeviceFieldValidationRejection[] = []
  if (!values.name.trim()) {
    rejected.push({ fieldKey: 'name', reason: 'Name is required.', code: 'required' })
  }
  if (!isValidIPv4(values.ip)) {
    rejected.push({ fieldKey: 'ip', reason: 'IP address must be valid IPv4.', code: 'invalid_format' })
  }
  if (values.subnet.trim() && !isValidIPv4(values.subnet)) {
    rejected.push({ fieldKey: 'subnet', reason: 'Subnet mask must be valid IPv4.', code: 'invalid_format' })
  }
  if (values.gateway.trim() && !isValidIPv4(values.gateway)) {
    rejected.push({ fieldKey: 'gateway', reason: 'Gateway must be valid IPv4.', code: 'invalid_format' })
  }
  if (showCustomTypeField && values.deviceTypeCustom.trim().length > DEVICE_TYPE_CUSTOM_MAX_LEN) {
    rejected.push({
      fieldKey: 'deviceTypeCustom',
      reason: `Custom type must be at most ${DEVICE_TYPE_CUSTOM_MAX_LEN} characters.`,
      code: 'max_length'
    })
  }
  return rejected
}

/** Mirrors validation in `DeviceForm` submit (source of truth for add/edit device). */
export function validateDeviceFormFieldValues(
  values: DeviceFormFieldValues,
  showCustomTypeField: boolean
): string | null {
  const r = collectDeviceFormValidationRejections(values, showCustomTypeField)
  return r[0]?.reason ?? null
}
