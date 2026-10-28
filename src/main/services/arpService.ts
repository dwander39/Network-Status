import { execFile } from 'child_process'
import { promisify } from 'util'
import type Database from 'better-sqlite3'
import {
  upsertArpBatch,
  pruneArpEntriesOlderThan,
  type ArpUpsertRow
} from '../db/arpRepository'
import {
  computeNetworkContext,
  getLastNetworkContext,
  getStableNetworkId
} from './networkDetection'
import { onMacAddressChangeConfirmed } from './alertRulesEngine'
import { listDevices } from '../db/deviceRepository'
import { getSettings } from '../db/settingsRepository'
import { lookupVendor } from './vendorLookup'
import { probeHost, tcpTouchHost } from './pingService'
import { collectSweepIpsFromDevices, enumerateLanHosts } from '@shared/subnet'
import { listNetworkAdapters } from './networkAdapterService'
import type { EventType } from '@shared/types'
import { EventLogService } from './eventLogService'
import { EVENT_LOG_NETWORK_UNKNOWN } from '@shared/eventLog'
import { getDeviceByIp } from '../db/deviceRepository'
import { applyDiscoveryUpdate } from './equipmentMutationService'

const execFileAsync = promisify(execFile)

/** Kill hung OS tools (e.g. a stalled ipconfig/netsh/arp) so polling falls back to its normal failure path. */
const OS_COMMAND_TIMEOUT_MS = 15_000

const SWEEP_CONCURRENCY = 24
const SWEEP_PING_TIMEOUT_SEC = 1

let scanInFlight: Promise<void> | null = null

async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  const n = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

/**
 * Optional ICMP sweep of LANs implied by saved devices (IP + netmask), so the OS neighbor
 * table is populated before we read it. MACs still come from the OS neighbor table afterward.
 */
async function pingSweep(db: Database.Database): Promise<void> {
  const settings = getSettings(db)
  const devices = listDevices(db)

  // Prefer sweeping based on active adapter IPv4+netmask to avoid bad user-entered subnets.
  const allowed = new Set(settings.listenAdapterNames)
  const adapters = listNetworkAdapters().filter((a) => allowed.has(a.name))
  const adapterSweepIps: string[] = []
  const seen = new Set<string>()
  for (const a of adapters) {
    for (const addr of a.addresses) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      for (const ip of enumerateLanHosts(addr.address, addr.netmask, 512)) {
        if (seen.has(ip)) continue
        seen.add(ip)
        adapterSweepIps.push(ip)
      }
    }
  }

  // Also sweep saved-device subnets if provided (deduped); this helps when OS netmask is odd.
  const deviceSweepIps = collectSweepIpsFromDevices(devices, 512)
  for (const ip of deviceSweepIps) {
    if (seen.has(ip)) continue
    seen.add(ip)
    adapterSweepIps.push(ip)
  }

  // Always ping known devices first (best signal-to-cost).
  const knownIps = devices.map((d) => d.ip).filter(Boolean)
  const ips = [...new Set([...knownIps, ...adapterSweepIps])]
  if (ips.length === 0) return
  await runPool(ips, SWEEP_CONCURRENCY, async (ip) => {
    const alive = await probeHost(ip, SWEEP_PING_TIMEOUT_SEC)
    if (!alive && settings.arpTcpTouch) {
      await tcpTouchHost(ip)
    }
    return alive
  })
}

/**
 * Read the OS neighbor list (`arp -a`). This is still the portable way to get IP→MAC;
 * raw Ethernet ARP would need admin / Npcap and native code.
 */
type OsArpRow = ArpUpsertRow & { iface: string | null }

