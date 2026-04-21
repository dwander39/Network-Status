# Extraction index — legacy repo → rebuild reference

## Purpose

This folder captures a **technical architectural extraction** of the legacy Electron application as it exists in this repository (npm manifest name: `system-status`; product name in build config: **System Status**). The user request referred to this tree as the old “Filament” legacy codebase; **all claims below are grounded in files in this repo**, not an external product definition.

The goal is to preserve **what exists**, **what appears intentional**, **what appears partial or risky**, and **where uncertainty remains**—for a separate rebuild repository to decide what to carry forward. This is **not** executive summary material, **not** a migration plan, and **not** a mandate to preserve any subsystem.

## How to use this folder

1. Read `01-repo-overview.md` first for shape and boundaries.
2. Use `02-database-review.md` and `03-data-model-review.md` for persistence and domain truth.
3. Use `04-mutation-and-write-path-review.md` and `05-ipc-and-process-boundary-review.md` for write authority and process splits.
4. Use `06-list-view-review.md` through `09-styling-and-design-system-review.md` for UI surfaces and presentation.
5. Use `10`–`11` for toolchain and dependencies.
6. Use `12`–`14` for reuse vs. discard judgment aids (still **rebuild team** decisions).
7. Finish with `15-open-questions-and-uncertainties.md` for manual follow-up.

Distinction used throughout:

| Label | Meaning |
|--------|---------|
| **Verified in code** | Behavior or structure directly observable in source. |
| **Likely intended** | Strong comments, naming, or adjacent design docs in code. |
| **Partial / uncertain** | Incomplete, inconsistent across surfaces, or not fully traceable. |

## Document list

| File | One-line description |
|------|----------------------|
| `00-extraction-index.md` | This index: purpose, usage, and document map. |
| `01-repo-overview.md` | Directory layout, app shape, central vs. scattered truth, cleanliness vs. drift. |
| `02-database-review.md` | SQLite schema location, migrations, tables, keys, indexes, relationships, map/selection/trace storage. |
| `03-data-model-review.md` | Domain entities, device vs. map layout separation, naming, projection/mirror patterns. |
| `04-mutation-and-write-path-review.md` | Where writes occur, mutation service, repositories, bypasses, source-aware merges. |
| `05-ipc-and-process-boundary-review.md` | Main vs. renderer, IPC surface, persistence ownership, multi-window patterns, smells. |
| `06-list-view-review.md` | List/table ownership, editing, selection, coupling to legacy device model. |
| `07-map-view-review.md` | React Flow map architecture, layout persistence, traces (POC), topology vs. geometry. |
| `08-selection-and-cross-surface-state-review.md` | Shared selection (equipment ids), main-process authority, IPC sync. |
| `09-styling-and-design-system-review.md` | CSS tokens, `App.css` patterns, entanglement with implementation. |
| `10-build-runtime-tooling-review.md` | electron-vite, TypeScript, scripts, tests (absence), runtime layout. |
| `11-dependencies-and-libraries-review.md` | npm dependencies and architectural pressure from each. |
| `12-reusable-assets-review.md` | Utilities, tokens, patterns worth considering as-is vs. with review. |
| `13-risky-legacy-areas-review.md` | Stale assumptions, large components, mixed generations, bypass risk. |
| `14-rebuild-carry-forward-candidates.md` | Shortlist: likely / cautious / reference-only / do-not-default. |
| `15-open-questions-and-uncertainties.md` | Ambiguous areas and manual inspection checklist. |

## Note for the rebuild repo

Treat everything here as **reference material**. Verifying against this repo’s git history and running the app may still be required for edge cases not fully traced in a single pass.
