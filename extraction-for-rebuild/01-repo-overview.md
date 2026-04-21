# Repo overview

## What exists (verified)

- **Stack:** Electron **33.x**, React **18**, TypeScript **5.7**, **Vite 5** via **electron-vite 2.x**, native **better-sqlite3** for SQLite.
- **Package identity:** `package.json` → `"name": "system-status"`, `"productName": "System Status"` under `build` (cross-platform network device monitor).
- **Entry layout (electron-vite convention):**
  - `src/main/index.ts` — BrowserWindow, tray, IPC registration, scheduler, network watch, secondary map window.
  - `src/preload/index.ts` — `contextBridge.exposeInMainWorld('ssApi', api)`.
  - `src/renderer/main.tsx` — React root, providers, `App.css`.
  - `src/shared/` — IPC channel constants, shared types, validation, map/trace helpers (used from main and renderer).
  - `src/domain/equipment/` — equipment projection, field registry direction, mutations types (Phase-1 / transitional).
  - `src/main/db/` — SQLite open + inline migrations in `database.ts`, per-entity repositories.
  - `src/main/services/` — scheduling, ping, ARP, notifications, network detection, equipment mutation orchestration.

## Major folders and apparent responsibilities

| Path | Responsibility |
|------|------------------|
| `src/main/db/database.ts` | Single SQLite file under `app.getPath('userData')`, WAL, `foreign_keys=ON`, **all schema creation and migrations** (no separate SQL migration folder). |
| `src/main/db/*.ts` | CRUD / queries per aggregate (devices, ARP, groups, settings, network profiles, map layout, manual traces, alert rules, event logs). |
| `src/main/services/equipmentMutationService.ts` | Central **write orchestration** for devices (user / monitoring / discovery) + delete lifecycle. |
| `src/main/services/scheduler.ts` | Interval ping + ARP; pushes `ON_DEVICES_CHANGED` / `ON_ARP_CHANGED` to renderer(s). |
| `src/main/services/networkDetection.ts` | Network identity (`gateway|cidr` style), debounced stable id vs. sampled context (imported throughout). |
| `src/renderer/App.tsx` | Shell: list vs. map vs. network views, device/group/ARP state, modals, lazy `MapView`. |
| `src/renderer/components/DeviceTable.tsx` | Primary **list** surface: sort, group-by, inline edit, drag-select, extra columns (local state in `App`). |
| `src/renderer/components/MapView.tsx` | Very large **map** surface: React Flow graph, layout modes, manual groups, trace POC, inspector. |
| `src/renderer/selection/SelectionStateContext.tsx` | React context bridging renderer selection to **main-held** equipment id set via IPC. |
| `src/shared/ipc.ts` | Channel name constants (single source for preload alignment). |

## Application shape at a glance

- **Single primary window** (hidden on close, tray-driven on Windows/macOS per `main/index.ts`).
- **Optional secondary “Map View” window** — same preload, hash `#map-window`; not a generalized multi-window framework.
- **Views:** list (table + side panels), map (React Flow), network (`NetworkSurface`), settings modal, event log / alerts / discovery panels.
- **Data flow:** Renderer invokes IPC → main reads/writes SQLite → main pushes `webContents.send` for invalidation and lists. No shared Redux/store across processes; renderer holds React state fed by IPC.

## Notable architectural patterns

- **Inline migrations** co-located with `getDatabase()` — pragmatic for a small app, **high coupling** between startup and schema evolution.
- **Repository “persistence only”** comments on several DB modules vs. **`equipmentMutationService`** for policy validation and source-aware merges — **partial** strict layering (some IPC handlers still compose multiple DB calls in `main/index.ts`).
- **Equipment “Phase 1” projection:** `mapDeviceToEquipmentRuntime` + optional `equipment_values_json` mirror column — **dual representation** of the same logical device row (verified in `deviceEquipmentAdapter.ts`, `equipmentMutationService.ts`, `deviceRepository.ts`).
- **Network scoping:** `network_id` on devices, ARP, map tables, alert rules, event logs — with **legacy NULL network_id** tolerance in list queries (verified in `deviceRepository.listDevices`).

## Where truth is centralized vs. scattered

| Centralized | Scattered |
|-------------|-----------|
| SQLite file + `database.ts` migrations | Map layout + trace **geometry** in renderer state with debounced persist; large logic in `MapView.tsx`. |
| `IPC` channel names in `shared/ipc.ts` | Some broadcast paths differ per event (e.g. not all main→renderer events target the map window — see IPC review). |
| `equipmentMutationService` for device write policy | `App.tsx` holds extra table columns and UI-only state; alert rule push only main window in places. |

## Clean vs. drifted (engineering judgment)

- **Cleaner:** Explicit `IPC` object; context-isolated preload; typed shared payloads; design token file for global CSS; mutation service documenting field ownership.
- **Drifted / high risk:** `MapView.tsx` size (~3.5k+ lines) mixing persistence orchestration, POC trace UX, selection, and React Flow concerns; transitional “equipment” layer parallel to flat `Device` type; mixed terminology (device vs. equipment vs. map `node_key`).

## Likely intended (from comments and structure)

- Long-term **equipment** model replacing flat device columns, with JSON mirror as migration bridge — **not complete** as a separate persisted aggregate; still one `devices` table authoritative.
- Map **manual traces** as POC additive to automatic gateway edges — comments describe precedence rules, not a full network topology engine.

## Carry-forward notes

- Rebuild teams should assume **“System Status” codebase** semantics unless external “Filament” docs are explicitly mapped file-by-file.
