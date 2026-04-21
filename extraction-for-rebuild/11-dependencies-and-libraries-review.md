# Dependencies and libraries review

Source: `package.json` (verified versions at extraction time).

## Runtime dependencies (verified)

| Package | Role | Keep / reconsider |
|---------|------|-------------------|
| `@xyflow/react` | Map graph (nodes/edges, interactions) | **Keep** if map remains graph-canvas based; otherwise heavy for simple diagrams. |
| `better-sqlite3` | SQLite in main | **Strong keep** for embedded desktop DB (note native build/asar unpack). |
| `mac-oui-lookup` | Vendor enrichment (used from vendor lookup path) | **Keep** if MAC vendor UX stays; platform-specific naming suggests mac focus — verify Windows behavior expectations. |
| `ping` | ICMP/ping from Node | **Reconsider** if cross-platform packaging painful; architecture ties monitoring to this library shape. |
| `uuid` | Device/group id allocation | Trivial; any id generator works. |

## Dev dependencies (verified)

| Package | Role |
|---------|------|
| `electron`, `electron-vite`, `electron-builder`, `vite` | Core toolchain |
| `react`, `react-dom`, `@vitejs/plugin-react` | UI |
| `typescript`, `@types/*` | Typing |

## Architecture-driving libraries (judgment)

- **React Flow** drives map component decomposition (custom nodes, edges, provider) — switching it implies rewriting most of `MapView.tsx` + overlays.
- **better-sqlite3** drives synchronous repository style and transaction usage patterns.

## Libraries suggesting implementation shape problems (judgment)

- None are “accidentally included”; the **problem** is **concentration** of React Flow complexity in one file, not the library itself.

## Carry-forward notes

- Rebuild should evaluate **map library** early — it dominates renderer complexity and styling integration.
