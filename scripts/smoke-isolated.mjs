// Isolated end-to-end smoke test of the BUILT app (run `npm run build:vite` first).
//
// Launches the real Electron app against a fresh temp data root (NETWORK_STATUS_APP_DATA_ROOT) holding a
// synthetic legacy "System Status" database, and inspects the running renderer over the Chrome DevTools
// Protocol (--remote-debugging-port, only for this run). Never touches the real %APPDATA% data.
//
// Set SMOKE_APP_EXE to a packaged executable to run the same checks against a packaged build.
//
// Checks: branding, preload bridge surface, renderer isolation (no Node globals), production CSP
// enforcement, navigation / window.open refusal, native SQLite + legacy migration, Map pop-out window,
// restart without re-migration, legacy database/WAL unchanged.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const electronBinary = require('electron')
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9300 + Math.floor(Math.random() * 500)

if (!process.env.SMOKE_APP_EXE && !existsSync(join(projectDir, 'out/main/index.js'))) {
  console.error('[smoke] out/ is missing; run `npm run build:vite` first')
  process.exit(1)
}

// --- isolated data root (refuse anything that is not a fresh temp dir) ---
const root = realpathSync(mkdtempSync(join(tmpdir(), 'network-status-smoke-')))
const realAppData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
if (!relative(tmpdir(), root) || relative(tmpdir(), root).startsWith('..') || resolve(root) === resolve(realAppData)) {
  throw new Error(`refusing unsafe smoke root ${root}`)
}
const legacyDir = join(root, 'system-status')
const legacyDb = join(legacyDir, 'system-status.db')
const canonicalDir = join(root, 'network-status')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null)

