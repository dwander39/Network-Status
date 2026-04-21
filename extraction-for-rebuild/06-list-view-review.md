# List view review

## What List View owns (verified)

Primary implementation: **`src/renderer/components/DeviceTable.tsx`** embedded from **`App.tsx`** in list mode.

- **Table presentation:** Sortable columns (`SortKey`: name, group, status, lastChecked), `GroupByMode` (none, subnet, vendor, deviceType), resizable columns, optional hidden columns.
- **Row interactions:** Click / Shift-range / Ctrl/Cmd additive / Alt subtractive selection; **drag marquee** selection on rows (threshold + pointer capture patterns).
- **Inline editing:** Name, IP, subnet, gateway cells with local `editing` / `draft` state; commits via `onSaveDevice` prop → IPC.
- **Extra columns:** Controlled by `App.tsx` state (`extraColumns`, `extraColumnValues`) — **UI-only**, persisted nowhere in SQLite (**verified** from `App.tsx` props wiring).

## Relationship to editing / inspection (verified)

- **Full device form:** `DeviceForm` modal from `App.tsx` (`formDevice` state) — not inside `DeviceTable`.
- **Delete:** Row delete → `onDelete` → IPC from parent.
- **Group assignment:** Dropdown per row → `onSetDeviceGroup`.

## Relationship to selection (verified)

- Uses `useSelectionState()` — syncs with **main-process authoritative** equipment id set (see selection review).
- Row highlight derives from `selectedEquipmentIds`.

## Backbone or peripheral? (judgment)

- **Backbone for operational workflows:** Table is where inline edits, bulk selection, and group assignment converge — **yes** for day-to-day device management in this app.
- **Not backbone for map:** Map has its own selection model (`mapSelection` types) bridged to shared equipment ids when appropriate.

## Reusable parts (judgment)

- Sort + group-by patterns with stable keys.
- Drag-select gesture patterns (modifier precedence documented in component).
- Column resize utility effect.

## Legacy-coupled / patchy parts (judgment)

- Tight coupling to flat `Device` / `SaveDevicePayload` shapes.
- `alert()` for validation errors — quick but not a design system dialog pattern.
- Extra columns feature adds a **second parallel schema** in React state only — confusing for data export / map parity.

## Carry-forward notes

- If rebuild keeps a table-first UX, **explicitly decide** whether “extra columns” become real persisted attributes or are dropped.
