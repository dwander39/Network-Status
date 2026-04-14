import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { DEFAULT_SETTINGS } from '@shared/types'
import { normalizeNetworkId } from '../services/networkDetection'
import { backfillMissingEquipmentValuesJsonMirrors } from './deviceRepository'

let db: Database.Database | null = null

/** Open SQLite in userData; create schema and default settings on first run. */
export function getDatabase(): Database.Database {
  if (db) return db

  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, 'system-status.db')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT NOT NULL UNIQUE,
      subnet TEXT NOT NULL DEFAULT '',
      gateway TEXT NOT NULL DEFAULT '',
      mac_address TEXT,
      vendor TEXT,
      device_type TEXT NOT NULL DEFAULT 'Unknown',
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_checked TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);

    CREATE TABLE IF NOT EXISTS arp_entries (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL UNIQUE,
      mac_address TEXT NOT NULL,
      vendor TEXT,
      last_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_arp_ip ON arp_entries(ip);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dismissed_discovered_ips (
      ip TEXT PRIMARY KEY,
      dismissed_at TEXT NOT NULL
    );
  `)

  migrateDeviceGroupsSchema(db)
  migrateDeviceInsightsSchema(db)
  migrateArpMacChangeLog(db)
  migrateNetworkIdSchema(db)
  migrateNetworkProfilesSchema(db)
  migrateAlertRulesSchema(db)
  migrateAlertRulesEventLogSeverityColumn(db)
  migrateMapLayoutSchema(db)
  migrateMapManualGroupsSchema(db)
  migrateDeviceTypeCustomSchema(db)
  migrateEquipmentValuesMirrorColumn(db)
  migrateEventLogsSchema(db)
  migrateCanonicalizeNetworkIds(db)
  seedDefaultSettings(db)
  ensureSettingsKeys(db)

  const mirrorBackfilled = backfillMissingEquipmentValuesJsonMirrors(db)
  if (process.env.NODE_ENV === 'development' && mirrorBackfilled > 0) {
    console.info(`[db] backfilled equipment_values_json for ${mirrorBackfilled} device(s)`)
  }

  return db
}

/**
 * Phase 2C stabilization: SSID is metadata only; network identity is `gateway|cidr`.
 * Older installs may have stored `ssid|gateway|cidr`. Canonicalize to prevent churn / duplicates.
 */
function migrateCanonicalizeNetworkIds(database: Database.Database): void {
  try {
    type NetworkProfileRow = {
      id: string
      network_id: string
      name: string
      ssid: string | null
      gateway: string
      subnet: string
      first_seen: string
      last_seen: string
      settings_json: string | null
    }

    const isDefaultName = (name: string): boolean => /^network\s+\d+$/i.test(name.trim())
    const scoreProfile = (p: NetworkProfileRow): number => {
      let s = 0
      if (p.name && !isDefaultName(p.name)) s += 3
      if (p.settings_json && String(p.settings_json).trim()) s += 2
      if (p.gateway && String(p.gateway).trim()) s += 1
      if (p.subnet && String(p.subnet).trim()) s += 1
      if (p.ssid && String(p.ssid).trim()) s += 0.5
      return s
    }

    const tx = database.transaction(() => {
      // 1) Merge/dedupe network_profiles first (unique constraint on network_id).
      const profs = database
        .prepare(
          `SELECT id, network_id, name, ssid, gateway, subnet, first_seen, last_seen, settings_json
           FROM network_profiles`
        )
        .all() as NetworkProfileRow[]

      const byCanonical = new Map<string, NetworkProfileRow[]>()
      for (const p of profs) {
        const canon = normalizeNetworkId(String(p.network_id))
        if (!canon) continue
        const arr = byCanonical.get(canon) ?? []
        arr.push(p)
        byCanonical.set(canon, arr)
      }

      const deleteProfile = database.prepare(`DELETE FROM network_profiles WHERE id = ?`)
      const updateProfile = database.prepare(
        `UPDATE network_profiles
         SET network_id = ?, name = ?, ssid = ?, gateway = ?, subnet = ?, first_seen = ?, last_seen = ?, settings_json = ?
         WHERE id = ?`
      )

      for (const [canon, group] of byCanonical.entries()) {
        if (group.length === 0) continue
        const sorted = [...group].sort((a, b) => {
          const sa = scoreProfile(a)
          const sb = scoreProfile(b)
          if (sa !== sb) return sb - sa
          // Most recent last_seen wins on tie (ISO strings compare lexicographically).
          return String(b.last_seen).localeCompare(String(a.last_seen))
        })

        const survivor = sorted[0]!
        let name = survivor.name
        let ssid = survivor.ssid != null && String(survivor.ssid).trim() ? String(survivor.ssid).trim() : null
        let gateway = String(survivor.gateway ?? '')
        let subnet = String(survivor.subnet ?? '')
        let firstSeen = String(survivor.first_seen)
        let lastSeen = String(survivor.last_seen)
        let settingsJson =
          survivor.settings_json != null && String(survivor.settings_json).trim()
            ? String(survivor.settings_json)
            : null

        for (const dup of sorted.slice(1)) {
          // Prefer a non-default, user-authored name.
          if (isDefaultName(name) && dup.name && !isDefaultName(dup.name)) name = dup.name
          // SSID is metadata: only fill when survivor is empty.
          const dupSsid = dup.ssid != null && String(dup.ssid).trim() ? String(dup.ssid).trim() : null
          if (!ssid && dupSsid) ssid = dupSsid
          // Fill missing gateway/subnet metadata only.
          if (!String(gateway).trim() && String(dup.gateway ?? '').trim()) gateway = String(dup.gateway)
          if (!String(subnet).trim() && String(dup.subnet ?? '').trim()) subnet = String(dup.subnet)
          // Settings: keep survivor unless empty.
          const dupSettings =
            dup.settings_json != null && String(dup.settings_json).trim() ? String(dup.settings_json) : null
          if (!settingsJson && dupSettings) settingsJson = dupSettings
          // Merge time bounds.
          if (String(dup.first_seen) < firstSeen) firstSeen = String(dup.first_seen)
          if (String(dup.last_seen) > lastSeen) lastSeen = String(dup.last_seen)
        }

        // Delete duplicates BEFORE updating survivor network_id (avoid UNIQUE constraint violations).
        for (const dup of sorted.slice(1)) deleteProfile.run(dup.id)

        // Update survivor to canonical network_id and merged metadata.
        updateProfile.run(canon, name, ssid, gateway, subnet, firstSeen, lastSeen, settingsJson, survivor.id)
      }

      // 2) Merge map_layout_positions per canonical network_id (PK is (network_id,node_key)).
      const posNids = database
        .prepare(
          `SELECT DISTINCT network_id AS nid
           FROM map_layout_positions
           WHERE network_id IS NOT NULL AND TRIM(network_id) != ''`
        )
        .all() as { nid: string }[]
      const posByCanon = new Map<string, string[]>()
      for (const r of posNids) {
        const canon = normalizeNetworkId(String(r.nid))
        if (!canon) continue
        const arr = posByCanon.get(canon) ?? []
        arr.push(String(r.nid))
        posByCanon.set(canon, arr)
      }

      const readPositions = database.prepare(
        `SELECT network_id, node_key, pos_x, pos_y, updated_at, manual_group_id
         FROM map_layout_positions
         WHERE network_id = ?`
      )
      const deletePositionsForNid = database.prepare(`DELETE FROM map_layout_positions WHERE network_id = ?`)
      const insertPosition = database.prepare(
        `INSERT INTO map_layout_positions (network_id, node_key, pos_x, pos_y, updated_at, manual_group_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )

      for (const [canon, nids] of posByCanon.entries()) {
        const uniqueNids = [...new Set(nids)]
        if (uniqueNids.length === 1 && uniqueNids[0] === canon) continue

        const bestByNodeKey = new Map<
          string,
          { node_key: string; pos_x: number; pos_y: number; updated_at: string; manual_group_id: string | null }
        >()

        for (const nid of uniqueNids) {
          const rows = readPositions.all(nid) as {
            node_key: string
            pos_x: number
            pos_y: number
            updated_at: string
            manual_group_id: string | null
          }[]
          for (const row of rows) {
            const cur = bestByNodeKey.get(row.node_key)
            if (!cur) {
              bestByNodeKey.set(row.node_key, row)
              continue
            }
            if (String(row.updated_at) > String(cur.updated_at)) {
              bestByNodeKey.set(row.node_key, row)
              continue
            }
            if (String(row.updated_at) === String(cur.updated_at)) {
              // Tie-break: keep membership when one has it.
              if (!cur.manual_group_id && row.manual_group_id) bestByNodeKey.set(row.node_key, row)
            }
          }
        }

        for (const nid of uniqueNids) deletePositionsForNid.run(nid)
        for (const row of bestByNodeKey.values()) {
          insertPosition.run(canon, row.node_key, row.pos_x, row.pos_y, row.updated_at, row.manual_group_id)
        }
      }

      // 3) Remap simple referencing tables (no uniqueness constraints on network_id).
      const simpleTables: { name: string; col: string }[] = [
        { name: 'devices', col: 'network_id' },
        { name: 'arp_entries', col: 'network_id' },
        { name: 'map_manual_groups', col: 'network_id' },
        { name: 'alert_rules', col: 'network_id' },
        { name: 'event_logs', col: 'network_id' }
      ]

      for (const t of simpleTables) {
        // Skip if column/table missing (defensive).
        try {
          const cols = database.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[]
          if (!cols.some((c) => c.name === t.col)) continue
        } catch {
          continue
        }
        const distinct = database
          .prepare(
            `SELECT DISTINCT ${t.col} AS nid
             FROM ${t.name}
             WHERE ${t.col} IS NOT NULL AND TRIM(${t.col}) != ''`
          )
          .all() as { nid: string }[]

        const update = database.prepare(`UPDATE ${t.name} SET ${t.col} = ? WHERE ${t.col} = ?`)
        for (const r of distinct) {
          const old = String(r.nid)
          const next = normalizeNetworkId(old)
          if (next && next !== old) update.run(next, old)
        }
      }
    })

    tx()
  } catch (e) {
    console.error('[db] migrateCanonicalizeNetworkIds failed', e)
    throw e
  }
}

function migrateDeviceGroupsSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS device_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_device_groups_sort ON device_groups(sort_order);
  `)
  const cols = database.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'group_id')) {
    database.exec(
      `ALTER TABLE devices ADD COLUMN group_id TEXT REFERENCES device_groups(id) ON DELETE SET NULL`
    )
  }
}

function migrateDeviceInsightsSchema(database: Database.Database): void {
  const cols = database.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'vendor')) {
    database.exec(`ALTER TABLE devices ADD COLUMN vendor TEXT`)
  }
  if (!cols.some((c) => c.name === 'device_type')) {
    database.exec(`ALTER TABLE devices ADD COLUMN device_type TEXT NOT NULL DEFAULT 'Unknown'`)
  }
}

function migrateNetworkProfilesSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS network_profiles (
      id TEXT PRIMARY KEY,
      network_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      ssid TEXT,
      gateway TEXT NOT NULL DEFAULT '',
      subnet TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      settings_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_network_profiles_last_seen ON network_profiles(last_seen);
  `)

  // Added later: SSID metadata (read-only; can be null for ethernet or unknown).
  const cols = database.prepare(`PRAGMA table_info(network_profiles)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'ssid')) {
    database.exec(`ALTER TABLE network_profiles ADD COLUMN ssid TEXT`)
  }

  // One profile per known fingerprint; backfill from existing device/ARP tags (legacy installs).
  const distinct = database
    .prepare(
      `SELECT DISTINCT network_id AS nid FROM devices WHERE network_id IS NOT NULL AND TRIM(network_id) != ''
       UNION
       SELECT DISTINCT network_id AS nid FROM arp_entries WHERE network_id IS NOT NULL AND TRIM(network_id) != ''`
    )
    .all() as { nid: string }[]

  const insert = database.prepare(
    `INSERT OR IGNORE INTO network_profiles (id, network_id, name, ssid, gateway, subnet, first_seen, last_seen, settings_json)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL)`
  )
  const iso = new Date().toISOString()
  let n = 0
  for (const { nid: raw } of distinct) {
    const nid = normalizeNetworkId(raw)
    const exists = database.prepare(`SELECT 1 FROM network_profiles WHERE network_id = ?`).get(nid)
    if (exists) continue
    n += 1
    insert.run(uuidv4(), nid, `Network ${n}`, '', '', iso, iso)
  }
}

function migrateNetworkIdSchema(database: Database.Database): void {
  const devCols = database.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]
  if (!devCols.some((c) => c.name === 'network_id')) {
    database.exec(`ALTER TABLE devices ADD COLUMN network_id TEXT`)
  }
  const arpCols = database.prepare(`PRAGMA table_info(arp_entries)`).all() as { name: string }[]
  if (!arpCols.some((c) => c.name === 'network_id')) {
    database.exec(`ALTER TABLE arp_entries ADD COLUMN network_id TEXT`)
  }
}

function migrateDeviceTypeCustomSchema(database: Database.Database): void {
  const cols = database.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'device_type_custom')) {
    database.exec(`ALTER TABLE devices ADD COLUMN device_type_custom TEXT`)
  }
}

/** Nullable JSON mirror of `mapDeviceToEquipmentRuntime(device).values`; legacy columns stay authoritative. */
function migrateEquipmentValuesMirrorColumn(database: Database.Database): void {
  const cols = database.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'equipment_values_json')) {
    database.exec(`ALTER TABLE devices ADD COLUMN equipment_values_json TEXT`)
  }
}

function migrateMapLayoutSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS map_layout_positions (
      network_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      pos_x REAL NOT NULL,
      pos_y REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (network_id, node_key)
    );
    CREATE INDEX IF NOT EXISTS idx_map_layout_network ON map_layout_positions(network_id);
  `)
}

