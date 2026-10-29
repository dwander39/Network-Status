# Manual UI verification checklist

For the user (manual verifier). Each step lists the expected result. Record **PASS / FAIL / NOTE**
per step in the results table at the end. Run on the machine you actually use, against a real LAN,
but always with **isolated test data** as described below.

## Current status (2026-10-28)

| Item | Status |
|---|---|
| B1–B6 corrections | **Independently verified** (Codex `PHASE0_B6_REVERIFY_READY_FOR_MANUAL_UI`, accepted by the orchestrator; see `PHASE0-REVERIFICATION-RECORD.md`) |
| Isolated manual UI verification (sections 1–14) | **Authorized now** |
| Manual UI PASS | **Not recorded.** Only the user can declare it |
| Real-data migration (section 16) | **Still restricted**: verified backup plus your explicit decision, and not part of this run |
| Installed-app upgrade over System Status (section 15.3) | **Untested**. Not part of this run; disposable VM or test machine only |
| Phase 0 | **Not final-locked**; Phase 1 not authorized |

**History (kept for the record).** On 2026-10-28 the first independent verification marked this
checklist **NOT READY**: Codex reproduced a mixed-snapshot migration defect and monitoring regressions
(B1–B5, `PHASE0-CODEX-VERIFICATION.md`). Isolated copies were allowed for diagnosis only while the
corrections were made and re-verified, and B6 (Electron runtime, dependency advisories, renderer/IPC
hardening) was added as a further gate. Codex has since verified B1–B6, and the orchestrator lifted
the hold for **isolated** manual verification only.

**Automated vs manual.** `npm run verify` (155 tests) and `npm run smoke:isolated` (28 checks:
startup, CSP, navigation guards, bridge surface, pop-out, synthetic migration, restart) are
automated and were already run by the builder and by Codex. They do **not** replace this checklist.
Manual acceptance covers what automation cannot judge: visual correctness, interaction, real
network behavior, tray, OS notifications and single-instance behavior.

## Safety rules (read first)

