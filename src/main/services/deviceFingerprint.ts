import type { DeviceType } from '@shared/types'

interface FingerprintInput {
  ip: string
  gateway: string
  vendor: string | null
}

/**
 * Basic, explainable fingerprinting heuristics.
 * Intent: be helpful without heavy scanning or admin privileges.
 */
export function inferDeviceType(x: FingerprintInput): DeviceType {
  const ip = (x.ip ?? '').trim()
  const gw = (x.gateway ?? '').trim()
  const vendor = (x.vendor ?? '').toLowerCase()

  // Gateways/routers often sit at .1; also treat the configured gateway as router.
  if (gw && ip === gw) return 'Router'
  if (ip.endsWith('.1')) return 'Router'

  if (vendor.includes('apple')) return 'Phone'
  if (vendor.includes('samsung')) return 'Phone'
  if (vendor.includes('google')) return 'Phone'

  if (vendor.includes('microsoft')) return 'Laptop'
  if (vendor.includes('dell')) return 'Laptop'
  if (vendor.includes('lenovo')) return 'Laptop'
  if (vendor.includes('hp') || vendor.includes('hewlett')) return 'Printer'
  if (vendor.includes('brother')) return 'Printer'
  if (vendor.includes('epson')) return 'Printer'

  if (vendor.includes('sonos')) return 'IoT'
  if (vendor.includes('ring')) return 'IoT'
  if (vendor.includes('nest')) return 'IoT'
  if (vendor.includes('tuya')) return 'IoT'

  return 'Unknown'
}

