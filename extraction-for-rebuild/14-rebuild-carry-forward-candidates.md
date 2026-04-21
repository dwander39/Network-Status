# Rebuild carry-forward candidates

Practical shortlist. **Rebuild team decides.** Each item: bucket, why, what to verify before reuse.

## Carry forward likely

| Item | Why | Verify before reuse |
|------|-----|---------------------|
| `src/shared/ipc.ts` pattern | Prevents channel string drift | Naming scheme fits new IPC taxonomy |
| `better-sqlite3` + WAL + `foreign_keys=ON` defaults (`database.ts`) | Solid desktop SQLite baseline | Packaging/signing targets |
| Per-network map persistence schema (`map_layout_*`, `map_manual_traces`) | Clear LAN scoping | Whether JSON polylines remain acceptable |
| `equipmentMutationService` merge/ownership concept | Proven multi-writer discipline | New schema + async boundaries |
| `design-tokens.css` | Coherent dark tokens | Brand/contrast requirements |
| Main-authoritative cross-window selection | Correct model for Electron | Expand selection model beyond equipment ids |

## Carry forward with caution

| Item | Why | Verify before reuse |
|------|-----|---------------------|
| `@xyflow/react` map implementation | Feature-rich | Team capacity; file size/complexity |
| `networkDetection` canonicalization | Reduces duplicate profiles | OS-specific adapter behavior |
| Event log schema + indices | Useful ops visibility | Retention/privacy policy |
| `domain/equipment` projection layer | Smooth migration story | Eliminate mirror if possible |
| Debounced `saveMapLayout` IPC | Limits disk chatter | Conflict resolution / multi-user (N/A today) |

## Reference only

| Item | Why | Verify before reuse |
|------|-----|---------------------|
| `MapView.tsx` monolith | Behavior spec, not module | Extract patterns only |
| `App.tsx` extra columns | Non-persisted UX | Decide product direction |
| `TEST-TODO.md` | Manual QA | Replace with automation |

## Do not carry forward by default

| Item | Why | Verify before reuse |
|------|-----|---------------------|
| Inline-only migrations in one startup file | Scales poorly | External migration framework |
| Partial multi-window event fan-out | Subtle bugs | Unified bus or shared store contract |
| Trace POC domain vocabulary (`DMX` as generic data) | Confusing outside niche | Rename + model |
