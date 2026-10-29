# Current application state

Baseline recorded **2026-10-28** during the baseline-recovery work package (Phase 0A, commit
`03b0808`), then updated by **Phase 0B** (product rename and legacy data migration, same day).
Classifications come from reading the code and from automated tests. Nothing below has been manually
UI-verified yet; items that need a human are marked **UNKNOWN / manual**.

**Phase 0 status: NOT FINAL-LOCKED. Phase 1 is not authorized.**

| Area | Status |
|---|---|
| B1–B5 corrections, B6 security/dependency remediation | **IMPLEMENTED**, **INDEPENDENTLY VERIFIED** (Codex `PHASE0_B6_REVERIFY_READY_FOR_MANUAL_UI`, accepted by the orchestrator) |
| Isolated manual UI verification | Authorized; **AWAITING USER MANUAL ACCEPTANCE** ([MANUAL-UI-CHECKLIST.md](MANUAL-UI-CHECKLIST.md)) |
| Real-data migration | Restricted: verified backup and explicit user approval required |
| Installed-app upgrade from System Status, macOS/Linux builds | **DEFERRED / UNTESTED** |

History: the first independent Codex verification of Phase 0A + 0B **failed** with five defects
(B1–B5; the original record, [PHASE0-CODEX-VERIFICATION.md](PHASE0-CODEX-VERIFICATION.md), is kept
unchanged). The second round accepted B1–B5 and opened B6. The third round verified B1–B6 together:
155/155 tests, `npm run verify`, clean setup, Electron 44 runtime, native SQLite, built and packaged
smoke, NSIS build and a zero-advisory audit, all on **Windows x64**. Round summary and limitations:
[PHASE0-REVERIFICATION-RECORD.md](PHASE0-REVERIFICATION-RECORD.md).

Status key: **WORKING** · **PARTIAL** · **BROKEN** · **PLACEHOLDER** · **APPARENTLY UNUSED** · **UNKNOWN / manual**

## What the app is

The product is **Network Status**. It was named **System Status** before Phase 0B.

A tray-resident Electron desktop app that monitors devices on whichever LAN the machine is
connected to. Each LAN is fingerprinted as `gateway|cidr` (the "network id"). Devices, ARP history,
map layouts, alert rules and event logs are all scoped to that id, so moving between networks
shows each network's own data.

## Capability inventory

### Monitoring and discovery (main process)

| Capability | Status | Source | Notes |
|---|---|---|---|
| ICMP ping loop | WORKING | `src/main/services/scheduler.ts`, `pingService.ts` | 16-way concurrency, 4 s probe timeout, default every 5 s. Only pings devices on the subnets of the **selected adapters**. Overlapping rounds fixed in this baseline. Overlap across scheduler stop/restart (Codex B3) fixed in the Phase 0 corrections: rounds are single-flight per process, and a stopped round persists nothing more. |
| Online/offline transitions → notifications + events | WORKING | `pingService.ts`, `notificationService.ts`, `eventLogService.ts` | Offline notification only on online→offline; the first `unknown` result is ignored. |
| Monitoring disabled when no adapter selected | WORKING (by design) | `scheduler.ts` `runPing` | Fresh installs default to **no adapters**. All devices are then forced to `offline` and a "Monitoring is paused" banner shows. |
| ARP/neighbor discovery (`arp -a`) | WORKING | `arpService.ts` | Windows and macOS/BSD parsers are unit-tested. Reads the OS **cache**, not an active scan. No Linux-specific parser; Linux falls back to the BSD-style parser (UNKNOWN / manual). |
| Optional ping-sweep and TCP touch before ARP read | WORKING | `arpService.ts` `pingSweep` | Only in `app_owned` cache mode with sweep enabled. At most 512 hosts per LAN, sampled for larger subnets. |
| ARP cache modes `mirror_os` / `app_owned` (TTL) | WORKING | `arpRepository.ts` | Snapshot prune and TTL prune are scoped to the current network id (integration-tested). |
| MAC → vendor (OUI) lookup | WORKING | `vendorLookup.ts` (`mac-oui-lookup`) | Offline IEEE database plus VM-vendor overrides. |
| MAC-address change detection | **Was BROKEN → fixed in this baseline** | `arpRepository.ts` `upsertArpBatch` | Before the fix it could never confirm a change, so `MAC_ADDRESS_CHANGED` events and MAC-change alert rules never fired. It now confirms on the second scan that reports the new MAC. **User-visible: these events/alerts can now appear.** The Phase 0A fix could report an unconfirmed MAC "returning" (A,B,A,A → false B→A; Codex B4). It also overwrote the saved MAC/vendor on the first sighting. Both were corrected: the stored MAC is now the confirmed baseline (contract in ARCHITECTURE.md). |
| Discovery writes MAC/vendor/type onto saved devices | WORKING | `equipmentMutationService.ts` `applyDiscoveryUpdate` | Matches by IP (integration-tested). |
| Network fingerprint + change debounce | WORKING | `networkDetection.ts` | Polled every 12 s; a change needs 3 consecutive matching samples. Windows parsing depends on **English** `ipconfig` labels (UNKNOWN / manual on other locales). |
| Wi-Fi SSID metadata | UNKNOWN / manual | `networkDetection.ts` | Windows `netsh`; macOS `airport -I`, which Apple has deprecated/removed in recent macOS releases. SSID is metadata only, never part of the identity. |
| New-network prompt | WORKING | `main/index.ts`, `NewNetworkDetectedModal.tsx` | "Ignore" lasts for the session only (in-memory set). |
| Tray icon, hide-on-close, single instance | WORKING | `main/tray.ts`, `main/index.ts` | Tray icon is a placeholder 16×16 PNG. Tooltip shows the offline count. |

