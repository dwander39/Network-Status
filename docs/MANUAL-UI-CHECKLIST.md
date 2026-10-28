# Manual UI verification checklist

For the user (manual verifier). Each step lists the expected result. Record **PASS / FAIL / NOTE**
per step. Automated tests do not cover any of this. Run on the machine you actually use, against
a real LAN.

## 0. Launch

1. `npm install` (first time only), then `npm run dev`.
2. **Expected:** one window titled **System Status** opens. A tray icon appears (a small placeholder square).
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

1. `npm run build`, then install or run `release/win-unpacked/System Status.exe`.
2. Repeat sections 0–2 briefly. **Expected:** same behavior. The DB lives in `%APPDATA%\system-status\`.
