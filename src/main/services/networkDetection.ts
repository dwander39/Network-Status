/**
 * Network fingerprinting: default gateway + subnet → stable `networkId`.
 *
 * Architectural rule:
 * - `networkId` is the source of truth for scoping.
 * - Wi‑Fi SSID is optional metadata only and MUST NOT affect identity.
 *
 * OS-specific gateway discovery (Windows: ipconfig; macOS: route; Linux: ip route).
 * Debounced change detection to avoid flapping on brief Wi‑Fi drops or DHCP renewals.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execFileAsync = promisify(execFile)

export interface NetworkContext {
  /**
   * Wi‑Fi only when available. Not guaranteed:
   * - may be null for ethernet
   * - may be null while connecting / captive portal
   * - may be blocked by OS permissions
   */
  wifiSsid?: string | null
  /** Default gateway IPv4 (from OS routing / ipconfig). */
  gateway: string
  /** Host IPv4 on the primary routed interface. */
  localIpv4: string
  netmask: string
  /** e.g. 192.168.1.0/24 */
  cidr: string
  /** Stable fingerprint: gateway|networkCidr */
  networkId: string
}

/**
 * Normalize stored `networkId` strings so DB joins stay consistent.
 *
 * Canonical format:
 * - `gateway|cidr`
 *
 * Back-compat normalization:
 * - Legacy 3-part form: `ssid|gateway|cidr` is normalized to `gateway|cidr`
 *
 * Normalization rules:
 * - Trim, remove internal whitespace
 */
export function normalizeNetworkId(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '')
  const parts = cleaned.split('|').filter(Boolean)
  if (parts.length >= 3) {
    // Legacy `ssid|gateway|cidr` → canonical `gateway|cidr` (SSID is metadata only).
    const [_ssid, gw, ...rest] = parts
    return [gw, rest.join('|')].join('|')
  }
  return parts.join('|')
}

/** Last confirmed network id (debounced). Updated only by the poller. */
let stableNetworkId: string | null = null

/** In-flight candidate for debouncing (must match N consecutive polls). */
let candidateNetworkId: string | null = null
let candidateStreak = 0

/** How many identical non-matching samples before we treat the network as changed. */
const DEBOUNCE_CONFIRMATIONS = 3

function ipv4ToInt(ip: string): number | null {
  const p = ip.trim().split('.').map((x) => parseInt(x, 10))
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return null
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0) as number
}

function prefixLenFromNetmask(netmask: string): number | null {
  const n = ipv4ToInt(netmask)
  if (n == null) return null
  let bits = 0
  let x = n >>> 0
  while (x) {
    bits += x & 1
    x >>>= 1
  }
  // contiguous mask check
  const inv = (~n >>> 0) & 0xffffffff
  if (inv !== 0 && (inv & (inv + 1)) !== 0) return null
  return bits
}

function networkAddrAndCidr(ipv4: string, netmask: string): { cidr: string; network: string } | null {
  const a = ipv4ToInt(ipv4)
  const m = ipv4ToInt(netmask)
  const pl = prefixLenFromNetmask(netmask)
  if (a == null || m == null || pl == null) return null
  const net = (a & m) >>> 0
  const o1 = (net >>> 24) & 255
  const o2 = (net >>> 16) & 255
  const o3 = (net >>> 8) & 255
  const o4 = net & 255
  const network = `${o1}.${o2}.${o3}.${o4}`
  return { cidr: `${network}/${pl}`, network }
}

/**
 * Windows: parse `ipconfig` (or `ipconfig /all`) for IPv4 + subnet + default gateway per adapter.
 * English locale labels; tolerates spacing. Picks a sensible default route when several exist.
 */
function parseIpconfigWindows(stdout: string): { ipv4: string; netmask: string; gateway: string } | null {
  const lines = stdout.split(/\r?\n/)
  const candidates: { ipv4: string; netmask: string; gateway: string }[] = []
  let ipv4: string | null = null
  let netmask: string | null = null
  let gateway: string | null = null
  let awaitingGatewayValue = false

  const flushBlock = (): void => {
    if (ipv4 && netmask && gateway && gateway !== '0.0.0.0') {
      candidates.push({ ipv4, netmask, gateway })
    }
    ipv4 = null
    netmask = null
    gateway = null
    awaitingGatewayValue = false
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\w+ adapter .+:/i.test(trimmed) || /^Tunnel adapter .+:/i.test(trimmed)) {
      flushBlock()
      continue
    }
    // Some Windows builds print "Default Gateway:" with no value and the IP on the next indented line.
    if (awaitingGatewayValue) {
      const m = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})$/)
      if (m) {
        gateway = m[1]
        awaitingGatewayValue = false
        continue
      }
      if (trimmed !== '') awaitingGatewayValue = false
    }
    const ipm = line.match(/IPv4 Address[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i)
    if (ipm) {
      flushBlock()
      ipv4 = ipm[1]
      continue
    }
    const maskm = line.match(/Subnet Mask[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i)
    if (maskm) {
      netmask = maskm[1]
      continue
    }
    // Capture either inline gateway, or mark that the next indented line may contain it.
    const gwLine = line.match(/Default Gateway[^:]*:\s*(.*)$/i)
    if (gwLine) {
      const rest = String(gwLine[1] ?? '').trim()
      const gwm = rest.match(/^(\d{1,3}(?:\.\d{1,3}){3})$/)
      if (gwm) gateway = gwm[1]
      else awaitingGatewayValue = true
      continue
    }
  }
  flushBlock()

  if (candidates.length === 0) return null

  // Prefer a row where gateway lies in the same subnet as the host (typical LAN default route).
  for (const c of candidates) {
    const a = ipv4ToInt(c.ipv4)
    const m = ipv4ToInt(c.netmask)
    const g = ipv4ToInt(c.gateway)
    if (a == null || m == null || g == null) continue
    if (((a & m) >>> 0) === ((g & m) >>> 0)) return c
  }
  return candidates[0]
}

