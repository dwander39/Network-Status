# Map view review

**Scope:** This is the largest and most behavior-dense UI subsystem. File primary: `src/renderer/components/MapView.tsx` (~3500+ lines). Supporting: `src/renderer/components/map/*.tsx|ts`, `src/shared/map*.ts`.

## Architecture as implemented (verified)

- **Library:** `@xyflow/react` (React Flow v12) — `ReactFlowProvider`, `useNodesState`, `useEdgesState`, `useReactFlow`.
- **Node types:** `device`, `gateway`, `manualGroup`, `autoGroup` — registered in `nodeTypes` object (`MapView.tsx`).
- **Layout modes:** `MapLayoutMode = 'manual' | MapAutoGroupMode` — manual uses SQLite bundle; auto modes rebuild graph via `buildAutoLayoutNodes` (`mapAutoLayout.ts`).
- **Persistence:** Debounced `collectPersistPayload` → `api.saveMapLayout` IPC; reload on `onMapLayoutInvalidated` + initial `getMapLayout`.
- **Inspector:** `MapViewInspector` + resizable width stored in `localStorage` (`MAP_INSPECTOR_WIDTH_LS_KEY`).

## What Map View owns (verified)

- React Flow graph: nodes, drag (manual mode), selection integration (filters `select` changes out of RF `onNodesChange` to avoid split-brain — **verified** comment in `MapCanvas`).
- **Automatic edges:** Built in `buildEdges()` — gateway → device; **not persisted** in DB.
- **Manual traces (POC):** Draft polyline overlay (`MapTracePathDraftOverlay`), persisted overlay (`MapPersistedManualTracesOverlay`), `sessionManualTraces` + `persistedManualTraces`, commit via `api.upsertMapManualTrace`.
- **Trace / auto-edge precedence:** Documented in `buildEdges` — manual keys and destination-based suppression of gateway auto edges for certain connection types — **renderer-side rule** (**verified**).
- **Marquee selection:** `mapMarquee.ts` + overlay component.
- **Viewport:** `mapViewport.ts` — translate extent, zoom defaults, selection → viewport helpers.
- **Layout geometry:** `mapLayoutGeometry.ts` — absolute positions, snapping, group drop resolution.
- **Undo-ish history:** `mapLayoutHistory.ts` types referenced for drag-stop history (manual mode).

## Layout vs. data separation (assessment)

- **Respected at persistence boundary:** Device rows do not store coordinates; map tables do.
- **Blurred in the component:** Single file orchestrates device list from parent, network id, POC add-device flows, trace authoring — **high coupling**.

## Snaps / endpoints (verified)

- Shared logic: `getSnapIdentity`, `inferSnapIdsForManualTrace` from `@shared/mapDeviceSnapPoints`.
- Anchor positions: `getTraceSnapAnchorFlowPosition` (`mapTraceSnapAnchorFlow.ts`).
- **Representation:** Snap ids are **strings** stored on trace rows; hover picking in shared modules (`mapTraceSnapHoverPick`, `mapTraceSnapDraftEndHoverPick`).

## Trace authoring implementation (verified)

- Mode state in `MapCanvas` (e.g. `mapTraceAuthoring`, path draft refs, `commitManualTracePoc`).
- User draws intermediate points in flow space; commit validates devices, network id, Power→Router source rule; infers default snap ids; may replace first/last path points with anchor coordinates.
- **Feedback:** Local banner state `TracePocCommitFeedback` — comments describe “POC”.

## Heuristic vs. stateful (judgment)

- **Stateful:** Draft points, session traces, epoch guard against race with network/mode change during save.
- **Heuristic:** Auto-edge suppression rules keyed off manual trace rows — logical but **not** a generalized graph algorithm.

## Topology explicit vs. geometry-driven (blunt)

- **Geometry-driven:** Persisted `path_json` polylines and React Flow node positions are the dominant representation.
- **Topology partial:** Endpoints + `connectionType` + snap ids give a **typed edge** abstraction — **better than nothing**, but there is **no** global graph store, no L2/L3 separation, no port/channel model.

## Alignment vs. stale assumptions (judgment)

- **Aligned with “incremental POC” narrative:** Comments reference steps, POC placement cascade, trace POC — honest about maturity.
- **Stale risk:** Treating `DMX` connection type as stand-in for legacy `Data` and auto-gateway class — domain-specific naming for a **general** network tool may confuse rebuild unless renamed.
- **Large-file maintenance trap:** Effects carefully avoid dependency cycles (`mapGraphRebuildTick` comment about max update depth) — signals **fragility**.

## Likely reusable (judgment)

- **Translate extent** computation from content bounds.
- **Manual group lock** UX concept (persisted `contents_locked`).
- **Shared map visual tokens** (`mapTraceFamilyVisual.ts` + CSS variables in `design-tokens.css`).
- **IPC invalidate → refetch** pattern for map bundle (no cross-renderer CRDT).

## Likely toxic to a blind copy-forward (blunt)

- The entire **`MapView.tsx` monolith** as an organizational unit — logic is interleaved; testing surface is unclear (`TEST-TODO.md` manual checklist only).
- **Dual trace pipeline** (session + persisted + auto edges) without a single domain module.
- **Gateway synthetic id** coupling across layout keys, edges, and trace logical keys — easy to break if id changes.

## Carry-forward notes

- A rebuild should **re-platform map behavior behind a smaller set of modules** with tests, even if UX is preserved visually.
