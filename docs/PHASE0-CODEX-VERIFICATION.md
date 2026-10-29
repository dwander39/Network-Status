# Phase 0 consolidated independent verification

Audit date: 2026-10-28 (America/New_York). Scope: Phase 0A + Phase 0B.
Verifier: Codex. No product code changed. No real user database opened or application installed.

## 1. Primary verdict

**PHASE0_CONSOLIDATED_CORRECTIONS_REQUIRED**

Original automated checks pass, but four added regression tests fail on verified defects.
Manual acceptance is **NOT READY**. Phase 0 remains unlocked; Phase 1 is not authorized.

## 2. Completed verification checklist

| Order | Area | Final status |
|---|---|---|
| 1 | Repository identity/history | PASS for local ancestry and current remote ref; historical force-push absence cannot be proved |
| 2 | Documentation/contracts | Reviewed README, all six active docs, archive checklists and relevant extraction references; no AGENTS.md found in workspace |
| 3 | Independent architecture | Reviewed; defects and legacy limitations distinguished below |
| 4 | Phase 0A | CORRECTIONS REQUIRED: scheduler lifecycle and MAC confirmation |
| 5 | Phase 0B identity | Configuration/unit checks pass; OS-visible identity awaits runtime/manual checks |
| 6 | Migration safety | FAIL: mixed snapshot accepted; schema check insufficient |
| 7 | Migration regressions | Original 26 pass; two new safety regressions fail |
| 8 | Monitoring regressions | Original checks pass; two new lifecycle/identity regressions fail |
| 9 | Formal testing quality | Useful hermetic foundation; important gaps exposed |
| 10 | Full automated regression | Original gate PASS; expanded gate FAIL |
| 11 | Startup/IPC | Static startup order acceptable; settings restart drops event logger; runtime not reproduced |
| 12 | Security/dependencies | Reviewed and current npm audit obtained; dedicated remediation required |
| 13 | Installer/packaging | CONFIGURATION REVIEWED; no new installer artifact or installation tested |
| 14 | Documentation consistency | Corrections required; manual checklist safety improved |
| 15 | Manual UI readiness | NOT READY for acceptance |
| 16 | Final repository audit | Expected review changes only; no staging, commit or push |
| 17 | Findings/recommendation | Return to builder for bounded corrections, then independent re-verification |

## 3. Git repository state

Initial tree clean. Branch `main` tracks `origin/main`. HEAD and cached origin/main both
`163a225678e162a4e3f1c93d64d9ee51ef5a7703`, ahead/behind `0/0`.
Read-only `git ls-remote origin refs/heads/main` independently returned that same hash.
Remotes are exactly `https://github.com/dwander39/Network-Status.git` and historical
`https://github.com/dwander39/SystemStatus.git` (`systemstatus`). Historical remote unchanged.
History includes Phase 0A `03b0808a7a5be9e1922c2f620219d0b8eb0f81d6` and original baseline
`aa1628c450ca4d57193c4b5374b1f4d4467e79cf` in order, with expected subjects.
No tracked DB, WAL, private-key or environment files found in inspected history/path searches;
common secret-pattern scan found no matches. This is a bounded scan, not proof that no historical
secret ever existed. Local history cannot establish that no remote force-push ever occurred.
Generated output and dependencies are ignored. No history changed.

## 4. Independent architecture findings

Main owns SQLite, monitoring, network identity, notifications, and shared selection. Device writes
flow through equipmentMutationService, validation, repositories, and the JSON mirror. Other
aggregates use their repositories, sometimes orchestrated inline by IPC. Preload exposes fixed
invoke/subscribe methods through contextBridge; renderer maintains React state and map drafts.
Mutation pushes update device lists; map persistence pushes invalidations and each surface re-fetches.
Selection is main-memory authority; layouts are SQLite authority. List groups and map groups are
separate models. Flat device columns, JSON mirror and runtime projection remain legacy complexity,
not a reason to rewrite the baseline.

