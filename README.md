# Network Status

Desktop network device monitor (Electron + React + TypeScript + SQLite). It keeps a list of
devices you care about on each LAN, pings them on an interval, reads the OS ARP/neighbor table to
discover other hosts, records events, raises desktop notifications and custom alert rules, and draws
a manual/auto topology map.

> **Naming:** the product is **Network Status** (repository **Network-Status**, package
> `network-status`). It was called **System Status** until Phase 0B. Data from earlier installs in
> `%APPDATA%\system-status\` is copied once, on first start, into `%APPDATA%\network-status\`.
> The original database and its WAL are only read, through a read-only SQLite connection, and stay in place as a
> recovery source. A few identifiers deliberately keep the old name for
> install/upgrade continuity, such as the installer `appId` `com.systemstatus.app`. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#product-identity-and-legacy-data-migration).

> **Status:** Phase 0 is implemented and independently verified (B1–B6) on Windows x64. It
> **awaits the user's manual UI acceptance** and is **not final-locked**. See
> [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md).

## Quick start

Prerequisites: **Node.js 22.12+** (developed with Node 22.23 / npm 10.9). No C/C++ toolchain or
Python is needed: `better-sqlite3` 13 ships N-API prebuilt binaries that load in both Electron and Node.

```bash
npm run setup        # npm ci without install scripts + Electron binary download (no toolchain needed)
npm run dev          # launch the app with hot reload
```

`npm install` / `npm ci` also work if Python 3 and a C++ toolchain are installed (Windows: VS C++ Build
Tools; macOS: Xcode CLT). npm runs `node-gyp` for `better-sqlite3`'s `binding.gyp`, which is a no-op when
the bundled prebuild matches, but node-gyp itself needs those tools to start. Without them use
`npm run setup`.

Runtime: **Electron 44.10** (bundled Node 24), a supported release line. Setup, build, tests and
packaging are verified on **Windows x64** only; macOS/Linux are not verified. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model) for the security model.

On first launch, **monitoring is paused** until you choose a network adapter in
**Settings → General → Network adapters**. This is the intended default, not a bug.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start electron-vite dev server and the app |
| `npm run typecheck` | Full TypeScript check of `src/`, `tests/` and configs |
| `npm test` | Unit + integration tests |
| `npm run test:unit` | Pure-logic tests under plain Node (Vitest) |
| `npm run test:integration` | SQLite + main-process service tests under Electron's Node |
| `npm run build:vite` | Production bundle into `out/` (no installer) |
| `npm run verify` | typecheck → all tests → `build:vite` (the non-interactive gate) |
| `npm run smoke:isolated` | Launch the **built** app against a fresh temp data root and check branding, CSP, navigation guards, bridge surface, migration and restart over DevTools (run `build:vite` first; `SMOKE_APP_EXE=<packaged exe>` tests a packaged build) |
| `npm run setup` | Clean install without a native toolchain (`npm ci --ignore-scripts` + Electron download) |
| `npm run build` | typecheck → bundle → `electron-builder` installer into `release/` |
| `npm run preview` | Run the built bundle |

No environment variables or `.env` file are required. Optional debug switches are listed in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#debug-switches).

## Documentation

| Doc | Purpose |
|---|---|
| [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md) | Capability inventory, known defects, technical debt, candidate future work |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Processes, persistence, networking, data flows |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy, harness, coverage, gaps |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Project operating model and phase gates |
| [docs/MANUAL-UI-CHECKLIST.md](docs/MANUAL-UI-CHECKLIST.md) | Manual UI verification steps |
| [docs/PHASE0-CODEX-VERIFICATION.md](docs/PHASE0-CODEX-VERIFICATION.md) | Original independent Phase 0 verification report (Codex, failed with B1–B5); kept unchanged |
| [docs/PHASE0-REVERIFICATION-RECORD.md](docs/PHASE0-REVERIFICATION-RECORD.md) | Record of the accepted B1–B6 re-verification verdict, verification scope and release-build limitations |
| [extraction-for-rebuild/](extraction-for-rebuild/00-extraction-index.md) | April 2026 deep architectural extraction (historical reference; see note in CURRENT-STATE) |
| [docs/archive/](docs/archive/) | Superseded original build/test checklists |