async function getDefaultRouteWindows(): Promise<{ ipv4: string; netmask: string; gateway: string } | null> {
  try {
    const { stdout } = await execFileAsync('ipconfig', ['/all'], { encoding: 'utf8', windowsHide: true })
    return parseIpconfigWindows(stdout)
  } catch {
    return null
  }
}

/**
 * macOS / BSD: `route -n get default` → gateway + interface.
 */
async function getDefaultRouteDarwin(): Promise<{ gateway: string; iface: string } | null> {
  try {
    const { stdout } = await execFileAsync('route', ['-n', 'get', 'default'], { encoding: 'utf8' })
    let gateway: string | null = null
    let iface: string | null = null
    for (const line of stdout.split(/\r?\n/)) {
      const gm = line.match(/^\s*gateway:\s*(\d{1,3}(?:\.\d{1,3}){3})/i)
      if (gm) gateway = gm[1]
      const im = line.match(/^\s*interface:\s*(\S+)/i)
      if (im) iface = im[1]
    }
    if (gateway && iface) return { gateway, iface }
  } catch {
    /* fall through */
  }
  return null
}

/**
 * Linux: `ip -4 route show default` → via … dev …
 */
async function getDefaultRouteLinux(): Promise<{ gateway: string; iface: string } | null> {
  try {
    const { stdout } = await execFileAsync('ip', ['-4', 'route', 'show', 'default'], { encoding: 'utf8' })
    const m = stdout.trim().match(/\bdefault\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})\s+dev\s+(\S+)/)
    if (m) return { gateway: m[1], iface: m[2] }
  } catch {
    /* ignore */
  }
  return null
}

function findIpv4OnInterface(iface: string): { address: string; netmask: string } | null {
  const nis = os.networkInterfaces()[iface]
  if (!nis) return null
  for (const ni of nis) {
    if (ni.family !== 'IPv4' || ni.internal) continue
    const mask = ni.netmask
    if (mask && ni.address) return { address: ni.address, netmask: mask }
  }
  return null
}

/**
 * Windows Wi‑Fi SSID via `netsh`.
 * Output contains a line like: `SSID                   : MyNetwork`
 */
async function getWifiSsidWindows(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], {
      encoding: 'utf8',
      windowsHide: true
    })
    for (const line of stdout.split(/\r?\n/)) {
      // Avoid "BSSID" lines; match SSID with spacing variation.
      const m = line.match(/^\s*SSID\s*:\s*(.+)\s*$/i)
      if (!m) continue
      const ssid = m[1]?.trim() ?? ''
      if (!ssid || ssid.toLowerCase() === 'n/a') return null
      return ssid
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * macOS Wi‑Fi SSID via `airport -I`.
 * Output contains a line like: `SSID: MyNetwork`
 */
async function getWifiSsidDarwin(): Promise<string | null> {
  const airport =
    '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
  try {
    const { stdout } = await execFileAsync(airport, ['-I'], { encoding: 'utf8' })
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^\s*SSID:\s*(.+)\s*$/i)
      if (!m) continue
      const ssid = m[1]?.trim() ?? ''
      if (!ssid) return null
      return ssid
    }
  } catch {
    /* ignore */
  }
  return null
}

function buildNetworkId(input: { gateway: string; cidr: string }): string {
  const gw = input.gateway.trim()
  const cidr = input.cidr.trim()
  return normalizeNetworkId(`${gw}|${cidr}`)
}

/**
 * Pick the local IPv4 + netmask whose subnet contains the default gateway (when iface unknown).
 */
function pickLocalForGateway(gateway: string): { address: string; netmask: string } | null {
  const g = ipv4ToInt(gateway)
  if (g == null) return null
  let best: { address: string; netmask: string; score: number } | null = null
  for (const addrs of Object.values(os.networkInterfaces())) {
    if (!addrs) continue
    for (const a of addrs) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue
      const addr = a.address
      const mask = a.netmask
      const ai = ipv4ToInt(addr)
      const mi = ipv4ToInt(mask)
      if (ai == null || mi == null) continue
      if (((g & mi) >>> 0) === ((ai & mi) >>> 0)) {
        const pl = prefixLenFromNetmask(mask) ?? 0
        const score = pl
        if (!best || score > best.score) best = { address: addr, netmask: mask, score }
      }
    }
  }
  return best ? { address: best.address, netmask: best.netmask } : null
}

