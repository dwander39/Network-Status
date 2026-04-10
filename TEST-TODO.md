# Essential functions — test one at a time

Do these **in order**. **Do not skip step 1** — if something is wrong, it usually shows up in the console.

Use **`npm run dev`** from the project folder unless you are explicitly testing the **packaged** build.

---

## 1. App shell and DevTools (no features yet)

- [ ] Run: `npm run dev` and wait for the window to appear.
- [ ] Press **F12** or **Ctrl+Shift+I** (Windows) / **Cmd+Option+I** (macOS) to open **Developer Tools**.
- [ ] Open the **Console** tab. Note any **red** errors (copy the text if you need help).

**Pass:** No red errors on load, or you at least see a clear on-screen message if the bridge failed.  
**If you only see a blank/dark screen or endless “Loading…”:** stop here and fix console errors first (often preload path or running `electron` without building).

---

## 2. Preload bridge (`window.ssApi`)

- [ ] In the **Console**, type: `window.ssApi` and press Enter.

**Pass:** You see an **object** (not `undefined`).  
**Fail:** `undefined` → preload did not run; main window `preload` path is wrong or you’re not running the dev/build pipeline correctly.

---

## 3. IPC read — settings and empty device list

- [ ] In the **Console**, run:
  ```js
  window.ssApi.getSettings()
  ```
  You should get a **Promise**; expand it or use:
  ```js
  window.ssApi.getSettings().then(console.log)
  ```

**Pass:** Object with `pingIntervalMs`, `arpIntervalMs`, `notifyOnOffline`, `notifyOnNewDevice`.  
- [ ] Run:
  ```js
  window.ssApi.getDevices().then(console.log)
  ```
**Pass:** An **array** (may be empty `[]`).

---

## 4. Full UI (after IPC works)

- [ ] Close DevTools (optional) and look at the window.

**Pass:** Title area **“Network devices”**, buttons **Add device**, filter dropdown, interval fields, and an empty table message (or rows if you already added devices).  
**Fail:** Stuck on **“Loading…”** forever → main process likely throwing on DB or IPC; check **terminal** where `npm run dev` runs, and Console again.

---

## 5. SQLite — add one device

- [ ] Click **Add device**, enter:
  - Name: `Test`
  - IP: a valid LAN IPv4 you can ping (e.g. your **router** or **127.0.0.1**)
  - Subnet / gateway: valid IPv4 or leave blank if allowed
- [ ] Save.

**Pass:** Row appears in the table; **no** error toast/dialog beyond validation.

---

## 6. Ping / status update

- [ ] Wait **one full ping interval** (default ~5s) or lower the interval in the UI first.

**Pass:** **Status** changes from `unknown` toward `online` or `offline`, and **Last checked** updates.  
**Fail:** Status never changes → firewall blocking ICMP, wrong IP, or ping failing in your environment (check terminal logs if you add logging).

---

## 7. Edit and delete

- [ ] **Edit** the test device (change name), save.
- [ ] **Delete** the device, confirm.

**Pass:** Table updates; device removed after delete.

---

## 8. Tray (not the web UI)

- [ ] Click **X** to close the window (not Quit from tray yet).

**Pass:** App stays running; **tray icon** appears (may be tiny/placeholder).  
- [ ] Right-click tray → **Show** / **Quit** as applicable.

**Pass:** Show brings window back; Quit exits the app.

---

## 9. Notifications (easy to miss)

- [ ] In settings, ensure **Notify on offline** is on.
- [ ] Add a device pointing to an IP that is **online**; wait until status is **online**.
- [ ] Make it **offline** (wrong IP, unplug device, or block ping if you know how).

**Pass:** OS notification when it goes **online → offline** (may require **Windows/macOS notification permissions**).

---

## 10. ARP — discovered devices

- [ ] Enable **Notify on new ARP host** if you want a ping when something new appears.
- [ ] Wait for at least one **ARP refresh** (default tens of seconds).

**Pass:** **Discovered devices** section may list IPs from your ARP cache (can be empty on a quiet network).  
**Note:** This is **ARP cache**, not a full network scan.

---

## 11. Packaged build (optional, separate pass)

- [ ] Run `npm run build`, install/run the output under `release/`.
- [ ] Repeat steps **2–4** only.

**Pass:** Same as dev; DB lives under the app’s **userData** path for that install.

---

## Quick reference: what “pass” looks like

| Step | What you should see |
|------|------------------------|
| 1–2 | `window.ssApi` exists, Console relatively clean |
| 3–4 | Full dashboard, not infinite Loading |
| 5–7 | CRUD works on devices |
| 6 | Status / last checked update over time |
| 8 | Close hides; tray works |
| 9 | Notification on offline transition |
| 10 | Optional rows under Discovered |