// --- synthetic legacy fixture: oldest supported schema, rows only in an uncheckpointed WAL ---
function createLegacyFixture() {
  mkdirSync(legacyDir, { recursive: true })
  const w = new Database(legacyDb)
  w.pragma('journal_mode = WAL')
  w.exec(`CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, ip TEXT NOT NULL UNIQUE,
            subnet TEXT NOT NULL DEFAULT '', gateway TEXT NOT NULL DEFAULT '', mac_address TEXT,
            last_status TEXT NOT NULL DEFAULT 'unknown', last_checked TEXT);
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  w.pragma('wal_checkpoint(TRUNCATE)')
  w.pragma('wal_autocheckpoint = 0')
  w.exec(`INSERT INTO devices (id, name, ip, subnet, gateway) VALUES
            ('d1', 'Smoke Router', '192.0.2.1', '255.255.255.0', '192.0.2.1'),
            ('d2', 'Smoke NAS', '192.0.2.20', '255.255.255.0', '192.0.2.1')`)
  w.exec(`INSERT INTO settings (key, value) VALUES ('pingIntervalMs', '7000')`)
  // Left open and idle: committed rows stay only in the WAL, as after a crash of the legacy app.
  return w
}

// --- CDP client ---
async function targets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  } catch {
    return []
  }
}
async function waitForTarget(pred, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const t = (await targets()).find((x) => x.type === 'page' && pred(x))
    if (t) return t
    await sleep(250)
  }
  return null
}
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data))
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const evaluate = async (expression) => {
    // allowUnsafeEvalBlockedByCSP: false => evaluated code is subject to the page's real CSP (DevTools default bypasses it).
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: false })
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? 'exception' }
    return r.result?.result?.value
  }
  return { send, evaluate, close: () => ws.close() }
}

function launch(label) {
  const env = { ...process.env, NETWORK_STATUS_APP_DATA_ROOT: root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.VITE_DEV_SERVER_URL
  // SMOKE_APP_EXE=<path to a packaged Network Status.exe> smoke-tests a packaged build instead of out/.
  const cmd = process.env.SMOKE_APP_EXE ? [process.env.SMOKE_APP_EXE, [`--remote-debugging-port=${PORT}`]] : [electronBinary, [`--remote-debugging-port=${PORT}`, projectDir]]
  const child = spawn(cmd[0], cmd[1], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  console.log(`[smoke] launched (${label}) pid ${child.pid}`)
  return { child, output: () => output }
}
function kill(child) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

const isAppUrl = (u) => u.startsWith('file:') && u.includes('/out/renderer/index.html')

async function run() {
  console.log(`[smoke] data root: ${root}`)
  const writer = createLegacyFixture()
  const fixtureHashes = { db: sha(legacyDb), wal: sha(legacyDb + '-wal') }

  // NOTE: the writer stays open but idle (no commits during the app's snapshot), like a crashed app.
  const first = launch('first start')
  try {
    const page = await waitForTarget((t) => isAppUrl(t.url) && !t.url.includes('#map-window'))
    check('main window renderer loads the bundled file:// document', page, page?.url)
    if (!page) return
    const cdp = await connect(page)
    await sleep(1500)

    check('window title is Network Status', (await cdp.evaluate('document.title')) === 'Network Status')
    const csp = await cdp.evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null`)
    check('production CSP meta present', csp && csp.includes("script-src 'self'") && !csp.includes('unsafe-'), csp)
    check('Node globals not reachable from renderer',
      (await cdp.evaluate('[typeof require, typeof process, typeof module, typeof Buffer].join(",")')) ===
        'undefined,undefined,undefined,undefined')
    const apiKeys = await cdp.evaluate('Object.keys(window.ssApi ?? {})')
    check('preload exposes only the named ssApi bridge',
      Array.isArray(apiKeys) && apiKeys.length > 0 && !apiKeys.some((k) => /ipcRenderer|invoke|send|require/i.test(k)),
      `${apiKeys?.length} methods`)
    check('no raw ipcRenderer on window', (await cdp.evaluate('typeof window.ipcRenderer')) === 'undefined')

    // Native SQLite + migration: the synthetic legacy devices are served by the main process.
    const names = await cdp.evaluate('window.ssApi.getDevices(null).then(d => d.map(x => x.name).sort())')
    check('migrated legacy devices load via native SQLite (Electron main)',
      JSON.stringify(names) === JSON.stringify(['Smoke NAS', 'Smoke Router']), JSON.stringify(names))
    check('migration record written', existsSync(join(canonicalDir, 'legacy-migration.json')))

    // Count CSP violations caused by the app itself (before we provoke any): switch to Map view too.
    await cdp.evaluate(`window.__cspViolations = []; document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI)); true`)
    await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^\\s*map\\b/i.test(x.textContent || '')); if (b) b.click(); return !!b })()`)
    await sleep(1500)
    const mapLoaded = await cdp.evaluate(`!!document.querySelector('.react-flow')`)
    check('Map view (lazy chunk) renders under the production CSP', mapLoaded)
    const ownViolations = await cdp.evaluate('window.__cspViolations')
    check('no CSP violations from the app itself', Array.isArray(ownViolations) && ownViolations.length === 0, JSON.stringify(ownViolations))

    // CSP enforcement against injected content.
    check('CSP blocks eval', (await cdp.evaluate(`(() => { try { eval('1'); return 'allowed' } catch (e) { return e.name } })()`)) === 'EvalError')
    check('CSP blocks injected inline script',
      (await cdp.evaluate(`(() => { const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.appendChild(s); return typeof window.__inl })()`)) === 'undefined')
    check('CSP blocks network requests',
      (await cdp.evaluate(`fetch('https://example.com/').then(() => 'allowed', (e) => e.name)`)) === 'TypeError')

    // Window / navigation restrictions.
    check('window.open is denied', (await cdp.evaluate(`window.open('https://example.com/') === null`)) === true)
    await cdp.evaluate(`location.href = 'https://example.com/'; true`)
    await sleep(1500)
    const stillApp = await cdp.evaluate('location.href')
    check('navigation away from the app is blocked', typeof stillApp === 'string' && isAppUrl(stillApp), stillApp)
    await cdp.evaluate(`location.href = 'file:///C:/Windows/win.ini'; true`)
    await sleep(800)
    const stillApp2 = await cdp.evaluate('location.href')
    check('navigation to another local file is blocked', typeof stillApp2 === 'string' && isAppUrl(stillApp2), stillApp2)

    // Intentional pop-out still works and is equally restricted.
    await cdp.evaluate('window.ssApi.openMapViewWindow().then(() => true)')
    const pop = await waitForTarget((t) => t.url.includes('#map-window'), 10000)
    check('Map pop-out window opens', pop, pop?.url)
    if (pop) {
      const pc = await connect(pop)
      await sleep(1000)
      check('pop-out window title is Network Status', (await pc.evaluate('document.title')) === 'Network Status')
      check('pop-out has the bridge but no Node globals',
        (await pc.evaluate('typeof window.ssApi + "," + typeof require')) === 'object,undefined')
      check('pop-out window.open is denied', (await pc.evaluate(`window.open('https://example.com/') === null`)) === true)
      pc.close()
    }
    cdp.close()
  } finally {
    kill(first.child)
    await sleep(1500)
  }
  check('first start migrated the legacy data', /migrated System Status data/.test(first.output()))

  const recordPath = join(canonicalDir, 'legacy-migration.json')
  const recordHash = sha(recordPath)
  const second = launch('restart')
  try {
    const page = await waitForTarget((t) => isAppUrl(t.url))
    check('restart: main window loads', page)
    if (page) {
      const cdp = await connect(page)
      await sleep(1500)
      const names = await cdp.evaluate('window.ssApi.getDevices(null).then(d => d.map(x => x.name).sort())')
      check('restart: data persisted', JSON.stringify(names) === JSON.stringify(['Smoke NAS', 'Smoke Router']), JSON.stringify(names))
      cdp.close()
    }
  } finally {
    kill(second.child)
    await sleep(1500)
  }
  check('restart: no second migration', !/migrated System Status data/.test(second.output()))
  check('restart: migration record unchanged', sha(recordPath) === recordHash)

  check('legacy database bytes unchanged', sha(legacyDb) === fixtureHashes.db)
  check('legacy WAL bytes unchanged', sha(legacyDb + '-wal') === fixtureHashes.wal)
  writer.close()
  check('canonical data stayed inside the temp root', existsSync(join(canonicalDir, 'network-status.db')))
}

try {
  await run()
} finally {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} checks passed; root ${root}`)
  if (!process.env.SMOKE_KEEP_ROOT) rmSync(root, { recursive: true, force: true })
  process.exitCode = failed.length ? 1 : 0
}