export async function readOsArpTable(): Promise<OsArpRow[]> {
  const platform = process.platform
  let stdout: string
  try {
    if (platform === 'win32') {
      const r = await execFileAsync('arp', ['-a'], { encoding: 'utf8', timeout: OS_COMMAND_TIMEOUT_MS, windowsHide: true })
      stdout = r.stdout
    } else {
      const r = await execFileAsync('arp', ['-a'], { encoding: 'utf8', timeout: OS_COMMAND_TIMEOUT_MS })
      stdout = r.stdout
    }
  } catch {
    return []
  }

  const ipToIfaceName = new Map<string, string>()
  if (platform === 'win32') {
    for (const a of listNetworkAdapters()) {
      for (const addr of a.addresses) {
        if (addr.family === 'IPv4' && addr.address) ipToIfaceName.set(addr.address, a.name)
      }
    }
  }

  const parsed =
    platform === 'win32'
      ? parseArpWindows(stdout, ipToIfaceName)
      : parseArpDarwin(stdout)

  // Deduplicate by IP; prefer rows with an interface name and valid MAC.
  // Some systems can emit duplicates across contexts; we want stable results.
  const byIp = new Map<string, OsArpRow>()
  for (const r of parsed) {
    const ip = r.ip.trim()
    if (!ip) continue
    const existing = byIp.get(ip)
    if (!existing) {
      byIp.set(ip, r)
      continue
    }
    const exIface = existing.iface ? 1 : 0
    const rIface = r.iface ? 1 : 0
    if (rIface > exIface) byIp.set(ip, r)
    else if (r.macAddress && !existing.macAddress) byIp.set(ip, r)
    else if (existing.macAddress !== r.macAddress && existing.macAddress && r.macAddress) {
      // Keep existing, but log for debugging. We avoid "last write wins" instability.
      console.warn(`[arp] conflict for ${ip}: ${existing.macAddress} vs ${r.macAddress}`)
    }
  }

  return [...byIp.values()].map((r) => ({ ...r, vendor: lookupVendor(r.macAddress) }))
}

/**
 * Refresh ARP data: optionally subnet-sweep, read OS neighbor table, merge into SQLite.
 * `mirror_os` matches OS snapshot; `app_owned` merges and ages out by TTL instead.
 */
export async function scanArpCache(db: Database.Database, eventLogs?: EventLogService): Promise<void> {
  if (scanInFlight) return scanInFlight

  scanInFlight = (async () => {
  try {
  const settings = getSettings(db)

  // When user picked no adapters, discovery is disabled (do not wipe other LANs' ARP history).
  if (settings.listenAdapterNames.length === 0) {
    return
  }

  if (settings.arpCacheMode === 'app_owned' && settings.arpSubnetSweep) {
    await pingSweep(db)
  }

  const allowedIfaces = new Set(settings.listenAdapterNames)
  const osRows = await readOsArpTable()
  const rows = osRows
    // If we can't attribute an entry to an interface (mapping/parsing variance),
    // keep it rather than silently dropping it. This prevents over-filtering on Windows.
    .filter((r) => (r.iface ? allowedIfaces.has(r.iface) : true))
    .map(({ iface: _iface, ...rest }) => rest)
  const seenIso = new Date().toISOString()
  const snapshotPrune = settings.arpCacheMode === 'mirror_os'
  // Tag rows with the LAN we’re on *now* — stable id can lag or be null before the first poll tick.
  const live = await computeNetworkContext()
  const networkId =
    live?.networkId ?? getStableNetworkId() ?? getLastNetworkContext()?.networkId ?? null

  // Scope for logging when network context isn't available yet.
  const scopeId = networkId ?? EVENT_LOG_NETWORK_UNKNOWN

  // Discovery dedupe: capture what we already know for this network scope before merge so we only log
  // DEVICE_DISCOVERED once per first-seen IP within that networkId.
  const oldMacByIp = new Map<string, string>()
  if (networkId) {
    const ips = rows.map((r) => r.ip.trim()).filter(Boolean)
    if (ips.length) {
      const unique = [...new Set(ips)]
      const placeholders = unique.map(() => '?').join(',')
      const existing = db
        .prepare(
          `SELECT ip, mac_address FROM arp_entries WHERE network_id = ? AND ip IN (${placeholders})`
        )
        .all(networkId, ...unique) as { ip: string; mac_address: string }[]
      for (const r of existing) oldMacByIp.set(String(r.ip), String(r.mac_address))
    }
  }

  upsertArpBatch(db, rows, seenIso, {
    snapshotPrune,
    networkId,
    onDiscoveryDeviceArpRow: (input) => {
      applyDiscoveryUpdate(
        db,
        { lookupIp: input.lookupIp },
        { normalizedMac: input.normalizedMac, arpVendor: input.arpVendor },
        { source: 'discovery' }
      )
    },
    onMacChangeConfirmed: (ev) => {
      onMacAddressChangeConfirmed(db, ev, networkId, eventLogs)
      eventLogs?.log({
        eventType: 'MAC_ADDRESS_CHANGED' as EventType,
        networkId: scopeId,
        ipAddress: ev.ip,
        macAddress: ev.newMac,
        message: `MAC changed for ${ev.ip}: ${ev.oldMac} → ${ev.newMac}`,
        metadata: { oldMac: ev.oldMac, newMac: ev.newMac, vendor: ev.vendor }
      })
    }
  })

  // DEVICE_DISCOVERED: log only truly new IPs in this scan scope.
  // Never use SSID to scope/identify; `networkId` (or an explicit unknown sentinel) is the key.
  if (eventLogs) {
    let logged = 0
    for (const r of rows) {
      if (logged >= 100) break
      const ip = r.ip.trim()
      if (!ip) continue
      if (networkId && oldMacByIp.has(ip)) continue
      const saved = getDeviceByIp(db, ip)
      eventLogs.log({
        eventType: 'DEVICE_DISCOVERED' as EventType,
        networkId: scopeId,
        deviceId: saved?.id ?? null,
        ipAddress: ip,
        macAddress: r.macAddress,
        message: `Discovered host ${ip}${r.vendor ? ` (${r.vendor})` : ''}.`,
        metadata: {
          vendor: r.vendor,
          matchedSavedDevice: Boolean(saved),
          savedDeviceId: saved?.id ?? null,
          savedDeviceName: saved?.name ?? null,
          networkContextUnavailable: networkId == null
        }
      })
      logged += 1
    }
  }

  if (settings.arpCacheMode === 'app_owned') {
    const ttl = Math.max(60_000, settings.arpEntryTtlMs)
    const cutoff = new Date(Date.now() - ttl).toISOString()
    pruneArpEntriesOlderThan(db, cutoff, networkId)
  }
  } catch (e) {
    eventLogs?.logSystemErrorThrottled({
      key: 'arpService.scanArpCache',
      module: 'arpService',
      operation: 'scanArpCache',
      error: e,
      networkId: getLastNetworkContext()?.networkId ?? getStableNetworkId() ?? null
    })
    throw e
  }
  })()

  try {
    await scanInFlight
  } finally {
    scanInFlight = null
  }
}

