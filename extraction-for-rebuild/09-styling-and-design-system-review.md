# Styling and design system review

## Design token setup (verified)

- **File:** `src/renderer/design-tokens.css`
- **Pattern:** CSS custom properties on `:root` — colors, spacing scale, radii, typography, shadows, z-index, motion, map-specific trace family colors.
- **Documentation:** Header comment states semantic intent (“single source of truth for global visual changes”) and usage rules (prefer tokens over raw hex).

## Theme structure (verified)

- **No separate light theme file** in repo — **dark-oriented** palette tokens only (**verified** by file content).
- **Import chain:** `App.css` begins with `@import './design-tokens.css';` then sets `body` / `:root` font and colors from tokens.

## Reusable CSS (verified)

- `App.css` is large (~2k+ lines) — layout for list page, map flow, banners, tables, modals, map trace overlays, etc.
- Many classnames are **feature-scoped** (e.g. `.list-page__*`, `.map-flow__*`).

## Component styling patterns (verified)

- Mix of **CSS classes** and **inline `CSSProperties`** (e.g. `MAP_EDGE_STYLE` object in `MapView.tsx` for React Flow edge stroke).
- React Flow library stylesheet: `@xyflow/react/dist/style.css` imported from `MapView.tsx`.

## Reusable independent of architecture (judgment)

- **`design-tokens.css`** — portable to another renderer build with minimal coupling.
- **Trace family visual mapping** in `src/shared/mapTraceFamilyVisual.ts` — ties class names to connection types; reusable if same type enum survives.

## Entangled with old implementation (judgment)

- **`App.css` size** — many selectors assume specific DOM structure from `App.tsx` / `DeviceTable` / `MapView`.
- **Inline styles in MapView** for edges — bypasses token discipline where not extracted to variables.

## Carry-forward notes

- Rebuild importing tokens should **grep for raw hex** in TSX (`#5e81ac` in `MapView`) and reconcile with token set.
