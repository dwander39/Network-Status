# Network Status

Desktop network device monitor (Electron + React + TypeScript + SQLite). It keeps a list of
devices you care about on each LAN, pings them on an interval, reads the OS ARP/neighbor table to
discover other hosts, records events, raises desktop notifications and custom alert rules, and draws
a manual/auto topology map.

> **Naming:** the product is **Network Status** (repository **Network-Status**, package
> `network-status`). It was called **System Status** until Phase 0B. Data from earlier installs in
> `%APPDATA%\system-status\` is copied once, on first start, into `%APPDATA%\network-status\`.
> The original folder is left intact. A few identifiers deliberately keep the old name for
> install/upgrade continuity, such as the installer `appId` `com.systemstatus.app`. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#product-identity-and-legacy-data-migration).

## Quick start

Prerequisites: **Node.js 20+** (developed with Node 22.23 / npm 10.9) and the platform build tools
`better-sqlite3` needs if a prebuilt binary is unavailable (Windows: VS Build Tools; macOS: Xcode CLT).

```bash
npm install          # also rebuilds better-sqlite3 for Electron (postinstall)
npm run dev          # launch the app with hot reload
```

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
| [extraction-for-rebuild/](extraction-for-rebuild/00-extraction-index.md) | April 2026 deep architectural extraction (historical reference; see note in CURRENT-STATE) |
| [docs/archive/](docs/archive/) | Superseded original build/test checklists |
