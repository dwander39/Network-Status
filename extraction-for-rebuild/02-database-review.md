# Database review

## Technology (verified)

- **Engine:** SQLite via **`better-sqlite3`** (synchronous API from Node/Electron main).
- **Location:** `app.getPath('userData')/system-status.db` — see `src/main/db/database.ts` (`getDatabase`).
- **Pragmas:** `journal_mode = WAL`, `foreign_keys = ON`.

## Where schema is defined (verified)

- **Single source:** `src/main/db/database.ts`
  - Initial `CREATE TABLE` block in `getDatabase()` for base tables.
  - Additional tables and `ALTER TABLE` steps in functions prefixed `migrate*` called sequentially from `getDatabase()`.
- **No Flyway/Liquibase-style external migration files** — all version evolution is TypeScript functions run at open.

## Migration style (verified)

- Idempotent patterns: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `PRAGMA table_info` + conditional `ALTER TABLE`.
- **Data migration:** `migrateCanonicalizeNetworkIds` performs merge/dedupe of `network_profiles` and `map_layout_positions`, then remaps `network_id` columns — **non-trivial**, failure throws (wired to `unhandledRejection` in main).

## Table inventory (compact)

| Table | PK / uniqueness | Apparent purpose |
|-------|-----------------|------------------|
| `devices` | `id` TEXT PK; `ip` UNIQUE | Saved monitored equipment / “device” rows; network scope via `network_id`; optional `group_id` FK to `device_groups`. |
| `device_groups` | `id` TEXT PK; `name` UNIQUE (NOCASE) | List-view grouping / ordering (not map manual groups). |
| `arp_entries` | `id` TEXT PK; `ip` UNIQUE | Cached ARP scan results per app semantics; `network_id` added by migration. |
| `dismissed_discovered_ips` | `ip` PK | User-dismissed discovered hosts. |
| `settings` | `key` TEXT PK | Key-value settings (strings; JSON serialized in app layer). |
| `network_profiles` | `id` TEXT PK; `network_id` UNIQUE | Friendly LAN profiles bound to canonical `network_id`. |
| `map_layout_positions` | `(network_id, node_key)` | Per-LAN node positions + optional `manual_group_id` + `map_device_collapsed`. |
| `map_manual_groups` | `id` TEXT PK | User-drawn map regions (bounds, lock flag), scoped by `network_id`. |
| `map_manual_traces` | `id` TEXT PK; UNIQUE(network, src, dst, connection_type) | Persisted manual typed traces (POC), path as JSON. |
| `alert_rules` | `id` TEXT PK | Rule definitions; optional `network_id` scoping; JSON config blob. |
| `event_logs` | `id` TEXT PK | Append-only structured log for app/network/device events. |
| `arp_mac_changes` | `id` TEXT PK | Log of confirmed MAC changes per IP. |
| `arp_mac_change_candidates` | `ip` PK | Staging for MAC change confirmation. |

## Key columns (devices — verified from migrations + repository usage)

- Core: `id`, `name`, `ip`, `subnet`, `gateway`, `mac_address`, `vendor`, `device_type`, `device_type_custom`, `last_status`, `last_checked`, `group_id`, `network_id`, `equipment_values_json` (mirror).

## Foreign keys (verified where declared)

- `devices.group_id` → `device_groups(id)` ON DELETE SET NULL (added in `migrateDeviceGroupsSchema`).
- `map_layout_positions.manual_group_id` → `map_manual_groups(id)` ON DELETE SET NULL (added in `migrateMapManualGroupsSchema`).
- `map_manual_traces` stores `source_device_id` / `destination_device_id` as TEXT **without FK** — integrity enforced by app + delete hooks.

## Indexes (verified in `database.ts`)

- `idx_devices_ip`, `idx_arp_ip`, `idx_device_groups_sort`, `idx_network_profiles_last_seen`, `idx_map_layout_network`, `idx_map_manual_groups_network`, `idx_map_manual_traces_network`, `idx_alert_rules_enabled`, `idx_event_logs_ts`, `idx_event_logs_network`, `idx_event_logs_type`, `idx_arp_mac_changes_ip`, `idx_arp_mac_changes_changed_at`.

## Major relationships (verified)

- **Device ↔ list group:** many-to-one via `devices.group_id`.
- **Device ↔ network:** `devices.network_id` aligns with `network_profiles.network_id` string (canonicalization in network detection + migration).
- **Map layout:** `map_layout_positions.node_key` correlates with device `id` or synthetic gateway key `__gateway__` (`MAP_LAYOUT_GATEWAY_KEY` in `mapLayoutRepository.ts`).
- **Map manual group membership:** `map_layout_positions.manual_group_id` nullable FK to `map_manual_groups`.
- **Manual traces:** endpoints are device ids; rows deleted when device deleted (`deleteManualTracesInvolvingDevice` in `mapManualTraceRepository.ts`).

## Map-layout-related tables (verified)

- `map_layout_positions`, `map_manual_groups`, `map_manual_traces` — all scoped by `network_id`.

## Selection-related storage (verified)

- **No SQLite table** for selection. Selection is **in-memory in main** (see IPC review). **Partial:** only equipment ids, not map-only entities.

## Trace / manual-connection tables (verified)

- `map_manual_traces`: `connection_type` in `Power` | `DMX` | `Network` (with migration renaming `Data` → `DMX`); `path_json` polyline; snap point ids stored as strings.

## Coherence assessment

- **Coherent:** Clear per-LAN scoping for map and profiles; WAL + FK pragma; explicit unique keys on traces.
- **Mixed-generation:** `devices` grew by repeated `ALTER TABLE`; `network_id` NULL legacy coexistence; `equipment_values_json` mirror alongside authoritative columns — **intentional bridge**, adds mental overhead.
- **Coupled to old assumptions:** IP uniqueness as global device identity constraint; map `node_key` stringly-typed to device ids.

## Strong carry-forward candidates

- **Per-network map persistence model** (positions + manual groups + optional collapse) — clear schema for a LAN-scoped canvas.
- **Event log table shape** (indexed by time, network, type) — useful pattern for observability.
- **WAL + foreign_keys pragma** defaults for desktop SQLite.
- **settings** key-value table pattern for app preferences.

## Likely redesign-required areas

- **Single mega-migration file** — hard to review in isolation in larger teams; consider external migrations in rebuild.
- **equipment_values_json** mirror — rebuild should decide single write model vs. normalized columns.
- **Trace schema** — geometry in JSON, logical key on endpoints + type; no graph/topology layer — fine for POC, weak for “network digital twin” without redesign.

## Carry-forward notes

- Any rebuild importing data must handle **`migrateCanonicalizeNetworkIds`** outcomes and legacy NULL `network_id` semantics.
