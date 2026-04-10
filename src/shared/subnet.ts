/** IPv4 + netmask helpers for LAN enumeration (ARP subnet sweep). */

import { isValidIPv4 } from './ipValidation'

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map((x) => parseInt(x, 10))
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0) as number
}

function intToIpv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/** True if mask is a contiguous IPv4 netmask (e.g. 255.255.255.0). */
export function isValidNetmask(mask: string): boolean {
  if (!isValidIPv4(mask)) return false
  const m = ipv4ToInt(mask)
  const inv = (~m >>> 0) >>> 0
  if (inv === 0) return true
  return (inv & (inv + 1)) === 0
}

/**
 * All assignable host IPs on the device's LAN (excludes network and broadcast addresses).
 * If host count exceeds `maxHosts`, returns a sampled list (deterministic step size)
 * so large subnets don't cause huge scans.
 */
export function enumerateLanHosts(
  deviceIp: string,
  netmask: string,
  maxHosts = 512
): string[] {
  if (!isValidIPv4(deviceIp) || !isValidNetmask(netmask)) return []
  const ip = ipv4ToInt(deviceIp)
  const m = ipv4ToInt(netmask)
  const network = (ip & m) >>> 0
  const wildcard = (~m >>> 0) >>> 0
  if (wildcard <= 1) return []
  const hostCount = wildcard - 1
  const broadcast = (network | wildcard) >>> 0

  const out: string[] = []
  const step =
    hostCount > maxHosts ? Math.max(1, Math.ceil(hostCount / maxHosts)) : 1
  for (let a = network + 1; a < broadcast; a += step) out.push(intToIpv4(a))
  return out
}

/** Unique host IPs across all saved devices that have a valid netmask (deduped). */
export function collectSweepIpsFromDevices(
  devices: { ip: string; subnet: string }[],
  maxHostsPerLan = 512
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of devices) {
    const subnet = d.subnet?.trim()
    if (!subnet) continue
    for (const ip of enumerateLanHosts(d.ip, subnet, maxHostsPerLan)) {
      if (seen.has(ip)) continue
      seen.add(ip)
      out.push(ip)
    }
  }
  return out
}
