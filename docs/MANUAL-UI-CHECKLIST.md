# Manual UI verification checklist

For the user (manual verifier). Each step lists the expected result. Record **PASS / FAIL / NOTE**
per step. Automated tests do not cover any of this. Run on the machine you actually use, against
a real LAN.

> **Phase 0B: protect your data first.** From Phase 0B on, the first normal start (`npm run dev`,
> `electron .` or the packaged exe without the override below) copies your real
> `%APPDATA%\system-status\` data into `%APPDATA%\network-status\`. The copy only reads the old
> folder, but do it deliberately:
> 1. Do **section 9** first. It uses isolated copies only.
> 2. Run sections 0–8 in an isolated root too, by setting `NETWORK_STATUS_APP_DATA_ROOT` as in 9.0.
> 3. Only run against real data for the final step (9.6), after making the backup in 9.0.

## 0. Launch

1. `npm install` (first time only). Set up an isolated root (section 9.0), then `npm run dev` from
   that same PowerShell window.
2. **Expected:** one window titled **Network Status** opens. A tray icon appears (a small placeholder square).
3. Optional: press **F12** and check the Console has no red errors. In the Console, `window.ssApi`
   should print an object.

## 1. First-run / adapters

1. If no adapter has been chosen yet, a yellow banner reads **"Monitoring is paused because no
   network adapters are selected…"** and devices show **offline**. *This is intended.*
2. Open **Settings** (menu **Settings → Open Settings…** or **Ctrl+,**) → **General** →
   **Network adapters**, and tick your active adapter (Wi-Fi or Ethernet).
3. **Expected:** the banner disappears. Within roughly one ping interval (default 5 s), devices on
   that adapter's subnet change from `offline`/`unknown` to `online`/`offline`.

## 2. List view: devices

1. **List view** tab → **Add device**. A new row appears with a placeholder `203.0.113.x` IP and the
   Name cell in edit mode. Type a name and press Enter.
2. Click the **IP** cell (a single click starts inline editing) and enter a reachable LAN address (e.g. your router).
   **Expected:** saved; status becomes `online` after the next ping, and **Last checked** updates.
3. Enter an invalid IP (e.g. `300.1.1.1`). **Expected:** an error alert, and the value is not saved.
4. Enter an IP already used by another device. **Expected:** "Another device already uses this IP".
5. **Add Multiple…** creates several rows.
6. Use the **Filter** (All / Online / Offline) and click the Name, Status and Last checked headers to sort.
7. Selection: click, Ctrl+click, Shift+click, and click-drag across rows (drag with Ctrl adds,
   Alt subtracts). **Expected:** row highlight follows.
8. Delete a device. **Expected:** a confirm dialog appears, then the row is removed.
9. Close and relaunch the app. **Expected:** devices, names and IPs persist.

**Known limitations (not regressions):** the Search box and toolbar **Sort** button do nothing.
Extra columns (**Columns… → Add Column**) and column widths/visibility are lost on restart.
Group-by can show the same group header more than once.

## 3. Network view: discovery and events

1. **Network** tab. **Discovered** lists hosts from the OS ARP cache that aren't saved devices
   (it may be short on a quiet network; this is the ARP cache, not a full scan).
2. **Refresh** updates the list. **Add to list** opens the add-device form prefilled.
   **Dismiss** hides a host, and clearing dismissed hosts brings it back.
3. **Event log** shows online/offline/discovered/network events as they happen. Try the network,
   type and severity filters, export **CSV** and **JSON** (a save dialog appears and the file
   opens in a spreadsheet/editor), and clear with confirmation.

## 4. Notifications and alert rules

1. With **Notify on offline** on, make an online device unreachable (unplug it, or change its IP to
   an unused address). **Expected:** an OS notification "Device offline", plus an event log entry.
   OS notification permission may be required.
2. **Settings → Rules:** create a rule (e.g. *offline*, scope *device*), trigger it, and confirm the
   alert notification/event. Edit, disable and delete the rule.
3. **Newly working in this baseline:** a **MAC address change** for a known IP is now detected
   after it is seen on two ARP scans, producing a `MAC_ADDRESS_CHANGED` event and firing
   MAC-change rules. Verify this if you can swap the hardware behind an IP. Otherwise record
   "not exercised".

## 5. Networks

1. On a LAN the app hasn't seen before, a **New network detected** prompt appears. **Save** it with a name.
2. **Settings → Networks:** rename and delete a saved network.
3. If possible, switch to another network (e.g. a phone hotspot). **Expected:** after about 30–40 s
   the device list switches to that network's devices.

## 6. Map view

1. **Map** tab. **Expected:** a gateway node plus device cards.
2. Switch layout between manual and the auto modes (vendor / device type / subnet).
   **Expected:** auto modes group cards into labeled frames, with "Unknown …" frames last.
3. Manual mode: drag cards, then relaunch. **Expected:** positions persist. **Ctrl+Z / Ctrl+Y**
   undo/redo moves.
4. **+ New group**: create, rename, resize, drag a device into it, lock it (locked contents can't
   be dragged), and delete it.
5. In manual layout, left-drag on empty canvas to draw a selection marquee (Shift adds to the
   selection). Pan with **Space+drag** or the middle mouse button. Try Fit all / Center selection / Zoom.
6. Select a device and edit it in the **inspector**. **Expected:** the change also appears in List view.
7. **Open Map View Window**: a second window opens. Selecting in one window highlights in the other.
8. **Add Device** (map toolbar POC): create two "Lighting Fixture" devices, relaunch, create
   another. **Expected (fixed in this baseline):** numbering continues (e.g. "Lighting Fixture 3"),
   not "Lighting Fixture 1" again.

**Known limitations (not regressions):** **Trace mode…** drafts are session-only and disappear on
reload, and there is no way to delete a saved trace. Right-clicking a device shows a disabled
"Device actions (coming soon)". Alert/event updates don't reach the pop-out window. Map view shows
two "Add device" buttons.

## 7. Tray and lifecycle

1. Close the window with **X**. **Expected:** the app keeps running in the tray, and the tray
   tooltip shows the online/offline summary.
2. Tray **Show** restores the window; tray **Quit** exits.
3. Launch a second copy while one is running. **Expected:** the existing window is focused instead.

## 8. Packaged build (optional)

1. `npm run build`. **Expected artifacts:** `release/Network Status Setup 1.0.0.exe` and
   `release/win-unpacked/Network Status.exe`.
2. In a PowerShell window with an isolated root set (9.0), run `& ".\release\win-unpacked\Network Status.exe"`.
   Repeat sections 0–2 briefly. **Expected:** same behavior. Window, tray and taskbar show **Network Status**.
3. **Installer upgrade (optional, not verified by the builder).** Only on a test machine/VM, or after
   the backup in 9.0: install an older System Status build, then run `Network Status Setup 1.0.0.exe`.
   **Expected:** no second "System Status" entry in *Apps & features*. The Start-menu and desktop
   shortcuts are renamed to **Network Status**, and the app keeps its data (it migrates, as in 9.3).
   The installed app uses the real `%APPDATA%`.

## 9. Phase 0B: rename and legacy data migration

All commands are PowerShell, run from the project folder. Every scenario uses its own folder under
`%TEMP%`. Delete those folders when you are done. They are copies, never your only data.

### 9.0 Backup and isolated root (do this first)

1. Quit System Status / Network Status completely (tray icon → **Quit**). Then confirm nothing is
   left running: `Get-Process | Where-Object { $_.ProcessName -match 'electron|System Status|Network Status' }`
   prints nothing.
2. Optional but recommended: before quitting, take screenshots of the device list, Settings, saved
   networks, alert rules, event log and map, so you can compare later.
3. Make a backup you never use for testing:
   `Copy-Item -Recurse "$env:APPDATA\system-status" "$env:USERPROFILE\Desktop\system-status-backup-$(Get-Date -Format yyyyMMdd-HHmm)"`
4. Helper used below. Paste it into the PowerShell window; it creates an isolated root and points
   the app at it:
   ```powershell
   function Use-TestRoot($name) {
     $r = Join-Path $env:TEMP $name
     Remove-Item -Recurse -Force $r -ErrorAction SilentlyContinue
     New-Item -ItemType Directory $r | Out-Null
     $env:NETWORK_STATUS_APP_DATA_ROOT = $r
     Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
     return $r
   }
   ```
   `ELECTRON_RUN_AS_NODE` is removed because VS Code terminals can set it, which stops Electron starting.

### 9.1 Application identity

While running any scenario below, check:

1. The main window title is **Network Status**.
2. **Open Map View Window**: the pop-out title. *Expected:* **Network Status** (the page title replaces
   the "Map View" window option). If it shows "Map View", record a NOTE.
3. The tray tooltip reads **Network Status — all online** / **Network Status — N offline**.
4. Notifications (section 4) and any error dialog say **Network Status**.
5. No visible "System Status" text appears anywhere in the UI.

### 9.2 Fresh installation

1. `$r = Use-TestRoot 'ns-fresh'`, then `npm run dev`.
2. **Expected:** the app starts with no migration message. `Get-ChildItem $r` shows only
   `network-status`, with **no** `system-status` folder. `$r\network-status\network-status.db`
   exists, and there is no `legacy-migration.json`.
3. Add a device, select an adapter (section 1), and change the ping interval. Quit from the tray,
   then `npm run dev` again. **Expected:** all of it persisted.

### 9.3 Legacy migration (from a copy of your real data)

1. With everything quit (9.0 step 1):
   ```powershell
   $r = Use-TestRoot 'ns-legacy'
   New-Item -ItemType Directory "$r\system-status" | Out-Null
   Copy-Item "$env:APPDATA\system-status\system-status.db*" "$r\system-status\"
   Get-FileHash "$r\system-status\*" | Select-Object Hash, Path | Export-Csv "$r\legacy-hashes-before.csv"
   ```
   The `-wal` file must be included in the copy (the `*` does this). Your live data keeps most of
   its rows in it.
2. `npm run dev`. **Expected:** the terminal prints `[main] migrated System Status data from …`
   and the app opens normally.
3. Compare with your screenshots. **Expected:** devices (names, IPs, groups), Settings (intervals,
   selected adapters, cache mode), saved networks, alert rules, event log entries, and map
   positions/manual groups are all present.
4. `Get-Content "$r\network-status\legacy-migration.json"`. **Expected:** `tableRowCounts` lists your
   tables with plausible counts (e.g. `devices` equals your device count).
5. Quit and start again. **Expected:** no migration message; the data is still there. The
   `LastWriteTime` of `legacy-migration.json` is unchanged.
6. Make a change (rename a device), then quit and restart. **Expected:** the change is kept and
   not reverted to the legacy value.
7. Legacy copy untouched:
   `Compare-Object (Import-Csv "$r\legacy-hashes-before.csv") (Get-FileHash "$r\system-status\*" | Select-Object Hash, Path) -Property Hash, Path`
   prints nothing, which also means no files were added or removed in `$r\system-status`.
8. Known, expected: panel collapse states and the map inspector width are back to defaults.

### 9.4 Error and recovery

Each case starts from a fresh root. **Expected in every case:** an error dialog titled
**Network Status could not load its data** with a readable explanation; the app exits, with no
window and no tray icon; and `$r\network-status\network-status.db` does **not** exist.

1. **Legacy app running** (simulated):
   ```powershell
   $r = Use-TestRoot 'ns-inuse'; New-Item -ItemType Directory "$r\system-status" | Out-Null
   Copy-Item "$env:APPDATA\system-status\system-status.db*" "$r\system-status\"
   $lock = [System.IO.File]::Open("$r\system-status\lockfile", 'OpenOrCreate', 'Write', 'Read')
   npm run dev
   ```
   **Expected:** the message says System Status appears to be running. Then run `$lock.Close()` and
   `npm run dev` again. **Expected:** the migration now succeeds.
2. **Corrupt legacy file:**
   ```powershell
   $r = Use-TestRoot 'ns-corrupt'; New-Item -ItemType Directory "$r\system-status" | Out-Null
   Set-Content "$r\system-status\system-status.db" "not a database"
   npm run dev
   ```
   **Expected:** the message says the file could not be read as a valid database, and the file
   content is unchanged.
3. **Migrated database missing:** finish 9.3, quit, then
   `Remove-Item "$r\network-status\network-status.db*"` and `npm run dev`.
   **Expected:** the message says the data was migrated earlier but the database file is missing,
   and how to re-import. Follow it: delete `legacy-migration.json` and start again. **Expected:**
   the data is re-imported from the legacy copy.

### 9.5 Existing functionality

Using the migrated root from 9.3 (`$env:NETWORK_STATUS_APP_DATA_ROOT` still set in that window),
run through sections 1–7: monitoring, List view, discovery, events, alert rules, networks, Map view
and tray. **Expected:** the same results as before the rename.

### 9.6 Real data (final acceptance, your decision)

Only after 9.0–9.5 pass, with the backup from 9.0 in place:

1. Quit everything. In a **new** PowerShell window (no override set), run `npm run dev`.
2. **Expected:** a migration message; your real data appears under the new name.
   `%APPDATA%\network-status\` now exists, and `%APPDATA%\system-status\` is unchanged and kept as a
   recovery source.
3. If anything is wrong: quit, then move `%APPDATA%\network-status\network-status.db*` and
   `legacy-migration.json` out of that folder (do not delete them; keep them for diagnosis). The
   next start migrates again from the untouched legacy folder.