### List view

| Capability | Status | Source | Notes |
|---|---|---|---|
| Device table, status filter, column sort (name/status/last checked) | WORKING | `App.tsx`, `DeviceTable.tsx` | |
| Inline edit name/IP/subnet/gateway | WORKING | `DeviceTable.tsx` | Errors shown via `alert()`. |
| Add device / Add multiple (placeholder IPs in 203.0.113.0/24) | WORKING | `App.tsx` | The random-IP loop is copy-pasted 3×. |
| Delete device (confirm dialog) | WORKING | `App.tsx`, `ConfirmDialogContext.tsx` | |
| Row selection: click / Ctrl / Shift / drag (replace/add/subtract) | WORKING | `DeviceTable.tsx`, `SelectionStateContext.tsx` | Shared with the map and the pop-out window via main process. |
| Group-by subnet/vendor/type | PARTIAL | `DeviceTable.tsx` `grouped` | Only groups **consecutive** rows, so the same header can repeat under name sort, and React keys can collide. |
| Extra (custom) columns, column show/hide, resize | PARTIAL | `App.tsx` state | Not persisted; lost on reload. |
| Search box, toolbar "Sort" button | PLACEHOLDER | `App.tsx` | Rendered with no behavior. |
| Assign list group from the table | APPARENTLY UNUSED | `DeviceTable.tsx` props `onSetDeviceGroup`, `groups` | Groups can only be set through the add-device form. |
| Device form edit mode | APPARENTLY UNUSED | `DeviceForm.tsx` | Only ever opened in "new" mode. |

### Network surface, settings, events, alerts

