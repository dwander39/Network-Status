# Testing strategy

Automated testing is mandatory for all future work packages. Every change must keep
`npm run verify` green, and every bug fix should come with a test that fails without the fix.

## Commands

| Command | Scope |
|---|---|
| `npm test` | Unit then integration |
| `npm run test:unit` | `tests/unit/**` under plain Node |
| `npm run test:integration` | `tests/integration/**` under Electron's Node |
| `npm run verify` | typecheck → all tests → production bundle |

Forward Vitest arguments with `--`, e.g. `npm run test:integration -- tests/integration/scheduler.test.ts`.

## Harness

- **Vitest 4.1** (Vite 7). The `unit` and `integration` projects are defined under `test.projects` in
  `vitest.config.ts` (Vitest 4 removed the separate workspace file).
- **Unit project:** plain Node. `@shared` alias plus an `electron` alias to `tests/stubs/electron.ts`,
  because some parsers live in main-process modules whose import graph reaches `electron`.
- **Integration project:** run by `scripts/run-integration-tests.mjs`, which starts Vitest with the
  Electron binary and `ELECTRON_RUN_AS_NODE=1`, so SQLite tests run on the shipped runtime (Electron 44 /
  Node 24). `better-sqlite3` 13 loads its bundled N-API prebuild in Electron and in plain Node alike, so
  there is no per-ABI rebuild. The same stub replaces
  `electron` (`Notification` unsupported; `app.getPath` **throws**, so tests can never touch the
  real user database).
- **Isolation:** `tests/integration/helpers/tempDb.ts` gives every test a fresh, fully migrated
  SQLite file in its own OS temp directory, deleted afterwards.
- **Determinism:** no live network. OS-dependent pieces are tested through their pure parsers;
  the scheduler test mocks the probe and adapter modules and uses fake timers.
- Tests are included in `npm run typecheck`.

## Verification status

The 155-test suite, `npm run verify`, the isolated smoke (built and packaged) and a clean
`npm run setup` were independently reproduced by Codex for B1–B6 (verdict
`PHASE0_B6_REVERIFY_READY_FOR_MANUAL_UI`; see `PHASE0-REVERIFICATION-RECORD.md`). All automated
verification so far ran on **Windows x64**; macOS and Linux have not been built or tested. Automated
checks do not replace manual UI acceptance (`MANUAL-UI-CHECKLIST.md`), which is still pending.

## Current coverage (155 tests: 73 unit, 82 integration, plus the isolated smoke harness)

