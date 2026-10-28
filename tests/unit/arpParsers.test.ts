import { describe, expect, it } from 'vitest'
import { parseArpDarwin, parseArpWindows } from '../../src/main/services/arpService'

describe('parseArpWindows', () => {
  const sample = [
    '',
    'Interface: 192.168.1.50 --- 0x7',
    '  Internet Address      Physical Address      Type',
    '  192.168.1.1           AA-BB-CC-DD-EE-01     dynamic',
    '  192.168.1.20          aa-bb-cc-dd-ee-02     dynamic',
    '  192.168.1.255         ff-ff-ff-ff-ff-ff     static',
    '',
    'Interface: 10.0.0.5 --- 0x12',
    '  Internet Address      Physical Address      Type',
    '  10.0.0.1              11-22-33-44-55-66     dynamic',
    '  10.0.0.9              not-a-mac             dynamic'
  ].join('\r\n')

  it('normalizes MACs to lowercase colon form and attributes rows to the mapped interface', () => {
    const rows = parseArpWindows(sample, new Map([['192.168.1.50', 'Ethernet']]))
    expect(rows.slice(0, 2)).toEqual([
      { ip: '192.168.1.1', macAddress: 'aa:bb:cc:dd:ee:01', vendor: null, iface: 'Ethernet' },
      { ip: '192.168.1.20', macAddress: 'aa:bb:cc:dd:ee:02', vendor: null, iface: 'Ethernet' }
    ])
  })

  it('leaves iface null when the interface IP is not a known adapter (so filtering keeps the row)', () => {
    const rows = parseArpWindows(sample, new Map([['192.168.1.50', 'Ethernet']]))
    expect(rows.find((r) => r.ip === '10.0.0.1')).toEqual({
      ip: '10.0.0.1',
      macAddress: '11:22:33:44:55:66',
      vendor: null,
      iface: null
    })
  })

  it('skips lines without a valid MAC', () => {
    const rows = parseArpWindows(sample, new Map())
    expect(rows.map((r) => r.ip)).not.toContain('10.0.0.9')
    expect(rows).toHaveLength(4)
  })
})

describe('parseArpDarwin', () => {
  it('parses common macOS lines, pads single-digit octets, and skips incomplete entries', () => {
    const text = [
      '? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]',
      '? (192.168.1.7) at 0:11:2:33:4:55 on en0 ifscope [ethernet]',
      '? (192.168.1.9) at (incomplete) on en0 ifscope [ethernet]',
      'garbage line'
    ].join('\n')
    expect(parseArpDarwin(text)).toEqual([
      { ip: '192.168.1.1', macAddress: 'aa:bb:cc:dd:ee:ff', vendor: null, iface: 'en0' },
      { ip: '192.168.1.7', macAddress: '00:11:02:33:04:55', vendor: null, iface: 'en0' }
    ])
  })

  it('accepts lines without an interface token', () => {
    expect(parseArpDarwin('host.local (10.1.2.3) at de:ad:be:ef:00:01')).toEqual([
      { ip: '10.1.2.3', macAddress: 'de:ad:be:ef:00:01', vendor: null, iface: null }
    ])
  })
})
