import { describe, expect, it } from 'vitest'
import { normalizeNetworkId, parseIpconfigWindows } from '../../src/main/services/networkDetection'

describe('normalizeNetworkId', () => {
  it('keeps canonical gateway|cidr ids and strips whitespace', () => {
    expect(normalizeNetworkId(' 192.168.1.1 | 192.168.1.0/24 ')).toBe('192.168.1.1|192.168.1.0/24')
  })

  it('drops the SSID from legacy ssid|gateway|cidr ids', () => {
    expect(normalizeNetworkId('HomeWifi|192.168.1.1|192.168.1.0/24')).toBe('192.168.1.1|192.168.1.0/24')
  })

  it('returns an empty string for blank input', () => {
    expect(normalizeNetworkId('   ')).toBe('')
  })
})

describe('parseIpconfigWindows', () => {
  it('prefers the adapter whose gateway is on its own subnet', () => {
    const out = [
      'Windows IP Configuration',
      '',
      'Ethernet adapter vEthernet (WSL):',
      '   IPv4 Address. . . . . . . . . . . : 172.20.0.1(Preferred)',
      '   Subnet Mask . . . . . . . . . . . : 255.255.240.0',
      '   Default Gateway . . . . . . . . . : 10.99.0.1',
      '',
      'Wireless LAN adapter Wi-Fi:',
      '   IPv4 Address. . . . . . . . . . . : 192.168.1.50(Preferred)',
      '   Subnet Mask . . . . . . . . . . . : 255.255.255.0',
      '   Default Gateway . . . . . . . . . : 192.168.1.1'
    ].join('\r\n')
    expect(parseIpconfigWindows(out)).toEqual({
      ipv4: '192.168.1.50',
      netmask: '255.255.255.0',
      gateway: '192.168.1.1'
    })
  })

  it('reads a gateway printed on the line after the label (IPv6 first, IPv4 next)', () => {
    const out = [
      'Ethernet adapter Ethernet:',
      '   IPv4 Address. . . . . . . . . . . : 10.0.0.20(Preferred)',
      '   Subnet Mask . . . . . . . . . . . : 255.255.255.0',
      '   Default Gateway . . . . . . . . . : ',
      '                                       10.0.0.1'
    ].join('\r\n')
    expect(parseIpconfigWindows(out)?.gateway).toBe('10.0.0.1')
  })

  it('ignores adapters without a usable gateway', () => {
    const out = [
      'Ethernet adapter Ethernet:',
      '   IPv4 Address. . . . . . . . . . . : 10.0.0.20(Preferred)',
      '   Subnet Mask . . . . . . . . . . . : 255.255.255.0',
      '   Default Gateway . . . . . . . . . : 0.0.0.0'
    ].join('\r\n')
    expect(parseIpconfigWindows(out)).toBeNull()
  })
})
