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

## Current coverage (75 tests)

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

## Known gaps (intentionally not yet covered)

- **React components / UI behavior** (DeviceTable selection, MapView interactions). Needs
  jsdom + Testing Library. `MapView.tsx` should be decomposed first to make that worthwhile.
- **End-to-end app smoke** (launch the built app, check the window and `ssApi`). Needs Playwright's
  Electron support or similar, with a temp `userData` directory, and a display on CI.
- **IPC handler layer** (`src/main/index.ts`): handlers are registered inline at startup. Testing
  them needs either extraction into testable modules or an Electron-level harness.
- **Alert rules engine and event log service**: only exercised indirectly.
- **Live OS behavior** (real `ping`, real `arp`, non-English Windows, Linux): manual only.
- **Packaged build** (`npm run build` installer): manual only.

## Expectations for future phases

1. Add or extend tests for every behavior a phase changes. Bug fixes need a regression test that
   is shown to fail on the old code.
2. Never weaken an assertion to make it pass. If expected behavior genuinely changes, update the
   test and record why in the phase report.
3. Keep tests hermetic: temp directories, no real user data, no live network unless that is the
   behavior under test (and then mark it clearly and keep it out of `npm test`).
4. `npm run verify` must stay non-interactive and must fail loudly (no `|| true`).
