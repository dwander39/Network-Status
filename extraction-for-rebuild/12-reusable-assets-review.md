# Reusable assets review

## Likely reusable as-is (judgment + verified paths)

- **`src/shared/ipc.ts`** — channel name centralization pattern.
- **`src/shared/ipValidation.ts`**, **`src/shared/subnet.ts`**, **`src/shared/deviceSaveValidation.ts`** — small validation helpers.
- **`src/renderer/design-tokens.css`** — token set (with product-specific color choices).
- **`src/main/services/networkDetection.ts`** concepts (canonical network id) — **logic reusable**, API may need rewrite for testability.
- **Post-delete focus helpers:** `src/renderer/utils/postDeleteFocusRecovery.ts`, `ensureTextFieldFocus.ts` — desktop UX edge cases.

## Reusable with review

- **`equipmentMutationService.ts`** — excellent reference for multi-source merges; tie to SQLite schema must be re-evaluated.
- **`deviceRepository.ts`** mapping functions — reuse patterns, not necessarily SQL verbatim.
- **Map geometry helpers:** `mapLayoutGeometry.ts`, `mapViewport.ts`, `mapMarquee.ts` — math may port; integration assumptions may not.
- **Domain equipment folder:** `src/domain/equipment/*` — types and projection direction useful; **legacy bridges** (`legacyDeviceFieldDefinitions.ts`, etc.) need careful pruning.

## Reference only (judgment)

- **`MapView.tsx` as a whole** — behavior reference, not import-and-go module.
- **`App.tsx` state** for extra columns — demonstrates UX idea without persistence discipline.
- **`TEST-TODO.md`** — manual QA script, not automation.

## Carry-forward notes

- Prefer extracting **small shared modules** from this repo over copying large components wholesale.