- The data location is controlled only by the environment variable **`NETWORK_STATUS_APP_DATA_ROOT`**
  (`src/main/appIdentity.ts`). If it is missing, empty or whitespace, the app uses your **real**
  `%APPDATA%`, and the first start copies `%APPDATA%\system-status\` into `%APPDATA%\network-status\`.
- Launch the app **only** through `Start-NsApp` (section 0.6). It refuses to start unless the
  override points at an existing folder under `%TEMP%`.
- The variable only exists in the PowerShell window where you set it. Do every step in **one** window.
  A new window, Explorer, the Start menu or a desktop shortcut would use your real data.
- Never use your live `%APPDATA%\system-status\` files as a test fixture. Fixtures are copied from
  the backup made in 0.4.
- Do not run `npm run dev` for acceptance. It loads the dev server with a relaxed development CSP.
  This checklist uses the production bundle, which is what ships.

## 0. Preparation (PowerShell)

### 0.1 Confirm the project directory

```powershell
Set-Location 'C:\Projects\System Status'
git rev-parse --show-toplevel        # expected: C:/Projects/System Status
git remote get-url origin            # expected: https://github.com/dwander39/Network-Status.git
(Get-Content package.json -Raw | ConvertFrom-Json).name    # expected: network-status
git status --short                   # expected: nothing (clean tree)
```

### 0.2 Check Node and npm

```powershell
node -v    # expected: v22.12.0 or newer (verified with v22.23.1)
npm -v     # expected: 10.x or 11.x (verified with 10.9.8)
```

### 0.3 Setup and build

Run setup on a fresh clone, or after `package.json` / `package-lock.json` change. It needs no Python
or C++ toolchain. Then build the production bundle:

```powershell
if (-not (Test-Path '.\node_modules\electron\dist\electron.exe')) { npm run setup }
npm run build:vite     # expected: ends with "built in …" for main, preload and renderer
```

Optional automated pre-check (opens and closes a window twice by itself):

```powershell
npm run smoke:isolated     # expected: 28/28 checks passed
```

### 0.4 Quit old instances, back up, and record the real-data baseline

1. Quit System Status and Network Status completely (tray icon → **Quit**). Then:
   ```powershell
   Get-Process | Where-Object { $_.ProcessName -match '^(electron|System Status|Network Status)$' }
   ```
   **Expected:** prints nothing.
2. Optional: before quitting System Status, take screenshots of the device list, Settings, saved
   networks, alert rules, event log and map, for comparison in section 13.
3. Make a backup you **never** test with, and confirm it matches:
   ```powershell
   $backup = "$env:USERPROFILE\Desktop\system-status-backup-$(Get-Date -Format yyyyMMdd-HHmm)"
   Copy-Item -Recurse "$env:APPDATA\system-status" $backup
   Compare-Object (Get-FileHash "$env:APPDATA\system-status\system-status.db*" | Select-Object Hash) (Get-FileHash "$backup\system-status.db*" | Select-Object Hash) -Property Hash
   ```
   **Expected:** `Compare-Object` prints nothing. Keep `$backup` set in this window; fixtures in
   section 13 are copied from it.
4. Record the state of the real data folders, so you can prove at the end that nothing touched them:
   ```powershell
   function Get-NsRealDataState {
     foreach ($d in "$env:APPDATA\system-status", "$env:APPDATA\network-status", "$env:APPDATA\Network Status") {
       if (Test-Path -LiteralPath $d) {
         Get-ChildItem -LiteralPath $d -Recurse -File | Select-Object FullName, Length, LastWriteTimeUtc
       } else {
         [pscustomobject]@{ FullName = $d; Length = 'absent'; LastWriteTimeUtc = '' }
       }
     }
   }
   $realBefore = Get-NsRealDataState
   "{0} entries recorded" -f @($realBefore).Count
   $realBefore | Where-Object Length -eq 'absent' | Select-Object FullName
   ```
   **Expected:** `%APPDATA%\network-status` and `%APPDATA%\Network Status` show `absent`, unless you
   have run Network Status against real data before (then note it).

### 0.5 Helper functions (paste once into the same window)

```powershell
function New-NsTestRoot([string]$Name) {
  if ($Name -notmatch '^ns-[a-z0-9-]+$') { throw 'Use a scenario name such as ns-main' }
  $root = Join-Path $env:TEMP ("$Name-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root | Out-Null
  $env:NETWORK_STATUS_APP_DATA_ROOT = $root
  return $root
}

function Assert-NsIsolated {
  $root = $env:NETWORK_STATUS_APP_DATA_ROOT
  if ([string]::IsNullOrWhiteSpace($root)) { throw 'STOP: NETWORK_STATUS_APP_DATA_ROOT is not set; the app would use your real %APPDATA%.' }
  $full = [System.IO.Path]::GetFullPath($root)
  $temp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
  if (-not $full.StartsWith($temp + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw "STOP: $full is not under $temp" }
  if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "STOP: $full does not exist" }
  # VS Code terminals can set this; it would start Electron as plain Node.
  Remove-Item Env:ELECTRON_RUN_AS_NODE, Env:ELECTRON_RENDERER_URL, Env:VITE_DEV_SERVER_URL -ErrorAction SilentlyContinue
  Write-Host "OK: isolated data root  $full" -ForegroundColor Green
  Write-Host "    app data goes to    $full\network-status"
}

function Start-NsApp {
  Assert-NsIsolated
  Start-Process -FilePath (Resolve-Path '.\node_modules\electron\dist\electron.exe') -ArgumentList '.' -WorkingDirectory (Get-Location)
}
```

`Start-NsApp` runs the production bundle in `out/` with the project's Electron 44 binary, the same way
the automated smoke does.

### 0.6 Create the main test root and confirm the override before launch

```powershell
$r = New-NsTestRoot 'ns-main'
Assert-NsIsolated
$env:NETWORK_STATUS_APP_DATA_ROOT     # must print the same folder as $r
```

**Expected:** a green `OK: isolated data root …` line under `%TEMP%`. If you see `STOP`, do not launch.

### 0.7 Start the application

```powershell
Start-NsApp
```

**Expected:** within a few seconds, one window titled **Network Status** opens, and a tray icon (a
small placeholder square) appears. Then confirm the data really went to the test root:

```powershell
Get-ChildItem $r                       # expected: network-status (and no system-status)
Test-Path "$r\network-status\network-status.db"      # expected: True
Test-Path "$env:APPDATA\network-status"              # expected: False (unless it already existed in 0.4)
```

If `network-status.db` is missing from `$r`, quit from the tray immediately and record FAIL.

## 1. Branding

1. The main window title is **Network Status**.
2. The tray tooltip reads **Network Status — all online** or **Network Status — N offline**.
3. No visible "System Status" text appears anywhere in the UI (menus, dialogs, Settings).
4. Notifications (section 3) and any error dialog (section 13.4) say **Network Status**.

## 2. Main and pop-out windows

1. The List view renders. Switch between the **List view**, **Network** and **Map** tabs.
2. **Map** tab → **Open Map View Window**. **Expected:** a second window opens. Its title is
   **Network Status** (the page title replaces the "Map View" option); if it shows "Map View",
   record a NOTE.
3. Selecting a device in one window highlights it in the other.
4. Close the pop-out. The main window keeps working.

## 3. Tray, notifications and single instance

1. Close the main window with **X**. **Expected:** the app keeps running in the tray, and the
   tooltip shows the online/offline summary.
2. Tray **Show** restores the window.
3. Single instance, in the **same** PowerShell window (a different window would point at your real
   data):
   ```powershell
   Start-NsApp
   ```
   **Expected:** no second app window and no second tray icon. The existing window is focused instead.
4. Notifications: with **Notify on offline** on and an adapter selected (section 5), make an online
   device unreachable (unplug it, or change its IP to an unused address). **Expected:** an OS
   notification "Device offline", plus an event log entry. Windows notification permission may be
   needed. Renderer web permissions are all denied by design; notifications come from the main
   process and must still appear.
5. Tray **Quit** exits. `Get-Process electron -ErrorAction SilentlyContinue` prints nothing afterwards.
   Then run `Start-NsApp` again to continue.

## 4. Device create, edit, delete and persistence

1. **List view** → **Add device**. A new row appears with a placeholder `203.0.113.x` IP and the
   Name cell in edit mode. Type a name and press Enter.
2. Click the **IP** cell (a single click starts inline editing) and enter a reachable LAN address
   (e.g. your router). **Expected:** saved; status becomes `online` after the next ping, and
   **Last checked** updates.
3. Enter an invalid IP (e.g. `300.1.1.1`). **Expected:** an error alert, and the value is not saved.
4. Enter an IP already used by another device. **Expected:** "Another device already uses this IP".
5. **Add Multiple…** creates several rows.
6. Use the **Filter** (All / Online / Offline), and click the Name, Status and Last checked headers
   to sort.
7. Selection: click, Ctrl+click, Shift+click, and click-drag across rows (drag with Ctrl adds, Alt
   subtracts). **Expected:** the row highlight follows.
8. Delete a device. **Expected:** a confirm dialog appears, then the row is removed.
9. Tray **Quit**, then `Start-NsApp`. **Expected:** devices, names and IPs persist.

**Known limitations (not regressions):** the Search box and toolbar **Sort** button do nothing.
Extra columns (**Columns… → Add Column**) and column widths/visibility are lost on restart.
Group-by can show the same group header more than once.

## 5. Adapter selection, monitoring and discovery

1. In a fresh root no adapter is selected. A yellow banner reads **"Monitoring is paused because no
   network adapters are selected…"** and devices show **offline**. *This is intended.*
2. **Settings** (menu **Settings → Open Settings…** or **Ctrl+,**) → **General** → **Network
   adapters**: tick your active adapter (Wi-Fi or Ethernet).
3. **Expected:** the banner disappears. Within about one ping interval (default 5 s), devices on that
   adapter's subnet change to `online`/`offline`.
4. **Network** tab. **Discovered** lists hosts from the OS ARP cache that are not saved devices (it
   may be short on a quiet network; this is the ARP cache, not a full scan).
5. **Refresh** updates the list. **Add to list** opens the add-device form prefilled. **Dismiss**
   hides a host, and clearing dismissed hosts brings it back.
6. **MAC address change** (only if you can swap the hardware behind an IP; otherwise record "not
   exercised"): the change is reported after it has been seen on two ARP scans, as a
   `MAC_ADDRESS_CHANGED` event. Until the second scan the Discovered list keeps showing the old MAC.
   If the original hardware comes back before confirmation, **no** event appears.

## 6. Settings save and event logging

1. **Event log** (Network tab) shows online/offline/discovered/network events as they happen. Try
   the network, type and severity filters. Export **CSV** and **JSON** (a save dialog appears; open
   the file to check it), then clear with confirmation.
2. **Settings → Rules:** create a rule (e.g. *offline*, scope *device*), trigger it, and confirm the
   alert notification/event. Edit, disable and delete the rule.
3. **Settings save keeps event logging (Codex B5):** change the ping interval (or tick/untick an
   adapter) and save. Then make a device go offline as in 3.4. **Expected:** the event log still
   records the offline/online events, with no duplicates (one entry per transition).
4. Tray **Quit**, `Start-NsApp`. **Expected:** the changed ping interval and adapter selection persist.

## 7. Network profiles

1. On a LAN the app has not seen before (a fresh root counts), a **New network detected** prompt
   appears. **Save** it with a name.
2. **Settings → Networks:** rename and delete a saved network.
3. If possible, switch to another network (e.g. a phone hotspot). **Expected:** after about 30–40 s
   the device list switches to that network's devices.

## 8. Map view

1. **Map** tab. **Expected:** a gateway node plus device cards.
2. Switch the layout between manual and the auto modes (vendor / device type / subnet).
   **Expected:** auto modes group cards into labeled frames, with "Unknown …" frames last.
3. Manual mode: drag cards. **Ctrl+Z / Ctrl+Y** undo and redo moves.
4. **+ New group:** create, rename, resize, drag a device into it, lock it (locked contents can't be
   dragged), and delete it.
5. In manual layout, left-drag on empty canvas to draw a selection marquee (Shift adds to the
   selection). Pan with **Space+drag** or the middle mouse button. Try Fit all / Center selection / Zoom.
6. Select a device and edit it in the **inspector**. **Expected:** the change also appears in List view.
7. **Add Device** (map toolbar POC): create two "Lighting Fixture" devices.

**Known limitations (not regressions):** **Trace mode…** drafts are session-only and disappear on
reload, and a saved trace cannot be deleted. Right-clicking a device shows a disabled
"Device actions (coming soon)". Alert/event updates don't reach the pop-out window. The Map view shows
two "Add device" buttons.

## 9. Restart persistence

Tray **Quit**, confirm no `electron` process is left, then `Start-NsApp`. **Expected:**

1. Devices, settings, adapter selection, saved networks, alert rules and event log entries are unchanged.
2. Map card positions and manual groups are where you left them.
3. Create one more "Lighting Fixture". **Expected:** numbering continues (e.g. "Lighting Fixture 3"),
   not "Lighting Fixture 1".

## 10. Security-sensitive behavior (safe checks)

Use the running isolated app. Nothing here touches the network beyond a blocked attempt.

1. Open DevTools: **View → Toggle Developer Tools** (Ctrl+Shift+I) → **Console**.
2. `Object.keys(window.ssApi).length` prints a number, and `typeof require` prints `"undefined"`.
   **Expected:** the bridge exists, and Node is not exposed.
3. `window.open('https://example.com')` → **Expected:** returns `null`, and no window opens.
4. `location.href = 'https://example.com'` → **Expected:** the app stays on its own page; no web page
   loads.
5. Do **not** judge the CSP with `eval(...)` in the Console: DevTools evaluations bypass the page's
   eval restriction by design. The CSP is checked by `npm run smoke:isolated` (0.3). In the Console,
   **Expected:** no red "Content Security Policy" errors while you use the List, Network and Map views.
6. Close DevTools.

## 11. Close the application and check the results

1. Tray **Quit**. Then:
   ```powershell
   Get-Process | Where-Object { $_.ProcessName -match '^(electron|Network Status)$' }   # expected: nothing
   Get-ChildItem "$r\network-status" | Select-Object Name, Length                        # your test data
   Compare-Object $realBefore (Get-NsRealDataState) -Property FullName, Length, LastWriteTimeUtc
   ```
   **Expected:** the last command prints **nothing**: your real data folders are exactly as recorded
   in 0.4. If it prints anything, record FAIL and keep everything as it is for diagnosis.

## 12. Fresh-installation behavior

1. `$r = New-NsTestRoot 'ns-fresh'`, then `Assert-NsIsolated` and `Start-NsApp`.
2. **Expected:** the app starts normally. `Get-ChildItem $r` shows only `network-status`, with **no**
   `system-status` folder. `$r\network-status\network-status.db` exists, and there is no
   `legacy-migration.json`.
3. Add a device, quit from the tray, and `Start-NsApp` again. **Expected:** it persisted.

## 13. Legacy migration from an isolated copy

Every scenario uses its own root and a copy **from the backup** (`$backup`, 0.4), never from
`%APPDATA%`. If you opened a new window, set `$backup` again to your backup folder first.

### 13.1 Migration

```powershell
$r = New-NsTestRoot 'ns-legacy'
New-Item -ItemType Directory "$r\system-status" | Out-Null
Copy-Item "$backup\system-status.db*" "$r\system-status\"
Get-FileHash "$r\system-status\*" | Where-Object { $_.Path -notlike '*-shm' } | Select-Object Hash, Path | Export-Csv "$r\legacy-hashes-before.csv"
Assert-NsIsolated
Start-NsApp
```

The `-wal` file must be included in the copy (the `*` does this). Your data keeps most of its rows in it.

1. **Expected:** the app opens normally with your data.
2. Compare with your screenshots: devices (names, IPs, groups), Settings (intervals, selected adapters,
   cache mode), saved networks, alert rules, event log entries, and map positions/manual groups are
   all present.
3. `Get-Content "$r\network-status\legacy-migration.json"`. **Expected:** `tableRowCounts` lists your
   tables with plausible counts (e.g. `devices` equals your device count).
4. Known, expected: panel collapse states and the map inspector width are back to their defaults.

### 13.2 Restart without re-migration

1. Note `(Get-Item "$r\network-status\legacy-migration.json").LastWriteTime`. Quit, then `Start-NsApp`.
   **Expected:** the data is still there, and the `LastWriteTime` is unchanged.
2. Rename a device, quit, and `Start-NsApp`. **Expected:** the change is kept, not reverted to the
   legacy value.

### 13.3 Legacy copy untouched

Quit the app, then:

```powershell
Compare-Object (Import-Csv "$r\legacy-hashes-before.csv") (Get-FileHash "$r\system-status\*" | Where-Object { $_.Path -notlike '*-shm' } | Select-Object Hash, Path) -Property Hash, Path
```

**Expected:** prints nothing. The migration reads through a read-only SQLite connection, so SQLite may
create or rewrite `system-status.db-shm` (excluded here). If the copy had no `-wal`, an **empty**
`system-status.db-wal` may appear, and `Compare-Object` then lists only that file. No other file may
change or appear.

### 13.4 Error and recovery

Each case starts from a fresh root. **Expected in every case:** an error dialog titled **Network
Status could not load its data** with a readable explanation; the app exits, with no window and no
tray icon; and `$r\network-status\network-status.db` does **not** exist.

1. **Legacy app running** (simulated with a lock file):
   ```powershell
   $r = New-NsTestRoot 'ns-inuse'; New-Item -ItemType Directory "$r\system-status" | Out-Null
   Copy-Item "$backup\system-status.db*" "$r\system-status\"
   $lock = [System.IO.File]::Open("$r\system-status\lockfile", 'OpenOrCreate', 'Write', 'Read')
   Start-NsApp
   ```
   **Expected:** the message says System Status appears to be running. Then run `$lock.Close()` and
   `Start-NsApp` again. **Expected:** the migration now succeeds.
2. **Corrupt legacy file:**
   ```powershell
   $r = New-NsTestRoot 'ns-corrupt'; New-Item -ItemType Directory "$r\system-status" | Out-Null
   Set-Content "$r\system-status\system-status.db" "not a database"
   Start-NsApp
   ```
   **Expected:** the message says the file could not be read as a valid database, and the file
   content is unchanged (`Get-Content "$r\system-status\system-status.db"`).
3. **Migrated database missing:** run the 13.1 commands with `'ns-missing'` in place of `'ns-legacy'`, quit, then
   `Remove-Item "$r\network-status\network-status.db*"` and `Start-NsApp`. **Expected:** the message
   says the data was migrated earlier but the database file is missing, and explains how to re-import.
   Follow it: delete `legacy-migration.json` and start again. **Expected:** the data is re-imported
   from the legacy copy. This deliberately discards changes made after migration in the isolated
   fixture. Never use this procedure on real data; restore from backup instead.

### 13.5 Existing functionality on migrated data

Switch back to the `ns-legacy` root from 13.1:

```powershell
$r = (Get-ChildItem $env:TEMP -Directory -Filter 'ns-legacy-*' | Select-Object -First 1).FullName
$env:NETWORK_STATUS_APP_DATA_ROOT = $r
Assert-NsIsolated
Start-NsApp
```

Briefly repeat sections 4–8. **Expected:** the same results as with fresh data.

Finish with section 11 again: the real data must still be unchanged.

## 14. Clean-up

Delete the test roots when you are done. They contain only copies:

```powershell
Get-ChildItem $env:TEMP -Directory -Filter 'ns-*' | Select-Object FullName
Get-ChildItem $env:TEMP -Directory -Filter 'ns-*' | Remove-Item -Recurse -Force -Confirm:$false
Remove-Item Env:NETWORK_STATUS_APP_DATA_ROOT
```

Keep the Desktop backup.

## 15. Packaged build (optional)

1. `npm run build`. **Expected artifacts:** `release/Network Status Setup 1.0.0.exe` and
   `release/win-unpacked/Network Status.exe` (any older `System Status*` files in `release/` predate
   the rename). The installer and exe are **unsigned**, so Windows may show an unknown-publisher or
   SmartScreen warning.
2. Packaged exe against an isolated root, in the same window:
   ```powershell
   $r = New-NsTestRoot 'ns-packaged'
   Assert-NsIsolated
   Start-Process -FilePath (Resolve-Path '.\release\win-unpacked\Network Status.exe')
   ```
   Repeat sections 1–4 briefly. **Expected:** the same behavior. The window, tray and taskbar show
   **Network Status**. Finish with section 11, using the process name `Network Status`.
3. **Installer upgrade: untested, not part of this run.** Only on a disposable VM or test machine:
   install an older System Status build, then run `Network Status Setup 1.0.0.exe`. **Expected:** no
   second "System Status" entry in *Apps & features*; the Start-menu and desktop shortcuts are renamed
   to **Network Status**; the app keeps its data (it migrates, as in 13.1). An installed app always
   uses the real `%APPDATA%` of that machine.

## 16. Real-data migration (restricted; not part of this run)

Only after sections 1–13 pass, with the verified backup from 0.4, and only on your explicit decision.
The orchestrator has not scheduled this step.

1. Quit everything. In a **new** PowerShell window (no override set), start the app normally.
2. **Expected:** your real data appears under the new name. `%APPDATA%\network-status\` now exists.
   In `%APPDATA%\system-status\`, `system-status.db` and its `-wal` are unchanged and kept as a
   recovery source. Only SQLite's `-shm` index may have been rewritten.
3. If anything is wrong: quit, then move `%APPDATA%\network-status\network-status.db*` and
   `legacy-migration.json` out of that folder (do not delete them; keep them for diagnosis). The next
   start migrates again from the legacy database.

## Results

| Section | PASS / FAIL / NOTE | Notes |
|---|---|---|
| 0 Preparation | | |
| 1 Branding | | |
| 2 Main and pop-out windows | | |
| 3 Tray, notifications, single instance | | |
| 4 Device CRUD and persistence | | |
| 5 Adapters, monitoring, discovery | | |
| 6 Settings save and event logging | | |
| 7 Network profiles | | |
| 8 Map view | | |
| 9 Restart persistence | | |
| 10 Security-sensitive behavior | | |
| 11 Real data unchanged | | |
| 12 Fresh installation | | |
| 13 Legacy migration (isolated copy) | | |
| 15 Packaged build (optional) | | |

Only you can declare manual UI PASS. Report the results to the orchestrator.
