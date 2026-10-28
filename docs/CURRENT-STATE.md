# Current application state

Baseline recorded **2026-10-28** during the baseline-recovery work package. Classifications come
from reading the code and from automated tests. Nothing below has been manually UI-verified yet;
items that need a human are marked **UNKNOWN / manual**.

Status key: **WORKING** · **PARTIAL** · **BROKEN** · **PLACEHOLDER** · **APPARENTLY UNUSED** · **UNKNOWN / manual**

## What the app is

A tray-resident Electron desktop app that monitors devices on whichever LAN the machine is
connected to. Each LAN is fingerprinted as `gateway|cidr` (the "network id"). Devices, ARP history,
map layouts, alert rules and event logs are all scoped to that id, so moving between networks
shows each network's own data.

## Capability inventory

### Monitoring and discovery (main process)

| Capability | Status | Source | Notes |
|---|---|---|---|
| ICMP ping loop | WORKING | `src/main/services/scheduler.ts`, `pingService.ts` | 16-way concurrency, 4 s probe timeout, default every 5 s. Only pings devices on the subnets of the **selected adapters**. Overlapping rounds fixed in this baseline (see below). |
| Online/offline transitions → notifications + events | WORKING | `pingService.ts`, `notificationService.ts`, `eventLogService.ts` | Offline notification only on online→offline; the first `unknown` result is ignored. |
| Monitoring disabled when no adapter selected | WORKING (by design) | `scheduler.ts` `runPing` | Fresh installs default to **no adapters**. All devices are then forced to `offline` and a "Monitoring is paused" banner shows. |
| ARP/neighbor discovery (`arp -a`) | WORKING | `arpService.ts` | Windows and macOS/BSD parsers are unit-tested. Reads the OS **cache**, not an active scan. No Linux-specific parser; Linux falls back to the BSD-style parser (UNKNOWN / manual). |
| Optional ping-sweep and TCP touch before ARP read | WORKING | `arpService.ts` `pingSweep` | Only in `app_owned` cache mode with sweep enabled. At most 512 hosts per LAN, sampled for larger subnets. |
| ARP cache modes `mirror_os` / `app_owned` (TTL) | WORKING | `arpRepository.ts` | Snapshot prune and TTL prune are scoped to the current network id (integration-tested). |
| MAC → vendor (OUI) lookup | WORKING | `vendorLookup.ts` (`mac-oui-lookup`) | Offline IEEE database plus VM-vendor overrides. |
| MAC-address change detection | **Was BROKEN → fixed in this baseline** | `arpRepository.ts` `upsertArpBatch` | Before the fix it could never confirm a change, so `MAC_ADDRESS_CHANGED` events and MAC-change alert rules never fired. It now confirms on the second scan that reports the new MAC. **User-visible: these events/alerts can now appear.** |
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

- SQLite file `system-status.db` in Electron `userData` (Windows: `%APPDATA%\system-status\`).
  It holds devices, list groups, ARP entries plus MAC-change history and candidates, dismissed IPs,
  settings, network profiles, alert rules, event logs, map positions, manual groups and manual traces.
- `localStorage` (renderer): collapse state of panels, inspector width, debug flags.
- **Not persisted:** extra table columns, column visibility/widths, drafted traces, "ignored"
  new networks, shared selection, "already notified" unknown IPs.

## Known defects and technical debt

Severity: **blocker / high / medium / low / informational**.

| # | Severity | Item |
|---|---|---|
| D1 | high | Electron 33 is past end of support, and `npm audit` reports 36 advisories (3 critical, 25 high), mostly in the Electron/builder toolchain. 4 come from Vitest 2 (dev-only; they affect the Vitest UI/browser server, which is not used). Needs a dedicated upgrade package. |
| D2 | high | Trace drafting POC cannot persist traces (save path never wired); traces can't be deleted. |
| D3 | medium | No renderer Content-Security-Policy, and no `will-navigate` / `setWindowOpenHandler` guards. The renderer only loads local content, so exposure is low. |
| D4 | medium | IPC handlers trust renderer payload shapes (TypeScript types only, no runtime validation). Device saves are validated in the mutation service; other payloads are not. |
| D5 | medium | Group-by in the list view repeats headers for non-adjacent rows. |
| D6 | medium | Windows network identity depends on English `ipconfig` output; macOS SSID uses the deprecated `airport` tool. |
| D7 | medium | Map pop-out window misses alert-rule/event-log pushes and IPC-handler lock pushes. |
| D8 | medium | `MapView.tsx` (~3.5k lines) mixes persistence, POC UX, selection and rendering, so changes there have a large regression surface. |
| D9 | low | List placeholders (search, Sort button), unused DeviceForm edit mode, unused table group props. |
| D10 | low | Extra columns/column layout are not persisted. |
| D11 | low | Debug/maintenance IPC (`debug*EquipmentMirror*`) is registered in production builds (read-only). |
| D12 | low | Line endings are mixed in the repo (88 CRLF / 26 LF files at baseline); no `.gitattributes`. |
| D13 | low | Placeholder tray icon; no app icon assets. |
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

1. **Dependency/security upgrade**: Electron to a supported major, electron-builder, Vite/Vitest (D1).
   Do this before feature work. Depends on the baseline test suite (now present).
2. **Electron hardening**: CSP, navigation guards, runtime IPC payload validation (D3, D4).
   Best done after 1.
3. **Trace POC decision**: wire persistence and delete, or remove the POC (D2).
4. **List view correctness**: group-by ordering, remove or implement placeholders, persist column
   layout if wanted (D5, D9, D10).
5. **Multi-window push consistency** (D7).
6. **Locale-independent network identity**, plus a replacement for macOS `airport` (D6).
7. **Product rename** System Status → Network Status, including a user-data/DB migration.
8. **UI/component and end-to-end smoke tests** (see `docs/TESTING.md` gaps).
9. **`.gitattributes`** line-ending normalization as its own isolated commit (D12).
