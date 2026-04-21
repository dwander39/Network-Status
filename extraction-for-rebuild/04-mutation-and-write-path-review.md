# Mutation and write path review

## Where writes happen (verified)

### Main process (authoritative)

- **`equipmentMutationService.ts`:** User save payload, group assignment, monitoring status (per-device and bulk), discovery ARP sync onto saved devices, delete orchestration — calls into `deviceRepository` persist helpers.
- **Repositories (`src/main/db/`):** Direct SQL for ARP upsert, settings, network profiles, map layout, manual traces, alert rules, event logs — invoked from services **or** from `main/index.ts` IPC handlers.

### IPC-triggered writes

- **`src/main/index.ts` `registerIpc()`:** Wires `SAVE_DEVICE`, `DELETE_DEVICE`, `SET_DEVICE_GROUP`, map layout saves, manual trace upsert, profile lifecycle (including cascade delete of scoped data), purge cache, alert rules, event log clear/export (file write + DB read), settings save.

### Renderer

- **No direct SQLite** — mutations go through `window.ssApi` (preload).

## Mutation service existence (verified)

- **Yes:** `src/main/services/equipmentMutationService.ts` is the documented orchestration layer for **device/equipment** writes, including:
  - `FIELD_OWNERSHIP` / `USER_OVERRIDABLE_FIELDS` / `merge()` for source-aware overlays.
  - `mutateDeviceFromSavePayload`, `mutateDeviceGroupAssignment`, monitoring APIs, `mutateDiscoveryDeviceFromArpRow`, delete APIs.

## Repository pattern (verified)

- **Present as “per aggregate” modules** with names like `*Repository.ts`.
- **Discipline:** `deviceRepository.persistNormalizedDevice` comments state callers must validate — routing through mutation service for user paths is **verified** for IPC `SAVE_DEVICE`.
- **Not pure:** Some policy still lives in IPC handlers (e.g. network profile delete cascade) — **architecturally acceptable** for thin apps but **not** a strict hexagonal boundary.

## One write path or multiple bypasses (verified)

- **Primary device user writes:** IPC → `applyUserSaveDevicePayload` → `mutateDeviceFromSavePayload` → persist — **single path** (verified).
- **Monitoring:** Scheduler → `setAllDevicesStatus` / per-device updates in `pingService` path (see scheduler + ping) → mutation service — **verified** for status columns.
- **Discovery:** ARP batch upsert hooks `applyDiscoveryUpdate` — **verified** in `arpRepository` options pattern.
- **Potential bypass concern:** Any future direct `persistNormalizedDevice` call without mutation service would skip validation — **grep responsibility** for rebuild; current IPC uses mutation for user saves.

## Source-aware mutation (verified)

- Explicit `EquipmentMutationSource` and `Source` types; merge ignores keys outside allowed set for `monitoring` / `discovery` vs `user`.

## Ownership rules (verified in code)

- Documented in `FIELD_OWNERSHIP` — user owns name, custom type, group; discovery owns ip/subnet/gateway overlay where allowed; monitoring owns last status fields.

## Direct-write / bypass observations

- **`main/index.ts` DELETE_NETWORK_PROFILE:** Runs extra `db.prepare('DELETE FROM alert_rules WHERE network_id = ?')` inline — **bypasses** a hypothetical `alertRuleRepository` bulk delete (minor consistency smell).
- **Map layout:** IPC calls `mapLayoutRepository` directly — no single “map mutation service” — **partial** consolidation.

## Architecturally strong (judgment)

- Source-aware merge for multi-writer device row.
- Structured mutation results with applied/rejected patches (equipment mutations types).
- Delete device triggers layout + manual trace cleanup in repository layer (`persistDeleteDeviceById`).

## Dangerous / brittle (judgment)

- Bulk monitoring `setAllDevicesStatus` loops per-device mutations — **correct semantics**, potential performance cost at scale (N devices × N ping interval).
- Async labeled `deleteDevice` in mutation service — **actually async function** but may be sync inside; IPC awaits it — verify no race assumptions in rebuild.

## Carry-forward notes

- The **ownership table + merge** pattern is a strong template for any rebuild with discovery + user + monitoring writers.
