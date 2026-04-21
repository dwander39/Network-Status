# Open questions and uncertainties

Items the extraction could **not** close with high confidence without deeper runtime profiling, full file reads of every branch, or product intent outside the repo.

## Ambiguous or not fully traced

- **Complete behavior of `pingService` and ARP batch transactions** — scheduler entry verified; every failure path and transaction boundary not line-audited in this extraction.
- **All `webContents.send` fan-out paths** — main index is large; secondary window gaps called out for alerts/event logs; other channels may have similar gaps.
- **`mac-oui-lookup` behavior on Windows** — package name implies macOS; actual cross-platform fidelity not verified in code during extraction.
- **Alert rules engine interactions** — files exist (`alertRulesEngine.ts`); full rule taxonomy vs. UI not exhaustively mapped.

## Schema / naming

- Whether **`equipment_values_json`** will ever become authoritative reads in production — currently dev-only over IPC for mirror column; JSON hydration experiment IPC exists — **intent vs. roadmap unclear** from code alone.
- **Historical profile viewing** (`App.tsx` ignores live `onDevicesChanged` when browsing inactive profile) — edge cases for map window not explored.

## Incomplete implementations (verified hints)

- Map node context menu for devices shows placeholder disabled item (“coming soon”) — **verified** in `main/index.ts`.
- Some IPC pushes only target main window — may be **incomplete product** rather than bug if features unused in map window.

## Intent vs. implementation mismatches (suspected, not proven)

- Comments describe “Phase 1 / POC” in multiple areas — **implementation maturity may lag documentation tone** in external specs (if any exist outside repo).

## Manual inspection checklist for rebuild team

1. Run `npm run dev` and exercise **map pop-out** + **alert rules** + **event log** simultaneously — confirm whether secondary window updates.
2. Grep `webContents.send` and compare to **all** open windows strategy.
3. Read `pingService.ts`, `arpService.ts` end-to-end for transaction + mutation ordering.
4. Audit `MapView.tsx` for any **direct** `fetch` or filesystem access (should be none) — confirm IPC-only persistence.
5. Decide fate of **table extra columns** — confirm they never hit SQLite.
6. Legal/privacy review of **event_logs** retention and export limits (export capped at 5000 rows in IPC — **verified** snippet in `main/index.ts`).

## Note on repository naming

- This workspace’s `package.json` identifies the app as **system-status** / **System Status**. If “Filament” is an external program name, **map documents explicitly** so rebuild teams do not chase the wrong repository metadata.
