# Build, runtime, and tooling review

## Electron / React / TypeScript structure (verified)

- **electron-vite** triptych: `main`, `preload`, `renderer` entries configured in `electron.vite.config.ts`.
- **Output:** `package.json` `"main": "out/main/index.js"` — standard electron-vite build output.
- **TypeScript:** `tsconfig.json` + `tsconfig.node.json`; `build` script runs `tsc --noEmit -p tsconfig.node.json` before vite build.

## Bundler / build tools (verified)

- **Vite 5** with `@vitejs/plugin-react` for renderer.
- **externalizeDepsPlugin** for main/preload dependency handling (electron-vite default pattern).
- **Aliases:** `@shared` → `src/shared` in all three targets.

## Scripts (verified from `package.json`)

| Script | Purpose |
|--------|---------|
| `npm run dev` | `electron-vite dev` |
| `npm run build` | typecheck (node tsconfig) + `electron-vite build` + `electron-builder` |
| `npm run build:vite` | `electron-vite build` only |
| `npm run preview` | `electron-vite preview` |
| `postinstall` | `electron-builder install-app-deps` (native module rebuild) |

## Test tooling (verified)

- **No Jest/Vitest/playwright config** found in extraction pass.
- **`TEST-TODO.md`** at repo root — **manual** checklist for humans, not automated CI — **verified**.

## Runtime setup (verified)

- **Native module:** `better-sqlite3` — `asarUnpack` includes it in `package.json` build block.
- **Single instance lock:** `app.requestSingleInstanceLock()` in main.
- **Tray:** App remains alive when windows closed (`window-all-closed` no quit on Windows behavior implied by comments).

## Shell / platform cleanliness (judgment)

- **Worth carrying forward:** electron-vite separation, `@shared` alias, asar unpack for native deps, single-instance pattern.
- **Watch for rebuild:** `electron-builder` targets (NSIS/DMG) are minimal — fine for internal tool; expand for store signing etc. separately.

## Carry-forward notes

- Add **automated** tests in rebuild; treat current `TEST-TODO.md` as **acceptance inspiration**, not regression safety.