Hidden dependencies: global network context is consulted by repositories/mutations; NULL network
rows remain visible across scopes; IP uniqueness is global, not per-network. Latest sampled context
is used ahead of debounced identity, so visible scoping can move before confirmed network events.
ARP captures rows before an asynchronous fingerprint sample, allowing a network switch between
the two to misattribute rows. These are code-inspected legacy risks needing focused follow-up.
Multi-window event/rule pushes and some lock pushes omit the map window as documented.

**B5 — Phase 0 blocker (code-proven):** `src/main/index.ts:976` restarts the scheduler after every
settings save without `eventLogs`, unlike startup and network-change paths. After changing an
adapter or interval, scheduled ping/ARP events, scheduler errors and associated alert-event logs
lose their logger until another correctly wired restart. Pass the same service on every path and
add a wiring regression. No UI test currently catches this.

## 5. Phase 0A verification

**B3 — Phase 0 blocker:** `scheduler.ts:98` guards only one scheduler instance. `stop()` clears
timers but does not drain running probes. Stop during a deferred round, then start a replacement:
two ping rounds are active. The added test observes two invocations before the first resolves.
Old rounds can still write statuses and emit notifications after stop/settings changes; quit
closes SQLite without waiting for outstanding work. Provide lifecycle-wide serialization/draining
and prevent stale result application; cover stop, restart, settings changes, rejection recovery,
and shutdown. Do not fix this solely by suppressing renderer pushes: pingService writes during probes.

**B4 — Phase 0 blocker:** ARP sequence A, B, A, A produces a confirmed B-to-A event, although B
was never confirmed. `arpRepository.ts` overwrites the observed MAC immediately and calls the
discovery mutation hook on the first changed observation. Saved MAC/vendor/type therefore change
before confirmation. Preserve a confirmed baseline separately from the candidate; reset a candidate
when the baseline returns. The new regression fails with exactly one false callback. Existing
A,B,B and alternating-MAC tests still pass. Candidate state also survives missing/pruned entries
until time retention; missing/reappearance and cross-network same-IP cases need explicit policy/tests.
Event and alert consumers are connected to the confirmation callback, amplifying false confirmations.

Within one instance, ping serialization and finally cleanup are sound. ARP scans share a module-level
promise. Network watch serializes ticks and ignores completion after stop; its parser tests do not
exercise lifecycle/debounce. Null samples do not reset candidate streaks, so “consecutive samples”
means successful samples. Callback exceptions escape `void tick()` and can reach the global fatal
rejection handler; add failure-recovery tests before claiming robust watch recovery.

OS fingerprint/ARP tools use fixed execFile arguments, 15-second timeouts and no shell. Windows
calls hide windows. TCP sockets destroy on completion/timeout. Ping uses bounded concurrency (16)
and OS timeout flags; its dependency has no independent child-kill watchdog. Hung ping cleanup,
localized Windows parsing, Linux ARP and macOS SSID remain unverified OS behavior. No live network
equipment was probed. POC numbering helper/wiring, selection-provider missing-preload guard,
database initialization extraction, TypeScript fixes and scripts were inspected; related original
tests/typecheck pass. No evidence supports treating those cleanups as broad behavior changes.

## 6. Phase 0B product identity verification

Manifest and lockfile root names are `network-status`; productName and HTML title are Network Status.
applyAppIdentity sets the app name and canonical userData before the instance lock. DB filename is
`network-status.db`, Windows folder is `%APPDATA%\network-status`. Tray tooltip and startup dialogs
use PRODUCT_NAME. Tray menu uses neutral Show/Quit. Pop-out initially specifies `Map View`; the HTML
title is expected to replace it after load, which still requires runtime observation. Notification
titles describe events; OS app branding depends on AUMID/shortcut behavior, not those title strings.
Remaining System Status strings identify migration sources, compatibility keys, or historical data.
`ssApi`, SystemStatusApi and localStorage names are internal contracts safe to retain.

## 7. Legacy migration safety verdict

**UNSAFE for baseline acceptance. B1 — Phase 0 and manual UI blocker.**
`legacyDataMigration.ts:131` copies DB/WAL separately, compares size/mtime, and probes the profile
lock twice. It holds no source consistency lock. Non-cooperating writers need not hold Chromium's
profile lock. Same-size changes and coarse/restored timestamps evade the check. integrity_check
and row counts validate the staged copy against itself, not a coherent source transaction.

