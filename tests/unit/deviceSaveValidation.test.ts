import { describe, expect, it } from 'vitest'
import {
  collectDeviceFormValidationRejections,
  showDeviceTypeCustomField,
  validateDeviceFormFieldValues
} from '@shared/deviceSaveValidation'
import { DEVICE_TYPE_CUSTOM_MAX_LEN } from '@shared/deviceTypeDisplay'

const valid = { name: 'Router', ip: '192.168.1.1', subnet: '', gateway: '', deviceTypeCustom: '' }

describe('collectDeviceFormValidationRejections', () => {
  it('accepts a minimal valid device (blank subnet/gateway allowed)', () => {
    expect(collectDeviceFormValidationRejections(valid, true)).toEqual([])
  })

  it('reports every invalid field with a stable field key and code', () => {
    const r = collectDeviceFormValidationRejections(
      { name: '  ', ip: '999.1.1.1', subnet: 'x', gateway: '1.2.3', deviceTypeCustom: '' },
      false
    )
    expect(r.map((x) => [x.fieldKey, x.code])).toEqual([
      ['name', 'required'],
      ['ip', 'invalid_format'],
      ['subnet', 'invalid_format'],
      ['gateway', 'invalid_format']
    ])
  })

  it('limits custom type length only when the custom field applies', () => {
    const long = { ...valid, deviceTypeCustom: 'x'.repeat(DEVICE_TYPE_CUSTOM_MAX_LEN + 1) }
    expect(collectDeviceFormValidationRejections(long, true).map((r) => r.code)).toEqual(['max_length'])
    expect(collectDeviceFormValidationRejections(long, false)).toEqual([])
  })
})

describe('validateDeviceFormFieldValues', () => {
  it('returns the first rejection reason or null', () => {
    expect(validateDeviceFormFieldValues(valid, true)).toBeNull()
    expect(validateDeviceFormFieldValues({ ...valid, ip: '' }, true)).toBe('IP address must be valid IPv4.')
  })
})

describe('showDeviceTypeCustomField', () => {
  it('shows for new devices, Unknown types, and existing custom labels', () => {
    expect(showDeviceTypeCustomField(null)).toBe(true)
    expect(showDeviceTypeCustomField({ deviceType: 'Unknown', deviceTypeCustom: null })).toBe(true)
    expect(showDeviceTypeCustomField({ deviceType: 'Router', deviceTypeCustom: 'Core' })).toBe(true)
    expect(showDeviceTypeCustomField({ deviceType: 'Router', deviceTypeCustom: '  ' })).toBe(false)
  })
})
