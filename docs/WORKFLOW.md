# Project workflow

## Roles

| Role | Responsibility |
|---|---|
| **ChatGPT** | Orchestrator: builds work-package prompts, owns phase scope and sequencing |
| **Claude** | Primary builder: implements, runs focused build-time verification, documents |
| **Codex** | Independent verifier: broad regression, architecture/doc consistency, test-quality review, final-lock recommendation |
| **User** | Manual UI verification and final approval authority |

A builder's own passing checks never close a phase.

## Phase gates

Every work package or phase goes through, in order:

1. **Bounded scope**: written up front, including what is explicitly out of scope.
2. **Implementation** by the builder.
3. **Focused builder verification**: `npm run verify` plus the tests for the changed areas.
4. **Independent Codex verification**: broad regression and review.
5. **Manual UI verification** by the user when the phase touches UI or runtime behavior
   (see `docs/MANUAL-UI-CHECKLIST.md`, extended per phase).
6. **Documentation reconciliation**: `docs/CURRENT-STATE.md`, `docs/ARCHITECTURE.md` and
   `docs/TESTING.md` updated to match reality.
7. **Repository cleanliness**: clean working tree, no secrets, no generated artifacts committed,
   `git diff --check` and `git diff --cached --check` clean (see Line endings below).
8. **Commit and push** to `origin` (`https://github.com/dwander39/Network-Status.git`).
9. **Final-lock verification** before the next phase begins.

## Verification records

Independent verification reports are kept as written by the verifier (e.g.
`docs/PHASE0-CODEX-VERIFICATION.md`). Builders do not edit them. Corrections and their status are
recorded in `docs/CURRENT-STATE.md`, and re-verification produces a new report or addendum. When a
verdict reaches the repository only through the orchestrator, the builder records it in a separate,
clearly labeled file (e.g. `docs/PHASE0-REVERIFICATION-RECORD.md`) that states its provenance.

## Dependencies and runtime

- Install with `npm run setup`. It runs `npm ci --ignore-scripts` plus the Electron binary download, so
  no Python or C++ toolchain is needed. Plain `npm install` also works where those tools exist.
  Never run `npm audit fix --force`.
- Keep Electron on a **supported** major (the latest three stable lines). Electron 44 leaves support
  when Electron 47 ships. A runtime upgrade is its own bounded work package: run `npm run verify`,
  `npm run smoke:isolated` and a packaged-exe smoke (`SMOKE_APP_EXE`).
- `better-sqlite3` must stay on an N-API release with bundled prebuilds (13.x), or a rebuild step and a
  native toolchain become necessary again.
- npm 10 can fail with "Cannot read properties of null (reading 'edgesOut')" when changing several
  dependencies in place. Set the ranges in `package.json` and run the install with npm 11
  (`npx npm@11 install`); then verify with `npm run setup` on npm 10.

## Repository conventions

- Default branch `main`; remote `origin` = Network-Status. The earlier GitHub repo
  `dwander39/SystemStatus` is kept as remote `systemstatus` (history is identical up to the baseline).
  It is historical: never push to it.
- The product was renamed from System Status to **Network Status** in Phase 0B. Historical commits,
  `docs/archive/` and `extraction-for-rebuild/` keep the old name on purpose; do not rewrite them.
  Legacy identifiers that must keep the old name are listed in `docs/ARCHITECTURE.md`
  ("Product identity and legacy data migration").
- Never run the app against your real `%APPDATA%` data to test migration behavior. Use
  `NETWORK_STATUS_APP_DATA_ROOT` with copied data (see `docs/MANUAL-UI-CHECKLIST.md` sections 0 and 13).
- Commit subjects follow `type(scope): summary` (e.g. `feat(map): …`, `fix(arp): …`, `chore(baseline): …`).
- **Line endings.** Keep each file's existing line endings until a dedicated normalization commit
  lands (CURRENT-STATE D12). Many tracked files are stored with CRLF, so `.gitattributes` sets only
  `* whitespace=cr-at-eol`: `git diff --check` then treats a CR before LF as part of the line ending,
  but still reports trailing spaces/tabs, space-before-tab and new blank lines at EOF. It has no
  `text`/`eol` attributes and so changes no file content. Check for mixed endings with
  `git ls-files --eol` (`i/mixed`).
- `out/`, `release/`, `node_modules/`, `.env*`, logs and `.cursor/` are git-ignored.