The new real-SQLite test interleaves a writer at the main-file copy boundary. Source states are
A/A -> D/A -> B/B -> C/B. Both source file sizes stay identical and timestamps are normalized to
whole seconds to model coarse timestamp resolution. Migration accepts **C/A**, a state the source
never held, with integrity_check=ok. The test verifies those exact values before failing its
required rejection assertion. Only the copy boundary and legacy profile probe are controlled;
SQLite writes, checkpoints, WAL replay and validation are real. This demonstrates a consistency
hazard, not just a theoretical metadata collision.

Builder must propose a coherent source snapshot/quiescence protocol that also preserves the
no-source-writes contract, then test concurrent writers and checkpoint/WAL races. Adding hashes
alone does not establish a SQLite transaction snapshot. Replacing this design exceeds focused
verifier correction authority. SQLite documents the danger of copying during transactions:
[SQLite corruption guidance](https://www.sqlite.org/howtocorrupt.html),
[SQLite backup mechanisms](https://www.sqlite.org/backup.html).

**B2 — Phase 0 blocker:** schema validation only requires a table named devices (`:201`). The added
fixture `devices(unrelated INTEGER)` is imported successfully. Validate required legacy columns
and compatible schema before installing the canonical DB, allowing genuine historical versions.
Otherwise incompatible data is permanently selected on subsequent launches and startup migration
can fail after installation of the canonical file.

| Requested adversarial cases | Evidence/status |
|---|---|
| A fresh; B valid legacy; C uncheckpointed WAL | Original SQLite tests PASS |
| D active/recent writer; E files change during copy | Profile-lock simulation/Windows holder pass; non-cooperating writer test FAIL; metadata-changing copy fault injection absent |
| F canonical; G both; H record without canonical | Original tests PASS |
| I stale staging; P repeated launch; Q crash leftovers/retry | Original tests PASS for constructed leftovers; no process-kill/power-loss campaign |
| J copy failure; K validation failure; L final-install failure | Invalid/corrupt input covered; precise I/O, validation-mismatch and rename/record-write fault injection missing |
| M readonly source; N denied destination | Not independently executed; implementation reads source only; permission-specific tests needed |
| O corruption; R unchanged legacy; S no empty replacement | Original fixtures/hash assertions PASS for covered failures; foreign devices schema FAIL |
| T path before DB; V isolated testing | Static gate/order and stub tests PASS; all audit fixtures under generated temp roots |
| U no overwrite | Existing canonical and mid-migration appearance tests PASS; exists-check then rename remains a TOCTOU against non-cooperating creators |

VACUUM INTO provides a consistent snapshot of the **staged** database, not retroactive source
consistency. Staging is cleaned on normal failures and retries. Canonical installation precedes
record writing, so a record-write failure can leave a valid canonical DB with no record; next launch
uses it. Parent-directory durability is not fsynced; absolute power-loss guarantees are unproved.
Legacy source is never opened by SQLite in production migration; original tests hash it unchanged.

## 8. Startup order verdict

Static import inspection found no imported application module reading app name/userData, opening
SQLite, or creating windows/sessions during evaluation. vendorLookup loads its dependency at import
but does not choose application data paths. applyAppIdentity runs before requestSingleInstanceLock;
preparation runs first in whenReady, then markUserDataPrepared, DB, event service, initial context,
IPC registration, window, menu, tray, scheduler and watch. The DB gate prevents accidental early
empty creation. No import-order correction is justified by current code. Chromium profile/lock
placement and runtime error-dialog behavior still need isolated Electron smoke evidence.

## 9. Migration regression test results

Original `legacyDataMigration.test.ts`: **26/26 PASS**, real SQLite with meaningful device/settings/
profile/event/map rows, WAL-only data, canonical protection, retries, corruption and source hashes.
Identity unit tests: **5/5 PASS**. Added migration tests: **0/2 PASS**, exposing B1 and B2.
The builder's deliberate WAL-copy mutation was not independently repeated; inspected WAL-only
assertions do establish meaningful main-file-only protection. Tests still lack explicit I/O fault
injection, permission failures, compatible historical schema matrix, hot rollback-journal recovery,
and real macOS/Linux lock liveness.

## 10. Full test suite assessment

Baseline: **106 tests (51 unit + 55 integration), all pass**. Expanded audit suite:
**110 tests: 106 pass, 4 fail** (51 unit pass; integration 55 pass, 4 fail).
No existing assertions weakened, tests skipped, or failures marked expected. Four added tests are
deliberately retained red as correction requirements. Electron-as-Node harness matches native ABI;
forks isolate test modules; temp helpers close DBs/remove fixtures. Electron stub throws on getPath,
which protects real data, but disables notifications and cannot prove windows, Chromium profile
placement, single-instance behavior or IPC startup.

| Risk | Current evidence | Required next protection |
|---|---|---|
| Migration/source consistency | Real WAL fixtures plus failing interleaving | Coherent snapshot and writer/checkpoint/failure matrix (highest priority) |
| Monitoring lifecycle | Fake timers, mocked probes, real DB; failing restart | Drain/cancel behavior and stale-write tests |
| MAC identity | Real DB; false-return confirmation reproduced | Confirmed/candidate state, disappearance/prune/network cases |
| Events/alerts/IPC | Mostly code inspection, stubbed notifications | Settings-restart wiring; cooldown/scope/fire logging tests |
| Network watcher/commands | Parser tests, timeout inspection | Deferred sampling, stop/start, rejected callback, child cleanup tests |
| Renderer/map/multi-window | Geometry tests and code inspection | Component interaction and Electron-level state synchronization |
| Startup/packaging/upgrade | Bundle compilation/configuration | Isolated Electron smoke; installer test in disposable VM |

No arbitrary coverage percentage is required.

## 11. Broad build/regression results

Commands run from repository root using npm.cmd because PowerShell execution policy blocks npm.ps1.
No policy was changed.

| Command | Result |
|---|---|
| `npm.cmd run verify` before additions | Exit 0: typecheck, 51 unit, 55 integration, build:vite |
| `npm.cmd run test:integration -- tests/integration/phase0Verification.test.ts` initial probe | Exit 1 at mixed-snapshot rejection requirement |
| `npm.cmd run test:integration` with all additions | Exit 1: 55 pass, 4 fail |
| `npm.cmd run verify` with all additions | Exit 1: typecheck and 51 units pass; integration 55 pass/4 fail; build stage not reached |
| `npm.cmd run build:vite` separately | Exit 0: main/preload/renderer production bundles |
| `git diff --check` | Exit 0 |
| `npm.cmd audit --json --cache .audit-cache` | Exit 1 because findings exist; 36 vulnerable packages |
| production-only audit | One moderate vulnerable package, uuid |

Electron test workers emit CreateFile access-denied registration diagnostics but execute/assert
normally. Build output is ignored. Installer build, installed upgrade and UI were not tested.

## 12. Security and dependency findings

Audit: **36 vulnerable packages: 3 critical, 25 high, 6 moderate, 2 low**. These are package-level
audit findings, not 36 distinct CVEs. Direct findings: Electron (high), electron-builder (high),
electron-vite (moderate), Vite (high), Vitest (critical), uuid (moderate). Critical packages are
Vitest, tinypool and tar. Most other findings propagate through builder/test/build tools.
Production-only audit reports uuid; source uses v4, whereas its listed buffer-bounds advisory
affects v3/v5/v6 buffer use. No affected call path was found here.

Electron is a devDependency for npm packaging purposes but **ships as the application runtime**.
Production-only audit therefore understates desktop exposure. Electron 33 is outside the supported
three-major policy; current audit reports context-isolation/bridge and navigation-related issues
among others. Not every advisory is reachable in this app: updater, custom protocol, worker-node,
offscreen and application-install APIs are not configured here. Vitest UI/server exposure is not
part of the run-only test workflow; tar/extraction findings concern build inputs, not LAN probes.
These distinctions do not make the obsolete runtime safe.

**B6 — Phase 0 security gate:** require a supported Electron target and scoped dependency remediation
or an explicit orchestrator risk disposition before lock. Recommended separate bounded package:
upgrade Electron/native SQLite ABI first, then compatible electron-builder, Vite/electron-vite and
Vitest versions; review transitive archive tools; rerun this regression suite, isolated startup,
packaging and VM upgrade checks. Do not run audit fix --force. Select versions at implementation
time rather than treating today's suggested versions as an approved migration plan.

Context isolation is enabled; main disables nodeIntegration, pop-out relies on Electron default.
Preload exposes a fixed API rather than arbitrary channels. CSP and navigation/new-window guards
are absent; IPC generally lacks payload/sender runtime validation (device mutation validation is
stronger). Debug maintenance reads are exposed in production. No shell interpolation was found in
OS tool calls. Untrusted network strings are rendered through React rather than explicit HTML
injection in reviewed paths. These hardening gaps are deferred debt unless an exploitable path is
identified; no end-to-end exploit was demonstrated. Electron support policy:
[official release policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

## 13. Installer identity findings

**CONFIGURATION REVIEWED. ARTIFACT NOT BUILT. UPGRADE NOT TESTED.**
appId remains com.systemstatus.app; productName implies Network Status.exe and Network Status.app.
NSIS GUID continuity is tied to appId. Local builder 25 templates set shortcut AUMID to APP_ID;
process code sets electron.app.system-status. This is a real mismatch, not cosmetic branding:
taskbar grouping/pins and notification association can differ. Classify as deferred compatibility
risk requiring manual observation, not automatic appId renaming. Stable installer ID should remain.
Internal bridge/localStorage identifiers have no equivalent OS risk. Shortcut/install-folder reuse
is configuration-supported, not established by a real upgrade. A renamed macOS bundle can coexist
with the old app. No existing release artifacts were treated as evidence for this HEAD.
[Builder NSIS identity guidance](https://www.electron.build/docs/nsis/) recommends matching AUMIDs
and warns that appId changes break upgrade continuity.

Installer creation is non-destructive in principle, but full build can download tools/signing inputs
and would not validate installation or the migration blocker. Defer it to the corrected baseline
with a dedicated output directory; do not run an installer on the user's existing installation.

## 14. Application startup/smoke findings

No normal GUI launch performed. Builder's reported isolated launch is not independent runtime
evidence. There is no repository-owned safe end-to-end harness; app startup automatically samples
OS network context and can start monitoring migrated adapter/device settings. With migration and
lifecycle blockers, runtime acceptance is deferred to the corrected baseline, using synthetic data,
absolute unique override roots, no selected adapters and no inherited renderer URL override.
Validate canonical paths and root separation before launch, then title, preload, initialization,
restart, source hashes and process cleanup. Actual notifications/tray/Chromium paths remain UNKNOWN.

## 15. Capability inventory validation

The inventory is generally accurate as **code inspection**, with important WORKING qualifications:
ping/discovery/device CRUD/settings/events/alerts/profiles/layout/grouping/pop-out/tray/single-instance
have implementation paths; events after settings, MAC confirmation and scheduler restart are defective.
Only parser, mutation, DB and geometry subsets are automatically tested. None is manually verified
by this audit. Group ordering, column persistence, picker placement and trace persistence/deletion
remain PARTIAL. Search and Sort toolbar have no behavior; context menus and visual creation remain
POCs/placeholders (visual creation does persist devices; placeholder describes maturity).
Trace save helper exists but is not called by the drafting UI. Shared selection/push implementation
exists, but multi-window behavior needs actual windows. No new completion claims warranted.

## 16. Documentation consistency findings

Active branding, legacy paths, test commands/counts and unlocked phase gates are consistent with the
original baseline. Historical docs intentionally retain System Status and obsolete checklists.
Architecture statements that a stat-checked copy is quiescent, any change is detected, and foreign
files are rejected overstate actual safety (B1/B2). “Never overwritten” depends on cooperative
single-instance behavior; exists+rename is not an unconditional no-clobber operation. CURRENT-STATE
WORKING claims need the B3/B4/B5 qualifications. Notification branding cannot be inferred from names.
Audit count 36 is accurate, but describing Vitest risk only as UI-server risk omits other current
toolchain advisories. Expanded test counts must be reconciled after builder corrections.

Manual instructions formerly deleted fixed temp folders recursively on each run. Helper now uses
validated scenario names and fresh GUID folders. Added NOT READY gate and explicit warning that
re-importing the fixture discards post-migration edits. Real-data/installer steps remain gated off
for this verification. Do not copy those recovery deletions into a production procedure.

## 17. Codex changes

- New `tests/integration/phase0Verification.test.ts`: two failing migration safety regressions.
- `tests/integration/scheduler.test.ts`: one failing replacement-scheduler overlap regression.
- `tests/integration/arpRepository.test.ts`: one failing unconfirmed-MAC-return regression.
- `docs/MANUAL-UI-CHECKLIST.md`: acceptance hold, unique test roots, recovery-data warning.
- New `docs/PHASE0-CODEX-VERIFICATION.md`: this evidence report.

No product implementation edits. Existing edited files retain CRLF. Audit cache was removed after
checking its absolute path. No lockfile/dependency changes, commits, pushes or real-data access.

## 18. Blockers

**Before manual acceptance:** B1 mixed snapshots and B2 inadequate schema validation; a corrected
safe migration path and isolated smoke evidence are required. B3/B4/B5 must be fixed before the
user can meaningfully accept monitoring/event behavior. Synthetic diagnostic UI exploration is
possible but is not acceptance.

**Before Phase 0 lock:** B1-B5 corrections and new regression coverage; B6 supported-runtime
remediation/risk disposition; missing migration fault-path tests; manual UI results and documentation
reconciliation. No arbitrary broad refactor is a gate.

**Deferrable:** known trace/list/column/locale/multi-window limitations, AUMID compatibility decision,
CSP/navigation/IPC hardening absent a demonstrated exploit, architectural mirror complexity,
icons and formatting. Record their risks explicitly. Unverified installer upgrades must stay
labelled unverified until a disposable installation test is performed.

## 19. Manual UI verification checklist

After corrections and independent regression re-verification:

1. Quit application instances; obtain a separate immutable backup with the application closed.
2. Create a unique absolute temp root; verify it differs from real APPDATA and set the override
   in the same shell. Use synthetic fixtures first. Do not delete an existing test directory.
3. Fresh root: branding, preload, empty start, canonical filename, no legacy folder creation.
4. Copied legacy fixture including WAL: source hashes, all persisted records, migration record,
   restart/no re-import, later edits persist, legacy hashes unchanged.
5. Corrupt/in-use/missing-canonical fixtures: readable error, no unintended DB or UI/tray; recovery
   against copies only. Preserve post-migration edits instead of silently re-importing older data.
6. Main/pop-out title, tray, taskbar, OS notification app identity and single-instance focus.
7. CRUD/invalid and duplicate IPs; selection; restart; map layout/grouping/pop-out synchronization.
8. Authorized LAN targets only: selected-adapter ping/ARP, network profiles, offline/online events,
   alert scope/cooldown and MAC confirmation. Repeat after changing settings to exercise B5.
9. Installer/upgrade in disposable VM only; distinguish artifact creation from installed behavior.
10. User records PASS/FAIL/NOTE and any unexercised cases. Only the user declares manual PASS.

Real-data launch is outside this audit and remains a deliberate later user decision.

## 20. Final repository state

Branch main; HEAD and origin/main `163a225678e162a4e3f1c93d64d9ee51ef5a7703`; ahead/behind 0/0.
Tracked modifications: manual checklist, ARP test, scheduler test. Untracked additions: this report
and phase0Verification.test.ts. No staged files. package-lock.json unchanged. Working tree is
intentionally dirty for review. Ignored out/ was rebuilt; no generated artifact committed.

## 21. Recommendation to orchestrator

Return B1-B5 to Claude in a bounded correction package. Require a reviewed migration consistency
design before implementation, preserve source-data safety, and use the four retained red tests as
minimum regression gates. Add settings-restart event wiring and missing fault/lifecycle coverage.
Resolve the runtime security disposition before lock. Then rerun Codex verification, isolated
startup and user UI acceptance, reconcile documentation, obtain commit/push authorization, and
perform independent clean-tree/remote-alignment/final-lock review. This report neither locks Phase 0
nor authorizes Phase 1.