/**
 * Computes current network fingerprint from OS state.
 * Uses default gateway + host IPv4 + netmask to build:
 * - `gateway|x.x.x.0/prefix`
 */
export async function computeNetworkContext(): Promise<NetworkContext | null> {
  const platform = process.platform

  if (platform === 'win32') {
    const w = await getDefaultRouteWindows()
    if (!w) return null
    const net = networkAddrAndCidr(w.ipv4, w.netmask)
    if (!net) return null
    const wifiSsid = await getWifiSsidWindows()
    return {
      wifiSsid,
      gateway: w.gateway,
      localIpv4: w.ipv4,
      netmask: w.netmask,
      cidr: net.cidr,
      networkId: buildNetworkId({ gateway: w.gateway, cidr: net.cidr })
    }
  }

  if (platform === 'darwin') {
    const r = await getDefaultRouteDarwin()
    if (!r) return null
    const local = findIpv4OnInterface(r.iface) ?? pickLocalForGateway(r.gateway)
    if (!local) return null
    const net = networkAddrAndCidr(local.address, local.netmask)
    if (!net) return null
    const wifiSsid = await getWifiSsidDarwin()
    return {
      wifiSsid,
      gateway: r.gateway,
      localIpv4: local.address,
      netmask: local.netmask,
      cidr: net.cidr,
      networkId: buildNetworkId({ gateway: r.gateway, cidr: net.cidr })
    }
  }

  if (platform === 'linux') {
    const r = await getDefaultRouteLinux()
    if (!r) return null
    const local = findIpv4OnInterface(r.iface) ?? pickLocalForGateway(r.gateway)
    if (!local) return null
    const net = networkAddrAndCidr(local.address, local.netmask)
    if (!net) return null
    return {
      gateway: r.gateway,
      localIpv4: local.address,
      netmask: local.netmask,
      cidr: net.cidr,
      networkId: buildNetworkId({ gateway: r.gateway, cidr: net.cidr })
    }
  }

  return null
}

/** Last known context from successful compute (may be null if offline). */
let lastContext: NetworkContext | null = null

/** Call once at startup so DB list queries have a stable id before the first poll tick. */
export async function ensureInitialNetworkContext(): Promise<NetworkContext | null> {
  const ctx = await computeNetworkContext()
  if (ctx) {
    lastContext = ctx
    stableNetworkId = ctx.networkId
    candidateNetworkId = null
    candidateStreak = 0
  }
  return ctx
}

export function getLastNetworkContext(): NetworkContext | null {
  return lastContext
}

/** Debounced stable id used for DB filtering (null = unknown / not yet confirmed). */
export function getStableNetworkId(): string | null {
  return stableNetworkId
}

export function resetNetworkChangeDebounce(): void {
  candidateNetworkId = null
  candidateStreak = 0
}

export interface NetworkWatchHandles {
  stop: () => void
}

/**
 * Polls network context; debounces changes before invoking `onNetworkChanged`.
 * First successful sample sets stable id without requiring debounce.
 */
export function startNetworkWatch(options: {
  intervalMs: number
  onNetworkChanged: (ctx: NetworkContext, previousId: string | null) => void
  /**
   * Called on every successful fingerprint sample (while connected) so profiles can update `last_seen`.
   * Not debounced — use for lightweight DB bookkeeping only.
   */
  onContextSample?: (ctx: NetworkContext) => void
}): NetworkWatchHandles {
  let stopped = false
  const tick = async (): Promise<void> => {
    if (stopped) return
    const ctx = await computeNetworkContext()
    if (!ctx) return
    lastContext = ctx
    options.onContextSample?.(ctx)

    if (stableNetworkId == null) {
      stableNetworkId = ctx.networkId
      candidateNetworkId = null
      candidateStreak = 0
      return
    }

    if (ctx.networkId === stableNetworkId) {
      candidateNetworkId = null
      candidateStreak = 0
      return
    }

    // Possible change: require the same new id N times in a row (avoids brief disconnect false positives).
    if (ctx.networkId === candidateNetworkId) candidateStreak += 1
    else {
      candidateNetworkId = ctx.networkId
      candidateStreak = 1
    }

    if (candidateStreak >= DEBOUNCE_CONFIRMATIONS) {
      const prev = stableNetworkId
      stableNetworkId = ctx.networkId
      candidateNetworkId = null
      candidateStreak = 0
      options.onNetworkChanged(ctx, prev)
    }
  }

  void tick()
  const id = setInterval(() => {
    void tick()
  }, options.intervalMs)

  return {
    stop: () => {
      stopped = true
      clearInterval(id)
    }
  }
}
