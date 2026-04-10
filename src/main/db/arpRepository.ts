import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { ArpEntry } from '@shared/types'
import { assertValidIPv4 } from '@shared/ipValidation'
import { getDeviceByIp } from './deviceRepository'
import { inferDeviceType } from '../services/deviceFingerprint'
import { getLastNetworkContext, getStableNetworkId } from '../services/networkDetection'

function rowToArp(row: Record<string, unknown>): ArpEntry {
  const base: ArpEntry = {
    id: String(row.id),
    ip: String(row.ip),
    macAddress: String(row.mac_address),
    vendor: row.vendor != null ? String(row.vendor) : null,
    lastSeen: String(row.last_seen)
  }
  if (row.network_id != null && String(row.network_id).trim() !== '') {
    base.networkId = String(row.network_id)
    if (row.profile_name !== undefined) {
      base.networkProfileName = row.profile_name != null ? String(row.profile_name) : null
    }
    if (row.profile_subnet !== undefined) {
      base.networkSubnetLabel = row.profile_subnet != null ? String(row.profile_subnet) : null
    }
  }
  return base
}

export function listArpEntries(db: Database.Database, networkId?: string | null): ArpEntry[] {
  const nid =
    networkId !== undefined ? networkId : (getLastNetworkContext()?.networkId ?? getStableNetworkId())
  const where = nid == null ? '' : ` WHERE (network_id IS NULL OR network_id = @nid)`
  const rows = db
    .prepare(`SELECT id, ip, mac_address, vendor, last_seen FROM arp_entries${where} ORDER BY ip`)
    .all(nid == null ? {} : { nid }) as Record<string, unknown>[]
  return rows.map(rowToArp)
}

/**
 * ARP rows whose IP does not match any saved device — "discovered / unknown" hosts.
 * Respects user-dismissed IPs (stale ghosts while OS ARP cache still lists them).
 */
export function listDiscoveredDevices(db: Database.Database, networkId?: string | null): ArpEntry[] {
  const nid =
    networkId !== undefined ? networkId : (getLastNetworkContext()?.networkId ?? getStableNetworkId())
  const netFilter =
    nid == null ? '' : ` AND (a.network_id IS NULL OR a.network_id = @nid)`
  const rows = db
    .prepare(
      `SELECT a.id, a.ip, a.mac_address, a.vendor, a.last_seen, a.network_id,
              p.name AS profile_name, p.subnet AS profile_subnet
       FROM arp_entries a
       LEFT JOIN devices d ON d.ip = a.ip
       LEFT JOIN network_profiles p ON p.network_id = a.network_id
       WHERE d.id IS NULL
         AND a.ip NOT IN (SELECT ip FROM dismissed_discovered_ips)
         ${netFilter}
       ORDER BY a.last_seen DESC`
    )
    .all(nid == null ? {} : { nid }) as Record<string, unknown>[]
  return rows.map(rowToArp)
}

export function dismissDiscoveredIp(db: Database.Database, ip: string): void {
  assertValidIPv4('IP', ip)
  db.prepare(
    `INSERT OR REPLACE INTO dismissed_discovered_ips (ip, dismissed_at) VALUES (?, ?)`
  ).run(ip.trim(), new Date().toISOString())
}

export function clearDismissedDiscovered(db: Database.Database): void {
  db.prepare(`DELETE FROM dismissed_discovered_ips`).run()
}

export interface ArpUpsertRow {
  ip: string
  macAddress: string
  vendor: string | null
}

export interface MacChangeConfirmedEvent {
  ip: string
  oldMac: string
  newMac: string
  vendor: string | null
}

export interface UpsertArpBatchOptions {
  /** When true, delete DB rows not present in this snapshot (mirror OS `arp -a`). When false, only upsert — app-owned cache. */
  snapshotPrune: boolean
  /** Rows are tagged with this LAN id; snapshot prune only removes rows for this scope (never other networks). */
  networkId?: string | null
  /** Invoked after a MAC change is confirmed (same new MAC seen twice). */
  onMacChangeConfirmed?: (ev: MacChangeConfirmedEvent) => void
}

