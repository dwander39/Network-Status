# Architecture

Electron app built with **electron-vite**: three bundles (main, preload, renderer) plus shared
code. For a much deeper per-subsystem review see `extraction-for-rebuild/` (April 2026). The
summary below was re-checked against the code at the October 2026 baseline.

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron 33 (bundled Node 20.18) |
| UI | React 18, `@xyflow/react` 12 (map), plain CSS with tokens (`design-tokens.css`) |
| Language/build | TypeScript 5.7 (strict), Vite 5 via electron-vite 2, electron-builder 25 (NSIS / DMG) |
| Persistence | SQLite via `better-sqlite3` 11 (native, rebuilt for Electron on `postinstall`) |
| Networking | OS `ping` binary (`ping` package), `arp -a`, `ipconfig`/`netsh` (Win), `route`/`airport` (macOS), `ip route` (Linux), Node `net` sockets |
| Other | `mac-oui-lookup` (offline OUI DB), `uuid` |
| Tests | Vitest 2 (see `docs/TESTING.md`) |

## Source layout

```
src/
  main/            Electron main process (all I/O, all persistence, all networking)
    index.ts       app lifecycle, windows, tray, menu, ~60 IPC handlers, push fan-out
    db/            database.ts (open + inline migrations) and one repository per aggregate
    services/      scheduler, ping, ARP, network detection, adapters, vendor lookup,
                   notifications, alert rules engine, event log, equipmentMutationService
  preload/index.ts contextBridge → window.ssApi (typed invoke + subscribe API)
  renderer/        React UI (App.tsx shell, components/, components/map/, selection/, confirm/)
  shared/          types, IPC channel names, validation, subnet math, map/trace helpers
  domain/equipment Transitional "equipment" projection/field registry (Phase-1 experiment)
```

## Process boundaries

- **Main process** owns the SQLite handle, timers, child processes and notifications.
- **Preload** exposes a single `window.ssApi` object (`contextIsolation: true`,
  `nodeIntegration: false`). The renderer never calls Node APIs, `fetch` or `ipcRenderer` directly.
- **Renderer** is pure React state fed by `ssApi.get*` calls and `ssApi.on*` push subscriptions.
- **Windows**: one main window (hides to tray on close) and an optional single **Map pop-out**
  (`#map-window` hash, same preload). The shared selection set is held in main memory and broadcast
  to both windows.

## Data flows

```
            ┌──────────── scheduler (setInterval) ─────────────┐
            │ ping round (skips while one is in flight)        │
            │   pingService → equipmentMutationService         │
            │     (source: monitoring) → devices.last_status   │
            │   → notifications, event log, alert rules        │
            │ ARP round (single-flight)                        │
            │   [optional sweep] → arp -a → parse → upsertArpBatch
            │     → applyDiscoveryUpdate (source: discovery)    │
            │     → MAC-change candidates/confirmations         │
            └───────────────┬──────────────────────────────────┘
                            │ webContents.send(ON_DEVICES_CHANGED / ON_ARP_CHANGED …)
                            ▼
 renderer state ◄──── preload (ssApi.on*) ◄──── main
 user action ───► ssApi.save*/delete* ───► ipcMain.handle ───► mutation service / repository ───► SQLite
                                                           └──► push updated lists to windows
```

- **Write authority:** device writes go through `services/equipmentMutationService.ts`, which
  validates (shared `deviceSaveValidation`), enforces IP uniqueness and field ownership per
  source (`user` / `monitoring` / `discovery`), and refreshes the `equipment_values_json` mirror.
  Other aggregates (groups, settings, profiles, map, alerts, events) are written by their
  repositories, sometimes composed directly in IPC handlers (e.g. network-profile delete cascade).
- **Network scoping:** `networkDetection.ts` polls every 12 s and builds `gateway|cidr`. A change
  is debounced over 3 samples, then the scheduler restarts and windows are re-pushed. List queries
  return rows for the current network **plus legacy rows with NULL `network_id`**.

## Persistence

- File: `<userData>/system-status.db` (Windows `%APPDATA%\system-status\`), WAL mode, foreign keys on.
- `openDatabaseAtPath()` creates the schema and runs **inline, idempotent migrations** on every
  start (no migration version table). `getDatabase()` resolves `userData` and caches the handle.
- Tables: `devices`, `device_groups`, `arp_entries`, `arp_mac_change_candidates`,
  `arp_mac_changes`, `dismissed_discovered_ips`, `settings` (key/value), `network_profiles`,
  `alert_rules`, `event_logs` (pruned to 5000), `map_layout_positions`, `map_manual_groups`,
  `map_manual_traces`.

## Networking behavior

- All OS tools are run with `execFile` and fixed argument arrays (no shell). Each call has a 15 s
  timeout, and failures fall back to "no data" for that tick.
- Ping uses the OS `ping` binary through the `ping` package (`spawn`, no shell). Device IPs are
  validated as IPv4 before they are saved.
- Optional TCP "touch" (ports 80/443, 600 ms) only populates the ARP cache; it never reads data.
- No HTTP/TLS clients and no remote services; the app is fully local.

## Settings defaults (`DEFAULT_SETTINGS` in `src/shared/types.ts`)

Ping every 5 s, ARP every 45 s, notifications on, **no adapters selected (monitoring paused)**,
cache mode `mirror_os`, TTL 7 days, subnet sweep off, TCP touch off.

## Debug switches

| Switch | Where | Effect |
|---|---|---|
| `SS_NATIVE_FOCUS_DEBUG=1` (env) | main | Logs keyboard-focus recovery calls |
| `localStorage SS_DELETE_FLOW_DEBUG=1` | renderer | Traces post-delete focus recovery |
| `localStorage system-status.mapTraceDebug=1` | renderer | Logs trace-drafting events |
| `NODE_ENV=development` | main | Exposes equipment mirror JSON on devices; dev-only inspector experiment |

Without these switches the app does no console logging except warnings and errors.