/** Windows `arp -a`: lines like `192.168.1.1   aa-bb-cc-dd-ee-ff   dynamic` */
export function parseArpWindows(
  text: string,
  ipToIfaceName: ReadonlyMap<string, string>
): OsArpRow[] {
  const out: OsArpRow[] = []
  const ifaceRe = /^\s*Interface:\s*(\d{1,3}(?:\.\d{1,3}){3})\s+---\s+0x[0-9a-f]+\s*$/i
  const lineRe =
    /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})\s+/i
  let currentIface: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(ifaceRe)
    if (h) {
      const ifaceIp = h[1]
      // If the interface IP doesn't map cleanly to an os.networkInterfaces() key,
      // keep iface null so adapter filtering won't accidentally drop entries.
      currentIface = ipToIfaceName.get(ifaceIp) ?? null
      continue
    }
    const m = line.match(lineRe)
    if (!m) continue
    const ip = m[1]
    const mac = normalizeMacFromPieces(m[2].split('-'))
    if (mac) out.push({ ip, macAddress: mac, vendor: null, iface: currentIface })
  }
  return out
}

/**
 * macOS/BSD `arp -a`: e.g. `? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]`
 * Skips incomplete entries.
 */
export function parseArpDarwin(text: string): OsArpRow[] {
  const out: OsArpRow[] = []
  // macOS/BSD `arp -a` has several variants across OS versions and flags.
  // We try multiple patterns and never throw on unexpected lines.
  const patterns: RegExp[] = [
    // Common: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]"
    /\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F:.]+)\s+on\s+([^\s]+)\b/i,
    // Sometimes: "(192.168.1.1) at aa:bb:... on en0"
    /^\s*\(?(\d{1,3}(?:\.\d{1,3}){3})\)?\s+at\s+([0-9a-fA-F:.]+)\s+on\s+([^\s]+)\b/i,
    // Fallback with missing interface token: "(ip) at mac"
    /\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F:.]+)\b/i
  ]
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('(incomplete)')) continue
    let m: RegExpMatchArray | null = null
    for (const re of patterns) {
      m = line.match(re)
      if (m) break
    }
    if (!m) continue
    const ip = m[1]
    const rawMac = m[2].trim()
    const iface = m.length >= 4 && m[3] ? m[3].trim() : null
    const mac = normalizeMacFlexible(rawMac)
    if (mac) out.push({ ip, macAddress: mac, vendor: null, iface })
  }
  return out
}

function normalizeMacFromPieces(parts: string[]): string | null {
  const hex = parts.map((p) => p.toLowerCase()).join(':')
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(hex) ? hex : null
}

/** Handles single-digit octets sometimes shown by BSD arp (e.g. 0:11:22:...) */
function normalizeMacFlexible(s: string): string | null {
  const cleaned = s.replace(/-/g, ':').toLowerCase()
  const parts = cleaned.split(':').filter(Boolean)
  if (parts.length !== 6) return null
  const padded = parts.map((p) => (p.length === 1 ? `0${p}` : p.slice(-2)))
  const hex = padded.join(':')
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(hex) ? hex : null
}
