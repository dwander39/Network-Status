# System Status — methodical build checklist

Use this list in order. Check items as you complete them. Optional items are grouped at the end.

---

## Phase 0 — Tooling and repo

- [ ] Install Node.js LTS and npm
- [ ] Initialize `package.json` with Electron, React, TypeScript, Vite (`electron-vite`), and build scripts (`dev`, `build`, `build:vite`)
- [ ] Configure TypeScript (`tsconfig.json`, paths for `@shared` if used)
- [ ] Add `.gitignore` (`node_modules`, `out`, `release`, logs)
- [ ] Confirm `npm install` and `npm run dev` launch the shell window

---

## Phase 1 — Project layout and shared contracts

- [ ] Create folder layout: `src/main`, `src/preload`, `src/renderer`, `src/shared`
- [ ] Define shared types (`Device`, `ArpEntry`, `AppSettings`, payloads) in `src/shared`
- [ ] Define IPC channel names in one module (`src/shared/ipc.ts`) and use them everywhere
- [ ] Add IPv4 validation helpers (`src/shared/ipValidation.ts`) and reuse in main + renderer

---

## Phase 2 — SQLite persistence

- [ ] Open DB in `app.getPath('userData')`, enable WAL, create tables on first run
- [ ] **Devices** table: id, name, ip (unique), subnet, gateway, mac_address, last_status, last_checked
- [ ] **arp_entries** table: id, ip (unique), mac_address, vendor, last_seen
- [ ] **settings** table: key/value for ping interval, ARP interval, notification toggles
- [ ] Implement `deviceRepository`: list, get by ip, save, delete, update status after ping
- [ ] Implement `arpRepository`: list all, list discovered (ARP rows with no matching device IP), upsert batch + sync MAC onto devices by IP
- [ ] Implement `settingsRepository`: get/save with sane defaults (e.g. 5s ping, 45s ARP)

---

## Phase 3 — Background services (main process)

- [ ] **Ping service:** ICMP via `ping` package (or OS `ping`), bounded concurrency for 50+ hosts
- [ ] **Ping service:** Return structured results; detect **online → offline** only for notifications (ignore first `unknown`)
- [ ] **ARP service:** Run `arp -a`, parse Windows vs macOS/BSD output into normalized MACs
- [ ] **ARP service:** Document limitation: ARP **cache**, not a full active scan
- [ ] **Optional vendor hints:** small OUI map or external DB/API
- [ ] **Notification service:** offline alert; new unknown IP alert with first-scan baseline (no spam)
- [ ] **Scheduler:** intervals for ping + ARP; restart intervals when settings change; push updates to renderer

---

## Phase 4 — Electron main process integration

- [ ] Create `BrowserWindow` with `preload`, `contextIsolation`, no `nodeIntegration`
- [ ] Register `ipcMain` handlers: devices CRUD, ARP snapshot, settings get/save
- [ ] Emit events to renderer on device/ARP/settings changes
- [ ] **System tray:** minimize to tray on close; menu: Show, Quit; optional tooltip with offline count
- [ ] **Single instance:** second instance focuses existing window
- [ ] **Quit path:** set flag so window `close` hides to tray; real quit from tray/menu runs cleanup

---

## Phase 5 — Preload bridge

- [ ] `contextBridge.exposeInMainWorld` with typed API: invoke handlers + subscribe to push events
- [ ] Add `src/renderer/vite-env.d.ts` (or equivalent) so `window` exposes the API safely

---

## Phase 6 — React UI

- [ ] Load devices and settings on mount; subscribe to main-process pushes
- [ ] Device table: name, IP, MAC, status indicator, last checked
- [ ] Sorting: name, status, last checked
- [ ] Filtering: all / online / offline
- [ ] Add / edit device modal with validation; delete with confirm
- [ ] Settings: ping interval, ARP interval, notification toggles
- [ ] **Discovered devices** section (ARP-known hosts not in saved list)
- [ ] Basic styling consistent with a small dashboard

---

## Phase 7 — Quality and cross-platform

- [ ] Manual test on **Windows**: ping, ARP parse, tray, notifications, DB file location
- [ ] Manual test on **macOS**: same (ARP format differs)
- [ ] Stress: 50+ devices — CPU stays reasonable, no UI freeze (work stays in main)
- [ ] **electron-builder:** `asarUnpack` for `better-sqlite3`; produce installer per OS
- [ ] Replace placeholder tray/app icons with real assets

---

## Phase 8 — Optional enhancements

- [ ] Linux ARP parser if output differs from BSD style
- [ ] Optional `arp-scan` / `nmap` integration behind settings (advanced discovery)
- [ ] Persist “already notified” unknown IPs across restarts (if desired)
- [ ] Unit tests for ARP parsers and IP validation
- [ ] Auto-update (e.g. `electron-updater`) if you ship to users

---

## Quick verification commands

```bash
npm install
npm run dev
npm run build:vite
npm run build
```

After `npm run build`, confirm the app runs from the packaged output and the database still loads from user data.
