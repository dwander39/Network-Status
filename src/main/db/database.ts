import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { DEFAULT_SETTINGS } from '@shared/types'
import { normalizeNetworkId } from '../services/networkDetection'

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
  migrateEventLogsSchema(db)
  seedDefaultSettings(db)
  ensureSettingsKeys(db)
  return db
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