| Area | Suite | Behaviors protected |
|---|---|---|
| ARP parsing | `unit/arpParsers` | Windows/macOS `arp -a` formats, MAC normalization, interface attribution, junk lines |
| Network identity | `unit/networkDetection` | `normalizeNetworkId` (legacy 3-part ids), `ipconfig` parsing incl. next-line gateway and multi-adapter preference |
| IP/subnet math | `unit/ipAndSubnet` | IPv4/netmask validation, host enumeration, sampling cap, sweep dedupe |
| Device validation | `unit/deviceSaveValidation` | Field rejections + codes, custom-type rules |
| Map helpers | `unit/mapLayout`, `unit/mapShared` | Auto-layout buckets and ordering, auto-group id round trip, marquee hit tests, translate extent, trace type normalization/keys, POC numbering (regression) |
| Schema/migrations | `integration/database` | Fresh schema, WAL/FK pragmas, default settings, idempotent reopen with data preserved |
| Settings | `integration/database` | Round trip, partial merge, clamping, corrupt stored values |
| Device mutations | `integration/deviceMutations` | Create/update/delete, validation, IP uniqueness, groups, monitoring/discovery write paths, network-scoped listing |
| ARP persistence | `integration/arpRepository` | Upsert/normalize, network-scoped snapshot prune, MAC-change confirmation (regression), confirmed-baseline contract: an unconfirmed MAC returning reports nothing (Codex B4); stored MAC/vendor and the discovery hook are untouched until confirmation; A,B,C,C confirms A→C; a stale candidate cannot confirm after prune/reappearance; discovered list exclusions |
| Scheduler | `integration/scheduler` | Adapter-subnet filtering, no overlapping ping rounds (regression), monitoring-paused state, stop(); no overlap with a stopped-but-unfinished round (Codex B3); a stopped round reports nothing; the replacement resumes; rejection recovery; a settings-save restart through `createSchedulerController` keeps writing monitoring events to the real event log (B5) |
| Ping persistence/cancellation | `integration/pingService` | Stubbed `ping` binary: result persisted while active; nothing persisted and no transition after cancellation; no probes start once cancelled |
| Migration consistency/compatibility (Phase 0 corrections + SQLite hardening) | `integration/legacyMigrationConsistency`, `integration/phase0Verification` (Codex) | **Snapshot:** exactly one committed state is migrated (revert detector: a raw-copy strategy interleaved with a writer yields the never-held state `[Router v4, mirror_os]`); every committed WAL transaction across related tables is included and an open transaction is excluded; a separate writer process committing two tables per transaction is always detected (`legacy-changed-during-snapshot`), never produces a mixed install, and loses no writer commit; a source locked in `EXCLUSIVE` mode → `legacy-in-use`, with nothing created; a hot rollback journal → `legacy-unreadable`, with the database and journal byte-identical. **Install:** a destination created immediately before linking is never overwritten; an unsupported filesystem → `install-unsupported` with no fallback, the validated copy kept, and a clean retry. **Schema:** oldest supported schema migrated and upgraded; missing core columns, missing `settings`, non-zero `user_version` and a failed real upgrade all rejected with nothing installed. Codex: mixed C/A snapshot and foreign `devices` schema rejected |
| Electron security policy (Phase 0 B6) | `unit/security` | Dev-server URL ignored when packaged, and only localhost http accepted; trusted-document check (pop-out hash, other local files, UNC hosts, `javascript:`, Windows case-insensitivity, dev origin); `hardenWebContents` on an emitter-backed WebContents: `will-navigate` / `will-frame-navigate` / `will-redirect` to untrusted URLs cancelled, the app document allowed, every `window.open` denied, webviews refused; IPC sender rejection; locked-down `webPreferences`; production CSP has no `unsafe-*`, remote hosts or wildcards, and the dev CSP never adds `unsafe-eval` |
| IPC payload validation (Phase 0 B6) | `unit/ipcValidation` | Settings: normal save kept, wrong types / out-of-range / unknown / `__proto__` keys dropped, severity overrides filtered, non-objects rejected; purge: exact scopes only; selection: bounded, strings only; context menu: finite coordinates and known target kinds |
| Product identity (Phase 0B) | `unit/appIdentity` | Canonical `network-status` / legacy `system-status` paths, isolated-testing override, call order of name → AUMID → `userData`, legacy AUMID on Windows only |
| Legacy data migration (Phase 0B) | `integration/legacyDataMigration` | Real SQLite fixtures built with the app's repositories. Covers: fresh install (no legacy dir created); migration of devices/settings/profiles/events/map data, **including rows present only in an uncheckpointed `-wal`** (the fixture is shown to be meaningful: the main file alone holds 0 devices); self-contained output file; legacy database and WAL byte-identical and un-checkpointed (only SQLite's `-shm`, or an empty `-wal`, may appear); schema upgrades applied only to the new copy; migration record matches actual row counts; Chromium profile/`-shm` not copied; existing canonical DB never replaced or merged, with or without legacy data present; idempotent repeated launches with later legacy writes not re-imported; refusal when a recorded migration's DB has gone missing; cleanup of an interrupted migration; partial temp file never treated as valid; refusal while legacy is running (before and after the snapshot); a canonical DB appearing mid-migration is left untouched; non-SQLite, corrupted, empty and foreign legacy files rejected without creating a DB; `getDatabase()` gated until preparation has run; `SingletonLock` parsing; Windows `lockfile` probe against a real share-mode lock held by another process (Windows-only test) |

Mutation checks in the Phase 0 corrections each failed the intended tests:
- disabling the byte re-read failed the 2 consistency tests (that strategy was later superseded by the SQLite snapshot);
- disabling the schema pre-check failed 4 tests;
- disabling the real-upgrade check failed 1;
- replacing the no-clobber link with a plain rename failed 1;
- removing the stale-round guard failed 1;
- dropping options in the controller failed the B5 test.