/** Merge scan results: upsert arp_entries, sync MAC onto saved devices; optionally mirror OS snapshot. */
export function upsertArpBatch(
  db: Database.Database,
  rows: ArpUpsertRow[],
  seenIso: string,
  options: UpsertArpBatchOptions = { snapshotPrune: true }
): void {
  const tag =
    options.networkId !== undefined
      ? options.networkId
      : (getLastNetworkContext()?.networkId ?? getStableNetworkId())
  const upsertArp = db.prepare(
    `INSERT INTO arp_entries (id, ip, mac_address, vendor, last_seen, network_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       mac_address = excluded.mac_address,
       vendor = COALESCE(excluded.vendor, arp_entries.vendor),
       last_seen = excluded.last_seen,
       network_id = COALESCE(excluded.network_id, arp_entries.network_id)`
  )

  const updateDeviceMac = db.prepare(
    `UPDATE devices SET mac_address = ?, vendor = COALESCE(?, vendor), device_type = ? WHERE ip = ?`
  )

  const insertMacChange = db.prepare(
    `INSERT INTO arp_mac_changes (id, ip, old_mac_address, new_mac_address, changed_at)
     VALUES (?, ?, ?, ?, ?)`
  )

  const upsertCandidate = db.prepare(
    `INSERT INTO arp_mac_change_candidates (ip, old_mac_address, new_mac_address, first_seen, last_seen, seen_count)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(ip) DO UPDATE SET
       old_mac_address = excluded.old_mac_address,
       new_mac_address = excluded.new_mac_address,
       first_seen = CASE
         WHEN arp_mac_change_candidates.old_mac_address = excluded.old_mac_address
          AND arp_mac_change_candidates.new_mac_address = excluded.new_mac_address
         THEN arp_mac_change_candidates.first_seen
         ELSE excluded.first_seen
       END,
       last_seen = excluded.last_seen,
       seen_count = CASE
         WHEN arp_mac_change_candidates.old_mac_address = excluded.old_mac_address
          AND arp_mac_change_candidates.new_mac_address = excluded.new_mac_address
         THEN arp_mac_change_candidates.seen_count + 1
         ELSE 1
       END`
  )

  const getCandidate = db.prepare(
    `SELECT ip, old_mac_address, new_mac_address, seen_count FROM arp_mac_change_candidates WHERE ip = ?`
  )

  const deleteCandidate = db.prepare(`DELETE FROM arp_mac_change_candidates WHERE ip = ?`)

  const pruneMacChangesByCutoff = db.prepare(`DELETE FROM arp_mac_changes WHERE changed_at < ?`)
  const pruneCandidatesByCutoff = db.prepare(`DELETE FROM arp_mac_change_candidates WHERE last_seen < ?`)
  const pruneMacChangesToMax = db.prepare(
    `DELETE FROM arp_mac_changes
     WHERE id IN (
       SELECT id FROM arp_mac_changes
       ORDER BY changed_at DESC
       LIMIT -1 OFFSET ?
     )`
  )

  const tx = db.transaction(() => {
    for (const r of rows) {
      const ip = r.ip.trim()
      const mac = normalizeMac(r.macAddress)
      if (!mac) continue

      const existing = db
        .prepare(`SELECT id, mac_address FROM arp_entries WHERE ip = ?`)
        .get(ip) as { id: string; mac_address: string } | undefined
      const id = existing?.id ?? uuidv4()
      const previousMac = existing?.mac_address ? String(existing.mac_address) : null
      upsertArp.run(id, ip, mac, r.vendor, seenIso, tag)

      if (previousMac && previousMac !== mac) {
        // Reduce false positives by requiring the same change to be observed twice.
        upsertCandidate.run(ip, previousMac, mac, seenIso, seenIso)
        const cand = getCandidate.get(ip) as
          | { ip: string; old_mac_address: string; new_mac_address: string; seen_count: number }
          | undefined
        if (cand && cand.seen_count >= 2) {
          insertMacChange.run(uuidv4(), ip, cand.old_mac_address, cand.new_mac_address, seenIso)
          deleteCandidate.run(ip)
          options.onMacChangeConfirmed?.({
            ip,
            oldMac: cand.old_mac_address,
            newMac: cand.new_mac_address,
            vendor: r.vendor
          })
        }
      }

      const dev = getDeviceByIp(db, ip)
      if (dev) {
        const deviceType = inferDeviceType({ ip: dev.ip, gateway: dev.gateway, vendor: r.vendor })
        updateDeviceMac.run(mac, r.vendor, deviceType, ip)
      }
    }

    if (options.snapshotPrune && tag != null) {
      const keepIps = rows.map((r) => r.ip.trim()).filter(Boolean)
      pruneArpEntriesNotIn(db, keepIps, tag)
    }

    // Retention: keep last 30 days and cap at 5000 rows.
    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    pruneMacChangesByCutoff.run(cutoffIso)
    pruneCandidatesByCutoff.run(cutoffIso)
    pruneMacChangesToMax.run(5000)
  })

  tx()
}

/** app_owned: drop stale rows for the current LAN only (other `network_id` values preserved). */
export function pruneArpEntriesOlderThan(
  db: Database.Database,
  lastSeenBeforeIso: string,
  networkId?: string | null
): void {
  const nid = networkId !== undefined ? networkId : getStableNetworkId()
  if (nid == null) return
  db.prepare(`DELETE FROM arp_entries WHERE last_seen < ? AND network_id = ?`).run(
    lastSeenBeforeIso,
    nid
  )
}

/** Remove all ARP rows (every LAN). Returns rows deleted. */
export function deleteAllArpEntries(db: Database.Database): number {
  return db.prepare(`DELETE FROM arp_entries`).run().changes
}

export function clearArpEntries(db: Database.Database): void {
  deleteAllArpEntries(db)
}

/** Remove ARP cache rows for one LAN only. */
export function deleteArpEntriesForNetwork(db: Database.Database, networkId: string): number {
  return db.prepare(`DELETE FROM arp_entries WHERE network_id = ?`).run(networkId).changes
}

function normalizeMac(m: string): string | null {
  const s = m.trim().toLowerCase().replace(/-/g, ':')
  const hex = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/
  return hex.test(s) ? s : null
}

/**
 * Drop ARP rows that are no longer in the OS cache snapshot for **this** `networkId` only.
 * Rows belonging to other LANs are untouched (historical data preserved).
 */
export function pruneArpEntriesNotIn(
  db: Database.Database,
  keepIps: string[],
  networkId: string
): void {
  const unique = [...new Set(keepIps.map((ip) => ip.trim()).filter(Boolean))]
  if (unique.length === 0) {
    db.prepare(`DELETE FROM arp_entries WHERE network_id = ?`).run(networkId)
    return
  }
  const placeholders = unique.map(() => '?').join(',')
  db.prepare(
    `DELETE FROM arp_entries WHERE network_id = ? AND ip NOT IN (${placeholders})`
  ).run(networkId, ...unique)
}
