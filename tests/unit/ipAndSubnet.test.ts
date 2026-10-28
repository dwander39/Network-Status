import { describe, expect, it } from 'vitest'
import { assertValidIPv4, isValidIPv4 } from '@shared/ipValidation'
import { collectSweepIpsFromDevices, enumerateLanHosts, isValidNetmask } from '@shared/subnet'

describe('isValidIPv4', () => {
  it.each(['0.0.0.0', '192.168.1.1', '255.255.255.255', ' 10.0.0.1 '])('accepts %s', (ip) => {
    expect(isValidIPv4(ip)).toBe(true)
  })

  it.each(['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', 'a.b.c.d', '', '1.2.3.4/24'])('rejects %s', (ip) => {
    expect(isValidIPv4(ip)).toBe(false)
  })

  it('assertValidIPv4 throws a labelled error', () => {
    expect(() => assertValidIPv4('Gateway', 'nope')).toThrow('Gateway must be a valid IPv4 address')
  })
})

describe('isValidNetmask', () => {
  it('accepts contiguous masks only', () => {
    expect(isValidNetmask('255.255.255.0')).toBe(true)
    expect(isValidNetmask('255.255.252.0')).toBe(true)
    expect(isValidNetmask('255.255.255.255')).toBe(true)
    expect(isValidNetmask('255.0.255.0')).toBe(false)
    expect(isValidNetmask('255.255.255.1')).toBe(false)
  })
})

describe('enumerateLanHosts', () => {
  it('lists host addresses excluding network and broadcast', () => {
    expect(enumerateLanHosts('192.168.1.77', '255.255.255.252')).toEqual(['192.168.1.77', '192.168.1.78'])
  })

  it('covers a full /24 as 254 hosts', () => {
    const hosts = enumerateLanHosts('10.0.0.42', '255.255.255.0')
    expect(hosts).toHaveLength(254)
    expect(hosts[0]).toBe('10.0.0.1')
    expect(hosts[253]).toBe('10.0.0.254')
  })

  it('samples large subnets down to at most maxHosts', () => {
    const hosts = enumerateLanHosts('10.0.0.1', '255.255.0.0', 512)
    expect(hosts.length).toBeLessThanOrEqual(512)
    expect(hosts.length).toBeGreaterThan(400)
    expect(new Set(hosts).size).toBe(hosts.length)
  })

  it('returns nothing for /31, /32, or invalid input', () => {
    expect(enumerateLanHosts('10.0.0.1', '255.255.255.254')).toEqual([])
    expect(enumerateLanHosts('10.0.0.1', '255.255.255.255')).toEqual([])
    expect(enumerateLanHosts('bad', '255.255.255.0')).toEqual([])
    expect(enumerateLanHosts('10.0.0.1', '255.0.255.0')).toEqual([])
  })
})

describe('collectSweepIpsFromDevices', () => {
  it('dedupes across devices on the same LAN and skips devices without a subnet', () => {
    const ips = collectSweepIpsFromDevices([
      { ip: '192.168.5.10', subnet: '255.255.255.252' },
      { ip: '192.168.5.9', subnet: '255.255.255.252' },
      { ip: '172.16.0.1', subnet: '' }
    ])
    expect(ips).toEqual(['192.168.5.9', '192.168.5.10'])
  })
})
