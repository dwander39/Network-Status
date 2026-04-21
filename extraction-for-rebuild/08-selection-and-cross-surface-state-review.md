# Selection and cross-surface state review

## How shared selection works (verified)

- **Authority:** Main process variable `selectedEquipmentIds: string[]` in `src/main/index.ts`.
- **API:** `IPC.GET_SELECTED_EQUIPMENT_IDS`, `IPC.SET_SELECTED_EQUIPMENT_IDS`, `IPC.ON_SELECTED_EQUIPMENT_IDS_CHANGED`.
- **Preload:** `getSelectedEquipmentIds`, `setSelectedEquipmentIds`, `onSelectedEquipmentIdsChanged`.
- **Renderer:** `SelectionStateProvider` (`src/renderer/selection/SelectionStateContext.tsx`):
  - On mount, fetches current ids from main.
  - Subscribes to change events.
  - On local `setSelectedEquipmentIds`, updates React state **and** invokes IPC to push to main (with signature dedupe via sorted string join).

## One authoritative selection set? (verified)

- **Yes for equipment/device ids** — explicitly documented in IPC comments (“v1 equipment ids only”).
- **No for map-only entities** — manual groups, gateway, auto groups are **not** in the shared selection set as persisted in main; map uses local `MapSelection` then maps subsets to equipment ids where applicable (`mapSelection.ts` imports in `MapView.tsx`).

## Surfaces participating (verified)

- **Device table:** Reads/writes shared selection.
- **Map canvas:** Uses `mapSelection` + bridging functions like `mapSelectionToSharedEquipmentIds` (per `MapView.tsx` imports).
- **Multi-window:** Both `mainWindow` and `mapWindow` receive `ON_SELECTED_EQUIPMENT_IDS_CHANGED` pushes.

## Where state lives (verified)

| State | Location |
|-------|-----------|
| Canonical equipment id ordering | Main memory (sorted on set) |
| React mirror | `SelectionStateProvider` |
| Map-specific selection | `MapView` / `mapSelection` (local) |

## IPC / event patterns (verified)

- **Push on change** from main after `SET_SELECTED_EQUIPMENT_IDS` mutates.
- **Initial push** to new map window on `did-finish-load`.

## Good architecture (judgment)

- Cross-window selection **requires** main authority — this implementation acknowledges that.
- Signature dedupe in React provider reduces echo loops.

## Brittle (judgment)

- **v1 limitation:** Only string ids — no typed selection object (e.g. `{ kind: 'manualGroup', id }` in main).
- **Two-stage mental model:** Map selection vs shared equipment ids — easy to desync if new node types added without bridge updates.
- **Order semantics:** Main sorts ids for equality; UI must not rely on “click order” for stable identity beyond Set semantics.

## Carry-forward notes

- Rebuild should define a **Selection model** that can represent **all selectable entities** if map and list are first-class peers, or accept main-only equipment ids with explicit mapping layer (documented).