/**
 * Manual map groups (Phase 2A): user-drawn regions on the React Flow canvas, per `network_id`.
 * Distinct from list-view `device_groups` (names only / sorting) — not related to future auto-clustering.
 */
function migrateMapManualGroupsSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS map_manual_groups (
      id TEXT PRIMARY KEY,
      network_id TEXT NOT NULL,
      name TEXT NOT NULL,
      pos_x REAL NOT NULL,
      pos_y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      contents_locked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_map_manual_groups_network ON map_manual_groups(network_id);
  `)
  const cols = database.prepare(`PRAGMA table_info(map_layout_positions)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'manual_group_id')) {
    database.exec(
      `ALTER TABLE map_layout_positions ADD COLUMN manual_group_id TEXT REFERENCES map_manual_groups(id) ON DELETE SET NULL`
    )
  }

  const gcols = database.prepare(`PRAGMA table_info(map_manual_groups)`).all() as { name: string }[]
  if (!gcols.some((c) => c.name === 'contents_locked')) {
    database.exec(`ALTER TABLE map_manual_groups ADD COLUMN contents_locked INTEGER NOT NULL DEFAULT 1`)
  }

  const lcols = database.prepare(`PRAGMA table_info(map_layout_positions)`).all() as { name: string }[]
  if (!lcols.some((c) => c.name === 'map_device_collapsed')) {
    database.exec(
      `ALTER TABLE map_layout_positions ADD COLUMN map_device_collapsed INTEGER NOT NULL DEFAULT 0`
    )
  }
}

function migrateAlertRulesSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      network_id TEXT,
      condition_type TEXT NOT NULL,
      condition_config_json TEXT NOT NULL DEFAULT '{}',
      last_triggered TEXT,
      cooldown_seconds INTEGER NOT NULL DEFAULT 300
    );
    CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
  `)
}

/** Per-rule severity for ALERT_TRIGGERED log rows (nullable = use layered defaults in EventLogService). */
function migrateAlertRulesEventLogSeverityColumn(database: Database.Database): void {
  const cols = database.prepare(`PRAGMA table_info(alert_rules)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'event_log_severity')) {
    database.exec(`ALTER TABLE alert_rules ADD COLUMN event_log_severity TEXT`)
  }
}

function migrateEventLogsSchema(database: Database.Database): void {
  // Central structured event log for debugging/visibility. `network_id` is the source of truth.
  // SSID may be recorded as contextual metadata only (never used for scoping or identity).
  database.exec(`
    CREATE TABLE IF NOT EXISTS event_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      device_id TEXT,
      ip_address TEXT,
      mac_address TEXT,
      network_id TEXT NOT NULL,
      ssid TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_event_logs_ts ON event_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_event_logs_network ON event_logs(network_id);
    CREATE INDEX IF NOT EXISTS idx_event_logs_type ON event_logs(event_type);
  `)

  // Added later: severity. Backfill existing rows to 'info' (SQLite uses DEFAULT for new rows only).
  const cols = database.prepare(`PRAGMA table_info(event_logs)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'severity')) {
    database.exec(`ALTER TABLE event_logs ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'`)
    database.exec(`UPDATE event_logs SET severity = 'info' WHERE severity IS NULL OR TRIM(severity) = ''`)
  }
}