SQLite hardening mutation checks:
- **`data_version` guard disabled:** all 34 attempts migrated while another process committed about 40k transactions/s, and every result was cross-table consistent (this is `VACUUM INTO`'s snapshot isolation). The concurrent test then failed only on its detection assertion.
- **Faithful revert to raw copying of `.db`/`-wal`:** the revert detector failed with the never-held state `[Router v4, mirror_os]`. The concurrent, locked-source, hot-journal and failed-upgrade tests also failed.

Codex test adjustment (documented defect against the approved contract): in `phase0Verification.test.ts` the `sizesAfter` precondition only holds when the migration raw-copies the source. Under the SQLite snapshot the copy hook never fires, so it now applies only when the hook ran. Every other assertion is unchanged, and a raw-copy revert re-enables the original check. Codex's fixture schema (`devices(value TEXT)`) is also rejected by B2, so the B1 guards are the app-schema tests in `legacyMigrationConsistency`.

The migration suite's WAL cases were checked against a deliberate mutation: making the code copy only
the `.db` file fails 4 of them.

## Isolated end-to-end smoke (Phase 0 B6)

`npm run smoke:isolated` (after `npm run build:vite`) launches the **real built app** against a fresh
temp data root (`NETWORK_STATUS_APP_DATA_ROOT`) with a synthetic legacy database whose rows exist only
in an uncheckpointed WAL, held open by an idle writer. It drives the renderer over the Chrome DevTools
Protocol on a random local port and verifies 28 checks:

- branding;
- production CSP present and enforced: `eval`, injected inline script and `fetch` all blocked, and no
  CSP violation from the app itself, including the lazy Map view;
- no Node globals in the renderer, and only the named bridge methods;
- `window.open` denied, and navigation to a remote URL or another local file blocked;
- the Map pop-out opens with the same restrictions;
- legacy migration via native SQLite;
- restart without re-migration, with the record unchanged;
- legacy database and WAL bytes unchanged.

CDP evaluation runs with `allowUnsafeEvalBlockedByCSP: false`, so it obeys the page's CSP.
`SMOKE_APP_EXE=<path to Network Status.exe>` runs the same checks against a packaged build.

The harness was mutation-checked against the built output:
- removing the CSP meta tag failed the 4 CSP checks;
- removing the `web-contents-created` hardening hook failed the window.open and navigation checks
  (the window navigated to `https://example.com/`).

It needs a desktop session and is not part of `npm test`.

## Known gaps (intentionally not yet covered)

- **React components / UI behavior** (DeviceTable selection, MapView interactions). Needs
  jsdom + Testing Library. `MapView.tsx` should be decomposed first to make that worthwhile.
- **End-to-end UI behaviour** beyond the smoke checks above (clicking through forms, tray, notifications).
  The smoke harness covers startup, security and persistence only, and needs a display.
- **IPC handler layer** (`src/main/index.ts`): handlers are registered inline at startup. Testing
  them needs either extraction into testable modules or an Electron-level harness.
- **Alert rules engine and event log service**: only exercised indirectly.
- **Live OS behavior** (real `ping`, real `arp`, non-English Windows, Linux): manual only.
- **Packaged build:** in B6 the NSIS artifact was built (not installed) and the packaged exe passed the
  smoke harness. The NSIS **upgrade** from a System Status install (shortcut rename, install folder
  reuse) has not been exercised.
- **Main-process startup wiring** (`applyAppIdentity` → lock → `prepareUserDataDirectory` → error
  dialog). The success path is exercised by the smoke harness; the error-dialog path is manual
  (`docs/MANUAL-UI-CHECKLIST.md` section 13.4).
- **macOS/Linux** `SingletonLock` liveness check: only the parser is tested.
- **Platforms:** every automated run, including the packaged smoke, was on Windows x64.
- **Release hardening:** code signing and Electron fuse settings are not tested (neither is configured;
  CURRENT-STATE D18, D19).

## Expectations for future phases

1. Add or extend tests for every behavior a phase changes. Bug fixes need a regression test that
   is shown to fail on the old code.
2. Never weaken an assertion to make it pass. If expected behavior genuinely changes, update the
   test and record why in the phase report.
3. Keep tests hermetic: temp directories, no real user data, no live network unless that is the
   behavior under test (and then mark it clearly and keep it out of `npm test`).
4. `npm run verify` must stay non-interactive and must fail loudly (no `|| true`).