| Capability | Status | Source | Notes |
|---|---|---|---|
| Discovered (ARP) panel: sort, refresh, add to list, dismiss/clear dismissed | WORKING | `DiscoveredPanel.tsx` | Exclusion of saved and dismissed IPs is integration-tested. |
| Event log panel: filters, live updates, CSV/JSON export, clear | WORKING | `EventLogPanel.tsx`, `main/index.ts` | DB keeps at most 5000 rows; export is capped at 5000. |
| Alert rules (offline/online/new ARP host/MAC change; scope; cooldown; severity) | WORKING (MAC-change condition only effective after this baseline's fix) | `AlertRulesPanel.tsx`, `alertRulesEngine.ts` | Rule-change pushes go to the main window only. |
| Settings → General (intervals, notifications, cache mode, TTL, sweep, purge) | WORKING | `SettingsModal.tsx` | Out-of-range numeric input is dropped without feedback; the main process clamps (ping ≥ 1 s, ARP ≥ 5 s). |
| Settings → General → Network adapters | WORKING | `AdaptersPanel.tsx` | |
| Settings → General → Groups (list groups) | WORKING | `GroupsPanel.tsx` | |
| Settings → Event log severity overrides | WORKING | `EventLogSeveritySettingsPanel.tsx` | |
| Settings → Networks (rename/delete saved profiles) | WORKING | `NetworkProfilesSettingsPanel.tsx` | Does not subscribe to profile-change pushes (refreshes manually). |
| Network profile picker (view a past network) | PARTIAL | `NetworkProfilePanel.tsx` | Only shown outside List view, yet the chosen profile also changes the list. Status shows as unknown. |

### Map view

| Capability | Status | Source | Notes |
|---|---|---|---|
| Manual layout per network, persisted, undo/redo | WORKING | `MapView.tsx`, `mapLayoutRepository.ts`, `mapLayoutHistory.ts` | |
| Auto layouts by vendor / device type / subnet | WORKING | `mapAutoLayout.ts` | Read-only, in-memory. Unit-tested. |
| Gateway node + automatic gateway edges | WORKING | `GatewayNode.tsx`, `MapView.tsx` | Auto edges are typed `DMX` (naming debt). |
| Manual map groups: create/rename/delete/resize/lock/auto-size/align | WORKING | `ManualGroupNode.tsx`, `main/index.ts` | Lock changes made through the IPC handler reach the main window only. |
| Marquee selection, viewport controls, collapse/expand cards | WORKING | `mapMarquee.ts`, `mapViewport.ts` | Hit testing and extent are unit-tested. |
| Inspector (device/gateway/group/multi), inline device edit | WORKING | `MapViewInspector.tsx` | |
| Map pop-out window (`#map-window`) with shared selection | WORKING | `main/index.ts`, `App.tsx` | Single hard-coded secondary window. Alert/event pushes don't reach it. |
| Visual device creation POC (Lighting Fixture / Network Switch / DMX Node) | PLACEHOLDER (POC) | `MapView.tsx`, `@shared/mapPocVisualDeviceTypes` | Auto-numbering was broken (always restarted at 1 after reload); fixed in this baseline. Map view shows two "Add device" buttons. |
| Trace drafting POC (Power / DMX / Network, snap anchors) | PARTIAL (POC) | `MapView.tsx`, `@shared/mapTrace*` | Drafted traces live in session memory only. The persisting path (`commitManualTracePoc` → `upsertMapManualTrace`) is **never called**. Saved traces are loaded and drawn, but nothing in the UI can delete one. |
| Device / canvas right-click menu | PLACEHOLDER | `main/index.ts`, `MapView.tsx` | Device menu shows "Device actions (coming soon)". |

### Persistence and state that survives restart

- SQLite file `network-status.db` in Electron `userData` (Windows: `%APPDATA%\network-status\`).
  Before Phase 0B this was `%APPDATA%\system-status\system-status.db`. That data is copied once on
  first start and the legacy folder is never modified (see "Phase 0B" below).
  It holds devices, list groups, ARP entries plus MAC-change history and candidates, dismissed IPs,
  settings, network profiles, alert rules, event logs, map positions, manual groups and manual traces.
- `localStorage` (renderer): collapse state of panels, inspector width, debug flags.
- **Not persisted:** extra table columns, column visibility/widths, drafted traces, "ignored"
  new networks, shared selection, "already notified" unknown IPs.

## Phase 0B: product rename and legacy data migration

Design and identifier table: [ARCHITECTURE.md → Product identity and legacy data migration](ARCHITECTURE.md#product-identity-and-legacy-data-migration).

| Item | Implemented | Automatically verified | Independently verified (Codex) | Awaiting manual |
|---|---|---|---|---|
| Display name **Network Status**: window title, tray tooltip, startup/migration error dialogs, `app.setName`, `build.productName` | Yes | Partly: identity unit tests; main-window title observed in an isolated launch | Yes | Yes: pop-out title, tray, packaged exe/installer names |
| Package `name` `network-status` (lockfile root entries only) | Yes | typecheck/build | Yes | n/a |
| `userData` pinned to `<appData>/network-status` before the single-instance lock | Yes | Unit tests (`appIdentity`); observed in an isolated launch | Yes | Yes |
| Legacy AUMID kept (`electron.app.system-status`), `appId` kept (`com.systemstatus.app`) | Yes | Unit test (AUMID) | Yes | Installer upgrade: **not verified** |
| One-time legacy DB migration (read-only SQLite connection → `VACUUM INTO` snapshot with `data_version` writer detection → snapshot integrity → schema policy → upgrade of the copy only → no-clobber hard-link install, no rename fallback) | Yes; corrected after Codex B1/B2, then hardened to the orchestrator-approved SQLite snapshot | 27 + 12 + 2 (Codex) integration tests; built and packaged isolated smoke (B6) | Yes | Yes (checklist section 13) |
| Failure handling: error dialog and exit, no empty DB, legacy untouched | Yes | Integration tests (in use, changed during copy, corrupt, non-SQLite, empty, foreign/incompatible schema, unsupported version, failed upgrade, canonical missing, concurrent canonical) | Yes | Yes: dialog wording/visibility |
| `getDatabase()` gated until migration has run | Yes | Integration test | Yes | n/a |

**User-visible changes:** new name everywhere in the UI. Panel-collapse and map-inspector-width
preferences (renderer `localStorage`) reset once, because the Chromium profile is not migrated.
If System Status is still running, Network Status refuses to start until it is closed.

**Outstanding uncertainties**
- Installer upgrade over an existing System Status install has not been exercised.
- macOS/Linux running-instance detection (`SingletonLock`) is implemented, but only its parser is tested.
- Taskbar pins that point at the old executable path may need re-pinning after the exe rename (not verified).

## Phase 0 verification corrections (independently verified)

Codex's original findings are kept unchanged in [PHASE0-CODEX-VERIFICATION.md](PHASE0-CODEX-VERIFICATION.md).

| # | Original finding | Correction | Regression protection |
|---|---|---|---|
| B1 | Migration accepted a mixed snapshot (C/A) that the source never held: size/mtime checks are evaded by same-size changes and coarse timestamps | First correction: byte-verified re-read of a raw copy. **Superseded (orchestrator-approved hardening)** by a transaction-consistent SQLite snapshot: `VACUUM INTO` from a read-only connection, with `PRAGMA data_version` before and after to abort on any concurrent commit. No raw copy remains. Install is an atomic hard link with no rename fallback (`install-unsupported` otherwise) | Codex test (preserved; one precondition made conditional, see TESTING.md); raw-copy revert detector (yields the never-held state `[Router v4, mirror_os]` if reverted); committed-WAL vs open-transaction test; cross-process concurrent-writer test; locked source; hot journal; destination appearing at install; unsupported filesystem |
| B2 | Any DB with a table named `devices` was accepted | Schema policy: `user_version` = 0 and core columns required; the real `openDatabaseAtPath` upgrade must succeed and match the reference schema before install. `openDatabaseAtPath` now closes its handle on failure | Codex test (preserved); tests for the oldest supported schema (accepted and upgraded), missing core columns, missing `settings`, unsupported `user_version`, and a failed upgrade (nothing installed) |
| B3 | Stop + restart could run two ping rounds; stopped rounds kept writing and notifying | Process-wide single-flight ping guard; `pingAllDevices(…, isCancelled)` stops probing and persisting; stale results are dropped | Codex test (preserved); stopped-round-reports-nothing, replacement resumes, rejection recovery; `pingService` cancellation tests with a stubbed `ping` binary |
| B4 | A,B,A,A emitted a false B→A change; the saved MAC changed before confirmation | Confirmed baseline kept in `arp_entries`; candidates never touch it; baseline return cancels the candidate | Codex test (preserved); baseline/vendor/discovery-hook unchanged until confirmed; A,B,C,C → A→C; stale candidate after prune |
| B5 | The settings-save restart dropped the event logger | `createSchedulerController()` binds options once; all three restart paths use it | A settings-save restart test with the real `EventLogService` and DB, which writes a `DEVICE_OFFLINE` row and replaces the old interval |

**Remaining limitations:**
- B1: the snapshot is SQLite-consistent. It reads through a read-only connection, which may
  create or rewrite `-shm` and create an empty `-wal` in the legacy folder; the database and WAL
  content stay byte-identical. A writer that does not hold the System Status profile lock and commits
  only *after* the snapshot window is not prevented (no OS lock is claimed). A legacy database that
  needs hot-journal recovery is refused rather than recovered.
- B5 is tested at the controller the IPC handler calls. The handler itself (in `index.ts`) has no
  automated test.
- A ping probe that is already running when `stop()` is called is not killed; it finishes in the
  background, and its result is discarded.
- ARP scans write their own rows during a scan. Writes from a scan in flight at quit time are
  not drained before the database closes (pre-existing; errors are caught).

## Phase 0 B6: security and dependency remediation (independently verified)

**Dependencies**

| Package | Before | After | Note |
|---|---|---|---|
| electron | 33.4.11 (unsupported) | **44.10.0** (Node 24.22.1, ABI 149) | Supported line; 45.x was one week old at selection time |
| electron-builder | 25.1.8 | 26.18.0 | Fixes the `tar` / `node-gyp` / `app-builder-lib` chain; `npmRebuild: false` |
| electron-vite | 2.3.0 | 5.0.0 | |
| vite | 5.4.21 | 7.3.7 | Stays on Rollup (Vite 8 would switch to Rolldown) |
| @vitejs/plugin-react | 4.7.0 | 5.2.0 | |
| vitest | 2.1.9 | 4.1.12 | Workspace file replaced by `test.projects` in `vitest.config.ts` |
| better-sqlite3 | 11.10.0 | 13.0.3 | N-API with bundled prebuilds (SQLite 3.53.4); no rebuild for Electron |
| @types/better-sqlite3 | 7.6.13 | 9.6.0 | |
| uuid | 11.1.0 | 11.1.1 | |

The `postinstall: electron-builder install-app-deps` hook was removed (nothing to rebuild).
`npm run setup` installs without Python or a C++ toolchain (see README).

**Audit:** `npm audit` went from **36** findings (3 critical, 25 high, 6 moderate, 2 low) to **0**.
The upgrades removed 30; `npm audit fix` (non-breaking, build-time transitive packages only) removed
the last 6. The production dependency tree was unchanged by that step.

**Hardening** (design in ARCHITECTURE.md → Security model):
- production CSP;
- navigation, new-window and webview guards on every WebContents;
- deny-all permission handlers;
- explicit `sandbox` and other locked-down `webPreferences`;
- an IPC sender check on all 46 handlers;
- runtime validation of settings, purge, selection and context-menu payloads.

It also fixes a real exposure: a packaged app honoured `ELECTRON_RENDERER_URL` from the environment
and would load a remote page with the preload bridge.

| Item | Implemented | Automatically verified | Independently verified (Codex) | Awaiting manual |
|---|---|---|---|---|
| Supported Electron 44 runtime + native SQLite | Yes | 82 integration tests run under Electron 44; packaged-exe smoke | Yes | Yes |
| Production CSP enforced | Yes | Isolated smoke (eval, inline script and fetch blocked; no violations from the app, including Map view) | Yes | Yes |
| Navigation / window.open / pop-out | Yes | Smoke (blocked; pop-out opens) + unit tests | Yes | Yes |
| IPC sender check + payload validation | Yes | Unit tests | Yes | Settings save (checklist) |
| Packaging (NSIS artifact) | Yes | Artifact built and packaged exe smoke-tested | Yes | Installed upgrade **untested** |

**B6 limitations:**
- The CSP keeps `img-src data:`.
- The IPC sender check trusts any frame showing the app document; there are no third-party frames.
- Debug IPC is still registered (D11).
- The installed upgrade from a System Status install is untested.
- The NSIS shortcut AUMID mismatch (D16) is unchanged.
- The packaged app ships all eight platform prebuilds of better-sqlite3 (~27 MB unpacked); trimming
  them is optional.
- Verified on Windows x64 only; macOS/Linux builds were not produced or run.
- The installer and executable are unsigned (D18), Electron fuses are at their defaults (D19), and
  there is no Squirrel.Windows event handling because the only Windows target is NSIS (D20).
  Details: [PHASE0-REVERIFICATION-RECORD.md](PHASE0-REVERIFICATION-RECORD.md).

## Known defects and technical debt

Severity: **blocker / high / medium / low / informational**.

| # | Severity | Item |
|---|---|---|
| D1 | ~~high~~ resolved in B6 (independently verified) | ~~Electron 33 is past end of support; 36 audit advisories.~~ Now Electron 44.10.0; `npm audit` reports 0. |
| D2 | high | Trace drafting POC cannot persist traces (save path never wired); traces can't be deleted. |
| D3 | ~~medium~~ resolved in B6 (independently verified) | ~~No CSP and no navigation guards.~~ Production CSP, navigation/new-window/webview guards and deny-all permissions are in place. |
| D4 | low (reduced in B6) | All IPC now requires a trusted sender frame. Settings, purge, selection and context-menu payloads are validated at runtime, and device saves were already validated. Other handlers still rely on TypeScript types: they take ids or filters that only reach bound SQL parameters. |
| D5 | medium | Group-by in the list view repeats headers for non-adjacent rows. |
| D6 | medium | Windows network identity depends on English `ipconfig` output; macOS SSID uses the deprecated `airport` tool. |
| D7 | medium | Map pop-out window misses alert-rule/event-log pushes and IPC-handler lock pushes. |
| D8 | medium | `MapView.tsx` (~3.5k lines) mixes persistence, POC UX, selection and rendering, so changes there have a large regression surface. |
| D9 | low | List placeholders (search, Sort button), unused DeviceForm edit mode, unused table group props. |
| D10 | low | Extra columns/column layout are not persisted. |
| D11 | low | Debug/maintenance IPC (`debug*EquipmentMirror*`) is registered in production builds (read-only). |
| D12 | low | Line endings are mixed in the repo (88 CRLF / 26 LF files at baseline). `.gitattributes` only sets the `diff --check` whitespace rule (`cr-at-eol`); there is no EOL normalization. |
| D13 | low | Placeholder tray icon; no app icon assets. |
| D16 | low | The NSIS shortcut AUMID (`com.systemstatus.app`) differs from the process AUMID (`electron.app.system-status`). Pre-existing; preserved by Phase 0B for continuity. Aligning them is a separate decision. |
| D18 | low | The NSIS installer and the app executable are not code-signed; expect SmartScreen / unknown-publisher warnings. |
| D19 | low | Electron fuses are at Electron's defaults (`RunAsNode`, `NODE_OPTIONS`, CLI inspect enabled; ASAR integrity validation and `OnlyLoadAppFromAsar` disabled). Hardening needs its own packaged-build test pass. |
| D20 | informational | No Squirrel.Windows install/update event handling. Not needed for the NSIS target; required if a Squirrel target is ever added. |
| D17 | informational | Some internal identifiers still use the old name on purpose: `window.ssApi`, the `SystemStatusApi` type, renderer `localStorage` keys `system-status*`, and `appId`. |
| D14 | informational | "DMX" naming (entertainment-lighting term) is used for generic links; three overlapping device models (flat `Device`, `equipment_values_json` mirror, runtime projection). See `extraction-for-rebuild/13-risky-legacy-areas-review.md`. |
| D15 | informational | No linter/formatter configured; TypeScript strict typecheck is the static gate. |

## Fixed in this baseline

| Fix | User-visible? |
|---|---|
| Ping loop could start overlapping rounds when a round outlasted the interval; rounds are now skipped while one is in flight | Indirectly (less load; status timing unchanged when rounds are fast) |
| MAC-change confirmation could never fire | **Yes**: MAC-change events/alerts can now appear |
| POC map device auto-numbering restarted at 1 after reload | Yes (names continue the sequence) |
| OS commands (`arp`, `ipconfig`, `netsh`, `route`, `ip`, `airport`) had no timeout; now 15 s. Network-watch ticks no longer overlap | No (only affects hung tools) |
| Missing preload crashed the React tree instead of showing the existing diagnostic message | Only in that failure case |
| Full-source typecheck failed (6 errors, `PointerEvent` shadowing); the `build` script never typechecked `src/` | No |

## About `extraction-for-rebuild/`

A detailed architectural extraction written in April 2026 for a possible separate rebuild. It is
accurate for the code it describes and remains a useful deep reference. It is **not** a plan: this
repository is being stabilized in place, and nothing there is an approved roadmap. Where it differs
from this file, this file reflects the current baseline (e.g. automated tests now exist).

## Candidate future work

Derived only from the findings above. Nothing here is approved; scheduling is the orchestrator's call.

1. ~~**Dependency/security upgrade**: Electron to a supported major, electron-builder, Vite/Vitest (D1).~~ Done in B6. Keep Electron within its supported window; 44 leaves support when 47 ships.
   Do this before feature work. Depends on the baseline test suite (now present).
2. ~~**Electron hardening**: CSP, navigation guards, runtime IPC payload validation (D3, D4).~~ Done in B6. Remaining: schemas for the lower-risk handlers, and dropping debug IPC from production builds (D11).
   Best done after 1.
3. **Trace POC decision**: wire persistence and delete, or remove the POC (D2).
4. **List view correctness**: group-by ordering, remove or implement placeholders, persist column
   layout if wanted (D5, D9, D10).
5. **Multi-window push consistency** (D7).
6. **Locale-independent network identity**, plus a replacement for macOS `airport` (D6).
7. ~~Product rename System Status → Network Status, including a user-data/DB migration.~~
   Implemented in Phase 0B and independently verified; manual acceptance pending.
8. **UI/component and end-to-end smoke tests** (see `docs/TESTING.md` gaps).
9. **Line-ending normalization** (`text`/`eol` attributes) as its own isolated commit (D12).
10. **Code signing and Electron fuse hardening** for release builds (D18, D19), plus an installed-upgrade test on a disposable VM.
