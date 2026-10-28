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

- **Vitest 2.1** (pinned to match Vite 5). Projects are defined in `vitest.workspace.ts`.
- **Unit project:** plain Node. `@shared` alias plus an `electron` alias to `tests/stubs/electron.ts`,
  because some parsers live in main-process modules whose import graph reaches `electron`.
- **Integration project:** run by `scripts/run-integration-tests.mjs`, which starts Vitest with the
  Electron binary and `ELECTRON_RUN_AS_NODE=1`. `postinstall` compiles `better-sqlite3` for
  Electron's ABI, so a second native build for plain Node is not needed. The same stub replaces
  `electron` (`Notification` unsupported; `app.getPath` **throws**, so tests can never touch the
  real user database).
- **Isolation:** `tests/integration/helpers/tempDb.ts` gives every test a fresh, fully migrated
  SQLite file in its own OS temp directory, deleted afterwards.
- **Determinism:** no live network. OS-dependent pieces are tested through their pure parsers;
  the scheduler test mocks the probe and adapter modules and uses fake timers.
- Tests are included in `npm run typecheck`.

## Current coverage (106 tests: 51 unit, 55 integration)

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
| ARP persistence | `integration/arpRepository` | Upsert/normalize, network-scoped snapshot prune, MAC-change confirmation (regression), discovered list exclusions |
| Scheduler | `integration/scheduler` | Adapter-subnet filtering, no overlapping ping rounds (regression), monitoring-paused state, stop() |
| Product identity (Phase 0B) | `unit/appIdentity` | Canonical `network-status` / legacy `system-status` paths, isolated-testing override, call order of name → AUMID → `userData`, legacy AUMID on Windows only |
| Legacy data migration (Phase 0B) | `integration/legacyDataMigration` | Real SQLite fixtures built with the app's repositories. Covers: fresh install (no legacy dir created); migration of devices/settings/profiles/events/map data, **including rows present only in an uncheckpointed `-wal`** (the fixture is shown to be meaningful: the main file alone holds 0 devices); self-contained output file; legacy directory byte-identical with no files added; migration record matches actual row counts; Chromium profile/`-shm` not copied; existing canonical DB never replaced or merged, with or without legacy data present; idempotent repeated launches with later legacy writes not re-imported; refusal when a recorded migration's DB has gone missing; cleanup of an interrupted migration; partial temp file never treated as valid; refusal while legacy is running (before and during the copy); a canonical DB appearing mid-migration is left untouched; non-SQLite, corrupted, empty and foreign legacy files rejected without creating a DB; `getDatabase()` gated until preparation has run; `SingletonLock` parsing; Windows `lockfile` probe against a real share-mode lock held by another process (Windows-only test) |

The migration suite's WAL cases were checked against a deliberate mutation: making the code copy only
the `.db` file fails 4 of them.

## Known gaps (intentionally not yet covered)

- **React components / UI behavior** (DeviceTable selection, MapView interactions). Needs
  jsdom + Testing Library. `MapView.tsx` should be decomposed first to make that worthwhile.
- **End-to-end app smoke** (launch the built app, check the window and `ssApi`). Needs Playwright's
  Electron support or similar, with a temp `userData` directory, and a display on CI.
- **IPC handler layer** (`src/main/index.ts`): handlers are registered inline at startup. Testing
  them needs either extraction into testable modules or an Electron-level harness.
- **Alert rules engine and event log service**: only exercised indirectly.
- **Live OS behavior** (real `ping`, real `arp`, non-English Windows, Linux): manual only.
- **Packaged build** (`npm run build` installer): manual only. That includes the NSIS upgrade from a
  System Status install (shortcut rename, install folder reuse), which has not been exercised.
- **Main-process startup wiring** (`applyAppIdentity` → lock → `prepareUserDataDirectory` → error
  dialog) is not under automated test. It was observed once in an isolated launch during Phase 0B;
  see `docs/MANUAL-UI-CHECKLIST.md` section 9.
- **macOS/Linux** `SingletonLock` liveness check: only the parser is tested.

## Expectations for future phases

1. Add or extend tests for every behavior a phase changes. Bug fixes need a regression test that
   is shown to fail on the old code.
2. Never weaken an assertion to make it pass. If expected behavior genuinely changes, update the
   test and record why in the phase report.
3. Keep tests hermetic: temp directories, no real user data, no live network unless that is the
   behavior under test (and then mark it clearly and keep it out of `npm test`).
4. `npm run verify` must stay non-interactive and must fail loudly (no `|| true`).
