# Architecture

Electron app built with **electron-vite**: three bundles (main, preload, renderer) plus shared
code. For a much deeper per-subsystem review see `extraction-for-rebuild/` (April 2026). The
summary below was re-checked against the code at the October 2026 baseline.

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron 44.10 (bundled Node 24.22, Chromium/V8 15.2); supported release line (Phase 0 B6) |
| UI | React 18, `@xyflow/react` 12 (map), plain CSS with tokens (`design-tokens.css`) |
| Language/build | TypeScript 5.9 (strict), Vite 7 via electron-vite 5, electron-builder 26 (NSIS / DMG; `npmRebuild: false`) |
| Persistence | SQLite 3.53 via `better-sqlite3` 13 (N-API; bundled prebuilt binaries, so no rebuild for Electron's ABI) |
| Networking | OS `ping` binary (`ping` package), `arp -a`, `ipconfig`/`netsh` (Win), `route`/`airport` (macOS), `ip route` (Linux), Node `net` sockets |
| Other | `mac-oui-lookup` (offline OUI DB), `uuid` |
| Tests | Vitest 4 (see `docs/TESTING.md`) |

## Source layout

```
src/
  main/            Electron main process (all I/O, all persistence, all networking)
    index.ts       app lifecycle, windows, tray, menu, ~60 IPC handlers, push fan-out
    appIdentity.ts product name, AUMID, userData layout (canonical + legacy paths)
    security.ts    trusted-renderer policy, webPreferences, navigation/new-window guards, IPC sender check
    ipcValidation.ts runtime validation of high-risk IPC payloads
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
  `nodeIntegration: false`, `sandbox: true`). The renderer never calls Node APIs, `fetch` or `ipcRenderer` directly.
- **Renderer** is pure React state fed by `ssApi.get*` calls and `ssApi.on*` push subscriptions.
- **Windows**: one main window (hides to tray on close) and an optional single **Map pop-out**
  (`#map-window` hash, same preload). The shared selection set is held in main memory and broadcast
  to both windows.

## Security model

Added in Phase 0 B6 (`src/main/security.ts`, `src/main/ipcValidation.ts`,
`src/shared/contentSecurityPolicy.ts`) and independently verified on Windows x64. The app is **local-only**: the renderer loads no remote
scripts, styles, fonts, images or network resources, and the hardening keeps it that way.

- **Trusted document.** The only trusted renderer URL is the app's own `out/renderer/index.html`
  (any hash, e.g. `#map-window`); paths are compared case-insensitively on Windows.
  - `ELECTRON_RENDERER_URL` / `VITE_DEV_SERVER_URL` are honoured only when the app is **not
    packaged**, and only for an `http://localhost|127.0.0.1|[::1]` origin. Before B6 a packaged app
    loaded any URL from these variables, together with the privileged preload bridge.
- **Window options** (`secureWebPreferences`, every window): `contextIsolation`, `sandbox`,
  `webSecurity` on; `nodeIntegration` (including workers and subframes), `webviewTag`,
  `allowRunningInsecureContent` and `navigateOnDragDrop` off.
- **Navigation and windows** (`hardenWebContents`, attached to every WebContents through
  `app.on('web-contents-created')`):
  - `will-navigate`, `will-frame-navigate` and `will-redirect` to anything but the trusted document
    are cancelled.
  - `setWindowOpenHandler` denies every renderer-initiated window. The Map pop-out is created by
    the main process over IPC, so it is unaffected.
  - `<webview>` attachment is refused.
  - External links are not opened at all; the app has no workflow that needs them (React Flow's
    attribution link is hidden).
- **Permissions:** the default session denies every permission request and check. Notifications
  are created by the main process and are unaffected.
- **CSP.** It is injected as the first `<head>` element by a renderer build plugin
  (`electron.vite.config.ts`).
  - Production: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
    font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';
    frame-src 'none'; worker-src 'none'; media-src 'none'; manifest-src 'none'`.
  - Dev server only: adds `'unsafe-inline'` for scripts (the React-refresh preamble) and styles
    (Vite-injected `<style>`), and `ws://localhost:*` for HMR. It never adds `unsafe-eval` or
    remote hosts.
- **Preload bridge:** a fixed set of named methods. Each `on*` subscription forwards only the
  payload (never the `IpcRendererEvent`) and returns an unsubscribe function. `ipcRenderer` itself is
  not exposed.
- **IPC.** Every `ipcMain.handle` registration goes through a wrapper that rejects calls whose
  `senderFrame` is not the trusted document. High-risk payloads are validated at runtime (unknown
  input is treated as `unknown`):
  - settings saves: whitelisted keys, typed and bounded values, known event types and severities
    only;
  - purge: the scope must be exactly `all` or `current_network`;
  - shared selection: bounded string ids;
  - context menu: finite coordinates and a known target.

  Device saves keep their existing validation. Event-log export writes only to a path chosen in
  the OS save dialog, and all SQL uses bound parameters.
- **Release-build limitations (not part of the runtime hardening):**
  - the NSIS installer and the executable are not code-signed (CURRENT-STATE D18);
  - Electron fuses are left at Electron's defaults, so `RunAsNode`, `NODE_OPTIONS` and the Node CLI
    inspect flags stay enabled, and ASAR integrity validation and `OnlyLoadAppFromAsar` stay disabled
    (D19);
  - there is no Squirrel.Windows event handling, because the only Windows target is NSIS (D20).
- **Not changed (deferred):** debug/maintenance IPC handlers are still registered in production
  builds (read-only; CURRENT-STATE D11), and the remaining IPC handlers rely on TypeScript types plus
  the sender check rather than full runtime schemas.

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
| Legacy `userData` / DB | `<appData>/system-status/system-status.db` | Read-only migration source, read through a read-only SQLite connection. The database and WAL are never written, moved or deleted (SQLite may add or update `-shm`, or create an empty `-wal`) |
| Renderer `localStorage` keys (`system-status:*`, `system-status.*`) | unchanged | Internal keys. Renaming them would only reset UI preferences |

`NETWORK_STATUS_APP_DATA_ROOT` (env) replaces `<appData>` for both the canonical and the legacy
directory. Use it only for isolated manual testing.

**Expected installer behavior.** This was read from the electron-builder 25 NSIS templates and re-checked against 26.18.0 in B6 (same GUID derivation, InstallLocation reuse, shortcut rename and app-data deletion rules); no real
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
| `network-status.db` exists | Use it. Legacy data is ignored and never re-imported. Our leftover temp artifacts are removed |
| No canonical DB, but `legacy-migration.json` exists | **Error.** The data was migrated earlier and has since gone missing. Nothing is silently recreated (see recovery) |
| No canonical DB, no legacy DB | Fresh install. Nothing is created in the legacy location |
| No canonical DB, legacy DB exists | Migrate (below) |

Migration steps (orchestrator-approved SQLite snapshot; implemented in the Phase 0 SQLite hardening):

1. **Legacy app must be closed.** The legacy profile's Chromium single-instance lock is probed
   (Windows: `lockfile` that cannot be opened for writing; macOS/Linux: a `SingletonLock` symlink
   to a live `host-pid`). If it is in use, the migration stops with "close System Status". The probe
   runs again after the snapshot.
2. **Transaction-consistent snapshot through SQLite** (`snapshotLegacyDatabase`). The legacy
   database is opened with a **read-only** better-sqlite3 connection (busy timeout 2 s), then:
   1. `PRAGMA data_version` is read.
   2. `PRAGMA integrity_check` must return `ok`.
   3. The rows of every table are counted.
   4. `VACUUM INTO '<canonical>/network-status.db.migrating'` runs.
   5. `data_version` is read again.
   - *Why it is consistent:* `VACUUM INTO` reads the source inside **one read transaction**. In WAL
     mode, a reader sees exactly the database as of the last commit before its transaction began,
     including every committed frame still in the WAL and no uncommitted frames, across all tables.
     SQLite documents the output as a consistent snapshot of the source. It copies every table,
     including unknown ones, plus `user_version` (verified on SQLite 3.49.2 (better-sqlite3 11.10.0)
     and again on SQLite 3.53.4 (better-sqlite3 13.0.3)).
   - *Why `VACUUM INTO` rather than the Online Backup API:* better-sqlite3's `backup()` is
     asynchronous and incremental. Each step is a separate read, and the backup restarts when
     another connection writes. `VACUUM INTO` is synchronous, so the startup path stays synchronous.
   - *Why read-only:* a read-write connection that is the last to close would checkpoint the WAL
     into the database and delete it. better-sqlite3 cannot disable that
     (`SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE` is not exposed). A read-only connection cannot write
     database pages, checkpoint, or truncate or delete the WAL.
   - *Concurrent writers:* `data_version` changes if **any other connection** commits in between.
     That covers commits during the integrity check, the counting and the snapshot. A changed value
     means a live writer whose later commits would be missing from the new database, so the migration
     aborts (`legacy-changed-during-snapshot`).
   - *Unavailable or unsafe sources:*
     - A source locked by another connection (e.g. a writer in `EXCLUSIVE` locking mode) times out
       as `SQLITE_BUSY` and is reported as `legacy-in-use`.
     - A source that needs recovery requiring write access (a hot rollback journal:
       `SQLITE_READONLY_ROLLBACK`) is refused as `legacy-unreadable`, and the original is not
       recovered. The user starts System Status once to recover it.
     - Non-SQLite or corrupt files are rejected as `legacy-unreadable`.
3. **Validate the snapshot** (`validateSnapshot`, on the copy). The copy must pass
   `integrity_check`, and every table's row count must equal the count read inside the same
   unchanged `data_version` window. The schema compatibility policy is then checked. There is no
   schema version table; every schema change is an idempotent inline migration.
   - `PRAGMA user_version` must be 0. The app never sets it, so any other value means a foreign or
     future schema.
   - The core tables and columns present since the first schema must exist:
     `devices(id, name, ip, subnet, gateway, mac_address, last_status, last_checked)` and
     `settings(key, value)`. Older schemas that lack later tables or columns are accepted.
4. **Upgrade the copy only.** The application's own `openDatabaseAtPath()` runs on the temp file.
   It must succeed, and the result must contain every table and column of a freshly created database
   (the reference is generated from the same code). It must pass `integrity_check` again. The legacy
   database is never upgraded. The temp file is then fsynced.
5. **Non-overwriting install.** The temp file is **hard-linked** to `network-status.db`. Link
   creation is atomic and fails with EEXIST if the name exists; the temp file sits in the same
   directory, so the same filesystem. The temp name is then removed and the directory is fsynced
   (best effort; not possible on Windows).
   - There is **no rename fallback**, because Node's rename replaces an existing target.
   - If the filesystem cannot hard-link (e.g. FAT32/exFAT), the migration stops with
     `install-unsupported`. The fully validated copy is kept at `network-status.db.migrating` for
     inspection; it is discarded and recreated on the next start.
6. **Record.** `legacy-migration.json` is written atomically (time, source path, per-table row
   counts).
7. Normal startup continues with `getDatabase()`. The schema is already current, and the inline
   migrations are idempotent.

**Effects on the legacy folder** (measured on SQLite 3.49.2 / Windows; re-measured with identical results on SQLite 3.53.4 under Electron 44 in Phase 0 B6):

| Legacy state | Database file | Existing `-wal` | `-shm` |
|---|---|---|---|
| Left by a killed app (`-wal` + stale `-shm`) | byte-identical | byte-identical, not checkpointed | rewritten (WAL index rebuilt) |
| `-wal` without `-shm` | byte-identical | byte-identical, not checkpointed | created |
| Cleanly closed (no `-wal`) | byte-identical | an **empty** `-wal` is created | created |

These are SQLite-managed sidecar effects, which the orchestrator allowed. Application tables, the
schema and the WAL content are never written, checkpointed, truncated or deleted. The legacy
folder is therefore **not** byte-identical after a migration attempt.

**Concurrency policy**

- The legacy app must be closed. This is enforced by the profile-lock probe before and after the
  snapshot, which detects a normally running System Status.
- A writer that does not hold that lock (another tool, or a different build) is detected through
  `data_version` if it commits during the snapshot window, or through `SQLITE_BUSY` if it holds an
  exclusive lock. Either way the migration aborts.
- **Not covered:** a writer that commits only *after* the snapshot window and before the user stops
  using System Status. Those commits stay in the legacy database and are not imported, which is the
  same as any write made after migration. No OS-level lock is claimed; Node 20 cannot open files with
  exclusive sharing.

**Safety properties**

- An existing canonical DB is never overwritten: the hard link fails with EEXIST, and there is no
  fallback.
- Only a fully validated and upgraded file ever gets the canonical name.
- A crash at any point leaves either no canonical DB, which reruns cleanly on the next start
  (stale temp files and earlier builds' staging folder are removed first), or a complete one. A crash
  after the install but before the record is written leaves a complete DB with no record, which is
  then used normally. Directory fsync is best-effort, so absolute power-loss durability is not
  claimed.
- The legacy database and existing WAL are only ever read (see the table above for `-shm` / empty
  `-wal`).
- `openDatabaseAtPath()` closes its connection if schema initialization throws, so a failed upgrade
  never leaves files locked.
- Repeated launches are no-ops once the canonical DB exists.

**Failure behavior:** every failure raises `LegacyDataMigrationError` with an actionable message
naming the paths involved. `main` shows it in an error dialog and exits. Our own temp files are
removed, except the validated copy after `install-unsupported`. The legacy database and WAL are
unchanged, and no empty database is created.

**Recovery**

- The legacy directory remains a complete recovery source.
- To redo the migration, quit Network Status, move `network-status.db` (and its `-wal`/`-shm`)
  and `legacy-migration.json` out of `%APPDATA%\network-status\`, then restart.
- To deliberately start empty while legacy data exists, move the legacy `system-status.db*` files
  somewhere else first.

**Not migrated:** Chromium profile data (renderer `localStorage` holds only panel-collapse and
inspector-width UI conveniences, plus caches). Those settings reset to defaults after the rename.

## Monitoring lifecycle contracts

- **Ping rounds are single-flight per process.** A tick is skipped while any round runs, including
  one from a stopped scheduler instance. `stop()` cannot kill probes that are already running, so
  it instead:
  - makes the stopped round's `pingAllDevices` start no new probes and persist no further results
    (via `isCancelled`);
  - makes that round return without notifications, events, alert evaluation or renderer pushes.

  The replacement scheduler then pings on its next tick after the old round settles. A rejected
  round clears the guard in `finally`.
- **One scheduler wiring.** `createSchedulerController()` binds the scheduler options (event logger,
  tray refresh, pop-out window) once. Startup, network change and settings save all call
  `restart()`, so a restart can no longer drop the event logger.
- **ARP:** scans are single-flight module-wide. Results that arrive after `stop()` are not turned
  into notifications or alert evaluations.
- **MAC-change confirmation:** `arp_entries.mac_address` holds the **confirmed** MAC.
  - A different MAC becomes a candidate. It only refreshes `last_seen`; it does not change the
    stored MAC or vendor, and it does not call the discovery hook that updates saved devices.
  - The change is confirmed, recorded in `arp_mac_changes` and reported (event and alert rules)
    when the same new MAC is seen on a second scan with no other MAC in between.
  - Seeing the confirmed MAC again cancels the candidate.
  - An entry pruned from the ARP table and later re-seen starts from the newly seen MAC as its
    baseline, which is not a change.
  - Scans in which the IP is absent do not reset a candidate.

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