function migrateArpMacChangeLog(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS arp_mac_changes (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      old_mac_address TEXT NOT NULL,
      new_mac_address TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_arp_mac_changes_ip ON arp_mac_changes(ip);
    CREATE INDEX IF NOT EXISTS idx_arp_mac_changes_changed_at ON arp_mac_changes(changed_at);

    CREATE TABLE IF NOT EXISTS arp_mac_change_candidates (
      ip TEXT PRIMARY KEY,
      old_mac_address TEXT NOT NULL,
      new_mac_address TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      seen_count INTEGER NOT NULL
    );
  `)
}

/** New settings keys for existing installs (INSERT OR IGNORE). */
function ensureSettingsKeys(database: Database.Database): void {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  )
  insert.run('arpCacheMode', DEFAULT_SETTINGS.arpCacheMode)
  insert.run('arpEntryTtlMs', String(DEFAULT_SETTINGS.arpEntryTtlMs))
  insert.run('arpSubnetSweep', DEFAULT_SETTINGS.arpSubnetSweep ? '1' : '0')
  insert.run('listenAdapterNames', JSON.stringify(DEFAULT_SETTINGS.listenAdapterNames))
  insert.run('arpTcpTouch', DEFAULT_SETTINGS.arpTcpTouch ? '1' : '0')
  insert.run('eventLogSeverityOverrides', '{}')
}

function seedDefaultSettings(database: Database.Database): void {
  const row = database
    .prepare(`SELECT COUNT(*) AS c FROM settings WHERE key = 'pingIntervalMs'`)
    .get() as { c: number }
  if (row.c > 0) return

  const insert = database.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  )
  insert.run('pingIntervalMs', String(DEFAULT_SETTINGS.pingIntervalMs))
  insert.run('arpIntervalMs', String(DEFAULT_SETTINGS.arpIntervalMs))
  insert.run('notifyOnOffline', DEFAULT_SETTINGS.notifyOnOffline ? '1' : '0')
  insert.run('notifyOnNewDevice', DEFAULT_SETTINGS.notifyOnNewDevice ? '1' : '0')
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
