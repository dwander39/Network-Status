# IPC and process boundary review

## Main vs. renderer responsibilities (verified)

| Main | Renderer |
|------|----------|
| SQLite open, migrations, all persistence | UI, React Flow, local UI state (e.g. extra columns, popovers) |
| Scheduler (ping, ARP), network watch | Invokes IPC; listens for push events |
| Tray, native menus (incl. map node context menu) | Renders `Menu`-triggered actions via IPC for persistence |
| `BrowserWindow` lifecycle, secondary map window | No `nodeIntegration`; uses `window.ssApi` |

## IPC channels / endpoints (verified)

- Declared in `src/shared/ipc.ts` as `IPC` const object.
- Exposed in `src/preload/index.ts` as `api` methods mapping to `ipcRenderer.invoke` / `ipcRenderer.on`.
- Registered in `src/main/index.ts` via `ipcMain.handle` and `webContents.send`.

**Categories observed:** devices, device groups, ARP/discovered, settings, network info/profiles, alert rules, map layout + manual groups + manual traces, event logs, debug maintenance, UI focus helpers, selection sync, map window open/focus.

## Process boundaries cleanliness (assessment)

- **Clean:** `contextIsolation: true`, `nodeIntegration: false` on main window preload path; shared type imports for payloads.
- **Messy / uneven:** Push notifications **not uniformly broadcast** to secondary window:
  - **Verified:** `pushAlertRulesToRenderer` and `pushEventToRenderer` send **only** `mainWindow` (grep `main/index.ts`).
  - **Verified:** `ON_DEVICES_CHANGED`, `ON_ARP_CHANGED`, `ON_NETWORK_*`, `ON_MAP_LAYOUT_INVALIDATED`, `ON_SELECTED_EQUIPMENT_IDS_CHANGED` often send to **both** when `mapWindow` exists.
- **Likely unintended gap:** Map pop-out may miss alert-rule and live event-log pushes — **partial** multi-window product completeness.

## Persistence ownership (verified)

- **100% main-process** SQLite via `better-sqlite3`; renderer has no file DB access.

## Renderer boundary violations (verified)

- **None for Node APIs** — assuming preload is loaded.
- **De facto “logic in renderer”:** Map trace drafting, auto-layout geometry, marquee math — **acceptable** for UI, but **business rules** (e.g. trace precedence for auto edges) live partly in renderer (`buildEdges` in `MapView.tsx`) — **duplication risk** if main ever needs same rules.

## Multi-window patterns (verified)

- **Single secondary map window** — flags `isMapWindowOpen`, `mapWindow`; opened via `OPEN_MAP_VIEW_WINDOW`; hash `#map-window` for routing in `App.tsx`.
- **Selection sync:** Main holds `selectedEquipmentIds: string[]`; `SET_SELECTED_EQUIPMENT_IDS` sorts and broadcasts; new map window receives push on `did-finish-load`.

## Architectural smells (blunt)

1. **God-file IPC registration:** `main/index.ts` is very long — mixes menu, export dialogs, scheduler restart, and every handler.
2. **Inconsistent event fan-out** to secondary window (alerts, event logs).
3. **`SET_MAP_MANUAL_GROUP_LOCK` IPC handler** sends `ON_MAP_MANUAL_GROUP_LOCK_CHANGED` to `mainWindow` only in the handler body (lines ~768–774); **context menu path** duplicates menu actions and sends to both windows — two code paths for related updates (**verified** inconsistency risk).

## Carry-forward notes

- Rebuild should treat **IPC fan-out policy** as a first-class table: which surfaces subscribe to which channels.
