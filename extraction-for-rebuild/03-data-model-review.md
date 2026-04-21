# Data model review

## Major domain entities (verified)

- **Device (saved equipment row):** `Device` in `src/shared/types.ts` (consumed across IPC); persisted in `devices` table; mapped in `deviceRepository.rowToDevice`.
- **Device group (list):** `device_groups` + `DeviceGroup` type — naming/sorting for **table** organization, distinct from map manual groups.
- **ARP / discovery:** `ArpEntry` — OS cache mirror + join metadata for profiles in some queries (`listDiscoveredDevices`).
- **Network profile:** Named LAN fingerprint with `network_id`, optional SSID metadata, `settings_json`.
- **Map manual group:** Bounded region on canvas with `contents_locked`.
- **Map layout snapshot:** `node_key` → `{ x, y, manualGroupId?, mapDeviceCollapsed? }`.
- **Map manual trace:** Typed connection between two device ids + snap ids + `path[]`.
- **Alert rule / event log:** Operational metadata aggregates.

## Equipment / device model shape (verified + partial)

- **Authoritative:** SQLite columns on `devices` as read by `deviceRepository`.
- **Projection:** `mapDeviceToEquipmentRuntime` (`deviceEquipmentAdapter.ts`) exposes `EquipmentRuntimeProjection` with typed `values` bag — **not a second persisted entity**.
- **Mirror:** `equipment_values_json` written after successful column writes (`equipmentMutationService.syncEquipmentValuesMirror`) — **verified**; dev-only inclusion over IPC via `INCLUDE_DEV_EQUIPMENT_MIRROR_JSON`.
- **Intent (comments):** Phase-1 bridge toward richer equipment model — **likely intended**; **not complete** as full domain split.

## Map / layout model shape (verified)

- **Persisted:** `map_layout_positions` + `map_manual_groups` (+ `map_manual_traces` for drawn links).
- **Ephemeral:** Auto-layout modes in `mapAutoLayout.ts` — `MapView` uses `MapLayoutMode = 'manual' | MapAutoGroupMode`; auto modes are **view transforms**, not persisted positions (comments + rebuild tick behavior in `MapView.tsx`).

## Trace / connection model (verified)

- **Automatic edges:** React Flow `Edge[]` built in `buildEdges()` — gateway → each device, **not** stored in SQLite; suppressed by heuristics vs. manual traces.
- **Manual traces:** SQLite `map_manual_traces` + in-session traces in component state before persist (`sessionManualTraces` in `MapView.tsx`).
- **Snap metadata:** Shared helpers `mapDeviceSnapPoints.ts`, `mapTraceSnapAnchorFlow.ts`, etc. — **geometry and UI affordances**, not a separate topology table.

## Data vs. layout separation (assessment)

- **Verified separation:** Device row does not store x/y; map tables hold layout.
- **Partial mixing:** `node_key` equals device id string; gateway synthetic id; collapse flag lives in layout table — acceptable but stringly coupled.
- **Risk:** Trace path geometry encodes both **presentation** and **persisted “truth”** without separate logical link model.

## Single source of truth discipline

- **Strong:** Device user fields routed through mutation service; monitoring limited to status timestamps; discovery limited to MAC/vendor/type inference.
- **Violations / blur:**
  - Renderer debounced `saveMapLayout` builds payload from React Flow nodes — **correct boundary** (IPC persist) but complex to audit inside one file.
  - `App.tsx` “extra columns” for table are **React state only** — **not** in SQLite (verified by extraction of `App.tsx`); **not** shared with map — intentional UI-only feature but breaks “one device row” mental model for operators.

## Naming consistency

- **device** vs **equipment** vs **node_key** — transitional naming; IPC still `SAVE_DEVICE`, context says “equipment ids” for selection.
- **device_groups** (list) vs **map_manual_groups** (canvas) — **verified distinct**; comments in `database.ts` acknowledge this — good, but easy to confuse in conversation.

## Domain-driven vs. patch-driven (judgment)

- **Patch-driven signals:** Repeated migrations on one table; large `MapView.tsx`; POC flags and “Step N” comments in map trace flow.
- **Domain-driven signals:** `equipmentMutationService` field ownership tables; explicit network canonicalization; typed shared IPC payloads.

## Carry-forward notes

- Any new model should **name and document** the difference between **list organizational groups** and **map spatial groups** explicitly.
