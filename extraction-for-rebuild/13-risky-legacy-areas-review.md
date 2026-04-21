# Risky legacy areas review

## Stale assumptions (verified / judgment)

- **IP uniqueness == device identity** — enforced in DB and mutation paths; weak for DHCP-heavy ops without extra keys.
- **DMX naming** for generic network links in map traces — domain language from entertainment lighting creeping into general network monitor (**judgment**: naming debt).
- **NULL `network_id` legacy rows** still shown when filtering by active network — migration-era compatibility (**verified** in `listDevices` WHERE clause).

## Mixed architecture generations (verified)

- Flat `Device` columns + `equipment_values_json` mirror + `EquipmentRuntimeProjection` “Phase 1” — three lenses on same entity.
- **List “device_groups”** vs **map `map_manual_groups`** — correct separation in schema, **easy to misuse** in conversation and code search.

## Patch-on-patch systems (judgment)

- `MapView.tsx` accumulation of POC steps, guards (`mapGraphRebuildTick`), and debounced persistence — high regression surface.
- Network profile delete cascade inlined in IPC — works until someone adds a new `network_id`-scoped table and forgets delete.

## Domain confusion (judgment)

- **Equipment vs device** naming in selection IPC vs `SAVE_DEVICE` channels.
- **Trace `connectionType`** mixing electrical/data/network semantics without physical port model.

## Geometry where topology should exist (blunt)

- Persisted polylines (`path_json`) are the truth for drawing; **no** validated graph invariants (cycles, redundancy, LAG, etc.).

## Bypassed or fragile write paths (verified / judgment)

- Inline SQL in some IPC handlers — **verified** for alert rule delete on profile removal.
- **Map lock IPC** inconsistent broadcast between handler vs context menu path — **verified** risk of desync between windows.

## Misleading abstractions (judgment)

- `EquipmentRuntimeProjection` sounds like persisted equipment — **it is not**; `_projection.source` helps but easy to misuse in rebuild docs.

## Carry-forward notes

- Treat **map trace POC** and **equipment Phase 1** as **explicitly bounded** experiments when reading code comments — comments are honest; copying without boundaries is dangerous.
