import { networkInterfaces } from 'os'
import type { NetworkAdapter, NetworkAdapterAddress } from '@shared/types'

export function listNetworkAdapters(): NetworkAdapter[] {
  const raw = networkInterfaces()
  const out: NetworkAdapter[] = []

  for (const [name, addrs] of Object.entries(raw)) {
    if (!addrs || addrs.length === 0) continue
    const addresses: NetworkAdapterAddress[] = addrs.map((a) => ({
      address: a.address,
      netmask: a.netmask,
      family: a.family === 'IPv6' ? 'IPv6' : 'IPv4',
      internal: a.internal
    }))
    out.push({ name, addresses })
  }

  // Stable ordering in UI: prefer non-internal, then name.
  out.sort((a, b) => {
    const ai = a.addresses.every((x) => x.internal) ? 1 : 0
    const bi = b.addresses.every((x) => x.internal) ? 1 : 0
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })

  return out
}

