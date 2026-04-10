import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { CreateNetworkProfilePayload, NetworkProfile, NetworkProfileListItem } from '@shared/types'
import type { NetworkContext } from '../services/networkDetection'
import { normalizeNetworkId } from '../services/networkDetection'
import { EVENT_LOG_NETWORK_UNKNOWN } from '@shared/eventLog'

function rowToProfile(row: Record<string, unknown>): NetworkProfile {
  return {
    id: String(row.id),
    networkId: String(row.network_id),
    name: String(row.name),
    ssid: row.ssid != null && String(row.ssid).trim() ? String(row.ssid) : null,
    gateway: String(row.gateway ?? ''),
    subnet: String(row.subnet ?? ''),
    firstSeen: String(row.first_seen),
    lastSeen: String(row.last_seen),
    settingsJson: row.settings_json != null ? String(row.settings_json) : null
  }
}

export function getNetworkProfileById(db: Database.Database, id: string): NetworkProfile | null {
  const row = db
    .prepare(
      `SELECT id, network_id, name, ssid, gateway, subnet, first_seen, last_seen, settings_json
       FROM network_profiles WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToProfile(row) : null
}

export function getNetworkProfileByNetworkId(
  db: Database.Database,
  networkId: string
): NetworkProfile | null {
  const nid = normalizeNetworkId(networkId)
  const row = db
    .prepare(
      `SELECT id, network_id, name, ssid, gateway, subnet, first_seen, last_seen, settings_json
       FROM network_profiles WHERE network_id = ?`
    )
    .get(nid) as Record<string, unknown> | undefined
  return row ? rowToProfile(row) : null
}

/**
 * Refresh gateway/subnet/ssid/last_seen when we reconnect to a known (already-saved) LAN.
 * Does NOT create a row for unknown networks — onboarding UX prompts the user first.
 */
export function syncNetworkProfileFromContext(
  db: Database.Database,
  ctx: NetworkContext
): NetworkProfile | null {
  const nid = normalizeNetworkId(ctx.networkId)
  const iso = new Date().toISOString()

  const tx = db.transaction(() => {
    const existing = db
      .prepare(`SELECT id FROM network_profiles WHERE network_id = ?`)
      .get(nid) as { id: string } | undefined

    if (existing) {
      db.prepare(
        `UPDATE network_profiles SET last_seen = ?, gateway = ?, subnet = ?, ssid = COALESCE(?, ssid) WHERE network_id = ?`
      ).run(iso, ctx.gateway, ctx.cidr, ctx.wifiSsid?.trim() || null, nid)
      return existing.id
    }
    return null
  })

  const id = tx()
  return id ? getNetworkProfileById(db, id) : null
}

export function createNetworkProfile(db: Database.Database, input: CreateNetworkProfilePayload): NetworkProfile {
  const nid = normalizeNetworkId(input.networkId)
  if (nid === EVENT_LOG_NETWORK_UNKNOWN) {
    throw new Error('Cannot create a saved network profile for unknown-network event scope.')
  }
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')

  const existing = db.prepare(`SELECT id FROM network_profiles WHERE network_id = ?`).get(nid) as
    | { id: string }
    | undefined
  if (existing) return getNetworkProfileById(db, existing.id)!

  const iso = new Date().toISOString()
  const id = uuidv4()
  const ssid = input.ssid != null && String(input.ssid).trim() ? String(input.ssid).trim() : null
  const gateway = (input.gateway ?? '').trim()
  const subnet = (input.subnet ?? '').trim()
  db.prepare(
    `INSERT INTO network_profiles (id, network_id, name, ssid, gateway, subnet, first_seen, last_seen, settings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(id, nid, name, ssid, gateway, subnet, iso, iso)
  return getNetworkProfileById(db, id)!
}

export function renameNetworkProfile(db: Database.Database, id: string, name: string): NetworkProfile {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Name is required')
  const r = db.prepare(`UPDATE network_profiles SET name = ? WHERE id = ?`).run(trimmed, id)
  if (r.changes === 0) throw new Error('Profile not found')
  return getNetworkProfileById(db, id)!
}

/**
 * Delete a saved network profile row by id.
 * Note: this only removes the profile metadata. Callers should also remove any scoped data
 * (devices/ARP/layout/rules) that uses the same `network_id`.
 */
export function deleteNetworkProfileById(db: Database.Database, id: string): { networkId: string } {
  const existing = getNetworkProfileById(db, id)
  if (!existing) throw new Error('Profile not found')
  const r = db.prepare(`DELETE FROM network_profiles WHERE id = ?`).run(id)
  if (r.changes === 0) throw new Error('Profile not found')
  return { networkId: existing.networkId }
}

/** All saved profiles with device counts; `activeNetworkId` should be `getStableNetworkId()` (normalized or null). */
export function listNetworkProfiles(
  db: Database.Database,
  activeNetworkId: string | null
): NetworkProfileListItem[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.network_id, p.name, p.ssid, p.gateway, p.subnet, p.first_seen, p.last_seen, p.settings_json,
              (SELECT COUNT(*) FROM devices d WHERE d.network_id = p.network_id) AS device_count
       FROM network_profiles p
       ORDER BY p.last_seen DESC`
    )
    .all() as Record<string, unknown>[]

  const active = activeNetworkId ? normalizeNetworkId(activeNetworkId) : null
  return rows.map((row) => {
    const p = rowToProfile(row)
    const deviceCount = Number(row.device_count ?? 0)
    return {
      ...p,
      deviceCount: Number.isFinite(deviceCount) ? deviceCount : 0,
      isActive: active != null && p.networkId === active
    }
  })
}
