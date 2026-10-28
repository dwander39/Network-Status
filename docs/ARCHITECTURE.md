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
    appIdentity.ts product name, AUMID, userData layout (canonical + legacy paths)
    legacyDataMigration.ts  one-time System Status → Network Status data copy
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

- File: `<userData>/network-status.db` (Windows `%APPDATA%\network-status\`), WAL mode, foreign keys on.
  Installs from before the rename keep their original data in `%APPDATA%\system-status\system-status.db`;
  it is copied once into the new location at startup (see
  [Product identity and legacy data migration](#product-identity-and-legacy-data-migration)).
- `openDatabaseAtPath()` creates the schema and runs **inline, idempotent migrations** on every
  start (no migration version table). `getDatabase()` resolves `userData` and caches the handle.
  It throws if called before the legacy-data step has run (`markUserDataPrepared()`), so no
  component can open or create a database before migration.
- Tables: `devices`, `device_groups`, `arp_entries`, `arp_mac_change_candidates`,
  `arp_mac_changes`, `dismissed_discovered_ips`, `settings` (key/value), `network_profiles`,
  `alert_rules`, `event_logs` (pruned to 5000), `map_layout_positions`, `map_manual_groups`,
  `map_manual_traces`.

## Product identity and legacy data migration

The product was called **System Status** until Phase 0B; it is now **Network Status**. All
identity constants live in `src/main/appIdentity.ts`.

### Identifiers

| Identifier | Value | Why |
|---|---|---|
| Display / product name (`app.setName`, `build.productName`, window title, tray, dialogs) | `Network Status` | New name |
| npm package `name` | `network-status` | New name. Also the default per-user install folder for **fresh** installs (`%LOCALAPPDATA%\Programs\network-status`) |
| `userData` directory | `<appData>/network-status` (set explicitly with `app.setPath`) | New name. Set explicitly so it no longer depends on package metadata |
| Database file | `network-status.db` | New name (fresh file written by the migration) |
| `build.appId` / macOS bundle id | `com.systemstatus.app` (**unchanged**) | electron-builder derives the NSIS GUID (uninstall registry key, `InstallLocation`, `ShortcutName`, installer mutex) from it. Changing it would install a second, separate app instead of upgrading |
| Windows AppUserModelID (`app.setAppUserModelId`) | `electron.app.system-status` (**unchanged**) | This was Electron's implicit default (`electron.app.<package name>`). Windows keys notification settings and taskbar grouping by it, so it is pinned explicitly |
| Legacy `userData` / DB | `<appData>/system-status/system-status.db` | Read-only migration source. Never written, moved or deleted |
| Renderer `localStorage` keys (`system-status:*`, `system-status.*`) | unchanged | Internal keys. Renaming them would only reset UI preferences |

`NETWORK_STATUS_APP_DATA_ROOT` (env) replaces `<appData>` for both the canonical and the legacy
directory. Use it only for isolated manual testing.

**Expected installer behavior.** This was read from the electron-builder 25 NSIS templates; no real
upgrade install has been performed.

- With `appId` unchanged, an upgrade over a System Status install finds the existing registry
  entries. It installs into the existing folder (e.g. `%LOCALAPPDATA%\Programs\system-status`) and
  renames the old `System Status.lnk` Start-menu and desktop shortcuts to `Network Status.lnk`
  (`installer.nsh` using the stored `ShortcutName`).
- The executable becomes `Network Status.exe`, and the installer artifact
  `Network Status Setup <version>.exe`.
- The uninstaller deletes app data only with `--delete-app-data` or `deleteAppDataOnUninstall`.
  Neither is configured, and the uninstaller never targets `system-status` data.
- macOS: the bundle id is unchanged, but the bundle is now `Network Status.app`. A drag-install from
  the DMG leaves the old `System Status.app` in `/Applications` until the user removes it.
- Pre-existing and unchanged: the NSIS shortcuts carry AUMID `com.systemstatus.app`, while the
  process uses `electron.app.system-status`.

### Startup order

1. `applyAppIdentity()` sets the name, AUMID and `userData` **before** `requestSingleInstanceLock()`.
   The Chromium profile, session data and the single-instance lock all live under the new directory.
2. A second Network Status instance exits at the lock, so only one process can run the migration.
3. At the start of `app.whenReady`, before anything else, `prepareUserDataDirectory()` runs.
   Afterwards `markUserDataPrepared()` unlocks `getDatabase()`. If the step fails, an error dialog
   is shown and the app exits **without opening or creating any database**.

### Migration algorithm (`src/main/legacyDataMigration.ts`)

The canonical directory itself is not a usable signal, because Chromium creates profile files there
at startup. Decisions are made from database files only:

| State | Result |
|---|---|
| `network-status.db` exists | Use it. Legacy data is ignored and never re-imported. Our leftover staging artifacts are removed |
| No canonical DB, but `legacy-migration.json` exists | **Error.** The data was migrated earlier and has since gone missing. Nothing is silently recreated (see recovery) |
| No canonical DB, no legacy DB | Fresh install. Nothing is created in the legacy location |
| No canonical DB, legacy DB exists | Migrate (below) |

Migration steps:

1. **Legacy app must be closed.** The legacy profile's Chromium single-instance lock is probed
   (Windows: `lockfile` that cannot be opened for writing; macOS/Linux: a `SingletonLock` symlink
   to a live `host-pid`). If it is in use, the migration stops with "close System Status".
2. **Quiescent raw copy into staging.** `system-status.db` plus any `-wal` / `-journal` file are
   copied into `<canonical>/.legacy-migration/`. `-shm` is not copied; SQLite rebuilds it. Size and
   mtime of every source file are compared before and after the copy, and the lock is re-probed.
   Any change aborts the migration. This matters: the live legacy data observed during Phase 0B was
   a 4 KB `.db` with a ~0.9 MB uncheckpointed `-wal`, so copying the `.db` alone would lose nearly
   everything. SQLite never opens files in the legacy directory, so not even an `-shm` is written there.
3. **Validate the source.** The staged copy is opened with SQLite, which replays the WAL.
   `PRAGMA integrity_check` must return `ok`, and a `devices` table must exist. A non-SQLite,
   corrupt, empty or foreign file fails here.
4. **Consistent snapshot.** `VACUUM INTO '<canonical>/network-status.db.migrating'` writes a
   single, fully checkpointed file from one read transaction.
5. **Validate the destination.** The output must pass `integrity_check`, and the row count of every
   table must equal the staged source. The file is then fsynced.
6. **Commit.** The code re-checks that no `network-status.db` exists, then atomically renames
   `.migrating` to `network-status.db`. It then writes `legacy-migration.json` (time, source path,
   per-table row counts) and removes the staging directory.
7. Normal startup continues. `openDatabaseAtPath()` sets WAL mode and runs the usual inline schema
   migrations, exactly as an in-place upgrade would.

**Safety properties**

- An existing canonical DB is never overwritten.
- Only a fully validated file ever gets the canonical name.
- A crash at any point leaves either no canonical DB, which reruns cleanly on the next start
  (stale staging and temp files are removed first), or a complete one.
- Legacy files are only ever read.
- Repeated launches are no-ops once the canonical DB exists.

**Failure behavior:** every failure raises `LegacyDataMigrationError` with an actionable message
naming the paths involved. `main` shows it in an error dialog and exits. Our own temp and staging
files are removed; the legacy directory is untouched; no empty database is created.

**Recovery**

- The legacy directory remains a complete recovery source.
- To redo the migration, quit Network Status, move `network-status.db` (and its `-wal`/`-shm`)
  and `legacy-migration.json` out of `%APPDATA%\network-status\`, then restart.
- To deliberately start empty while legacy data exists, move the legacy `system-status.db*` files
  somewhere else first.

**Not migrated:** Chromium profile data (renderer `localStorage` holds only panel-collapse and
inspector-width UI conveniences, plus caches). Those settings reset to defaults after the rename.

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
| `NETWORK_STATUS_APP_DATA_ROOT=<dir>` (env) | main | Uses `<dir>/network-status` (and `<dir>/system-status` as the legacy source) instead of the real `%APPDATA%` locations. For isolated manual testing |
| `SS_NATIVE_FOCUS_DEBUG=1` (env) | main | Logs keyboard-focus recovery calls |
| `localStorage SS_DELETE_FLOW_DEBUG=1` | renderer | Traces post-delete focus recovery |
| `localStorage system-status.mapTraceDebug=1` | renderer | Logs trace-drafting events |
| `NODE_ENV=development` | main | Exposes equipment mirror JSON on devices; dev-only inspector experiment |

Without these switches the app does no console logging except warnings and errors, plus one
info line when a legacy-data migration runs.

Note: the VS Code host can export `ELECTRON_RUN_AS_NODE=1`. If it is set when you launch
`electron .` from such a terminal, Electron runs as plain Node and the app fails at startup.
Unset it first.
