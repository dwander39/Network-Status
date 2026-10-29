import { resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * Electron window/navigation/IPC hardening. Kept free of runtime `electron` imports (structural types
 * only) so the policies are unit-testable; `main/index.ts` wires them to the real objects.
 *
 * Model: the renderer is local-only. The only trusted document is the app's own `renderer/index.html`
 * (any hash, e.g. `#map-window`), or — in an unpackaged dev run only — the localhost Vite dev server.
 */
export type TrustedRenderer = { kind: 'file'; indexPath: string } | { kind: 'dev'; origin: string }

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Dev-server URL from electron-vite's env vars, honoured ONLY in an unpackaged run and only for a
 * localhost http origin. A packaged app never loads a URL taken from the environment (otherwise anyone
 * able to set an env var could load a remote page with the privileged preload bridge).
 */
export function resolveDevRendererUrl(
  env: Record<string, string | undefined>,
  isPackaged: boolean
): string | undefined {
  if (isPackaged) return undefined
  const raw = env['ELECTRON_RENDERER_URL'] || env['VITE_DEV_SERVER_URL']
  if (!raw) return undefined
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return undefined
  }
  if (u.protocol !== 'http:' || !LOCAL_DEV_HOSTS.has(u.hostname)) return undefined
  return raw
}

export function isTrustedRendererUrl(
  url: string,
  trusted: TrustedRenderer,
  platform: NodeJS.Platform = process.platform
): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (trusted.kind === 'dev') return u.origin === new URL(trusted.origin).origin
  if (u.protocol !== 'file:' || (u.host !== '' && u.host !== 'localhost')) return false
  let path: string
  try {
    path = resolve(fileURLToPath(u))
  } catch {
    return false
  }
  const expected = resolve(trusted.indexPath)
  return platform === 'win32' ? path.toLowerCase() === expected.toLowerCase() : path === expected
}

/** BrowserWindow `webPreferences` used for every app window. */
export function secureWebPreferences(preloadPath: string) {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false
  } as const
}

interface PreventableEvent {
  preventDefault(): void
}
interface NavigationEvent extends PreventableEvent {
  url?: string
}

/** Structural subset of Electron's `WebContents` used by {@link hardenWebContents}. */
export interface HardenableWebContents {
  on(event: 'will-navigate' | 'will-redirect' | 'will-frame-navigate', listener: (e: NavigationEvent) => void): unknown
  on(event: 'will-attach-webview', listener: (e: PreventableEvent) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
}

/**
 * Applied to every WebContents (via `app.on('web-contents-created')`):
 * - navigation of any frame to anything but the trusted renderer is cancelled (no external links are
 *   opened either: the app has no workflow that needs them);
 * - `window.open` / `target=_blank` never creates a window (the Map pop-out is created by the main
 *   process through IPC, not by the renderer);
 * - `<webview>` attachment is refused.
 */
export function hardenWebContents(contents: HardenableWebContents, isTrusted: (url: string) => boolean): void {
  const guard = (e: NavigationEvent): void => {
    if (!e.url || !isTrusted(e.url)) e.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-frame-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/** Rejects IPC that does not come from a frame showing the trusted renderer document. */
export function assertTrustedIpcSender(
  event: { senderFrame?: { url: string } | null },
  isTrusted: (url: string) => boolean
): void {
  const url = event.senderFrame?.url
  if (!url || !isTrusted(url)) throw new Error('Rejected IPC from an untrusted sender')
}
