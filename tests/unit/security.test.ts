import { EventEmitter } from 'node:events'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  assertTrustedIpcSender,
  hardenWebContents,
  isTrustedRendererUrl,
  resolveDevRendererUrl,
  secureWebPreferences,
  type HardenableWebContents,
  type TrustedRenderer
} from '../../src/main/security'
import { buildContentSecurityPolicy } from '../../src/shared/contentSecurityPolicy'

const indexPath = resolve('out', 'renderer', 'index.html')
const fileTrust: TrustedRenderer = { kind: 'file', indexPath }
const indexUrl = pathToFileURL(indexPath).href

describe('resolveDevRendererUrl', () => {
  it('is ignored entirely in a packaged app', () => {
    expect(resolveDevRendererUrl({ ELECTRON_RENDERER_URL: 'http://localhost:5173' }, true)).toBeUndefined()
  })
  it('accepts only a localhost http dev server', () => {
    expect(resolveDevRendererUrl({ ELECTRON_RENDERER_URL: 'http://localhost:5173' }, false)).toBe('http://localhost:5173')
    expect(resolveDevRendererUrl({ VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173/' }, false)).toBe('http://127.0.0.1:5173/')
    expect(resolveDevRendererUrl({ ELECTRON_RENDERER_URL: 'https://evil.example/' }, false)).toBeUndefined()
    expect(resolveDevRendererUrl({ ELECTRON_RENDERER_URL: 'http://192.168.1.5:5173' }, false)).toBeUndefined()
    expect(resolveDevRendererUrl({ ELECTRON_RENDERER_URL: 'file:///C:/x.html' }, false)).toBeUndefined()
    expect(resolveDevRendererUrl({ ELECTRON_RENDERER_URL: 'not a url' }, false)).toBeUndefined()
    expect(resolveDevRendererUrl({}, false)).toBeUndefined()
  })
})

describe('isTrustedRendererUrl', () => {
  it('trusts the app renderer document, including the pop-out hash', () => {
    expect(isTrustedRendererUrl(indexUrl, fileTrust)).toBe(true)
    expect(isTrustedRendererUrl(`${indexUrl}#map-window`, fileTrust)).toBe(true)
  })
  it('rejects remote pages, other local files and UNC hosts', () => {
    expect(isTrustedRendererUrl('https://example.com/', fileTrust)).toBe(false)
    expect(isTrustedRendererUrl(pathToFileURL(join(indexPath, '..', 'other.html')).href, fileTrust)).toBe(false)
    expect(isTrustedRendererUrl(pathToFileURL(resolve('README.md')).href, fileTrust)).toBe(false)
    expect(isTrustedRendererUrl('file://attacker-host/share/index.html', fileTrust)).toBe(false)
    expect(isTrustedRendererUrl('javascript:alert(1)', fileTrust)).toBe(false)
    expect(isTrustedRendererUrl('', fileTrust)).toBe(false)
  })
  it('compares Windows paths case-insensitively only on win32', () => {
    const upper = indexUrl.replace('index.html', 'INDEX.HTML')
    expect(isTrustedRendererUrl(upper, fileTrust, 'win32')).toBe(true)
    expect(isTrustedRendererUrl(upper, fileTrust, 'linux')).toBe(false)
  })
  it('in a dev run trusts only the dev server origin', () => {
    const dev: TrustedRenderer = { kind: 'dev', origin: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5173/#map-window', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isTrustedRendererUrl(indexUrl, dev)).toBe(false)
  })
})

/** Minimal emitter-backed stand-in for Electron's WebContents events. */
function fakeContents() {
  const emitter = new EventEmitter()
  let openHandler: ((d: { url: string }) => { action: 'deny' }) | undefined
  const contents: HardenableWebContents = {
    on: (event: string, listener: (e: never) => void) => emitter.on(event, listener as (...args: unknown[]) => void),
    setWindowOpenHandler: (h) => {
      openHandler = h
    }
  }
  const navigate = (event: string, url: string | undefined) => {
    const e = { url, preventDefault: vi.fn() }
    emitter.emit(event, e)
    return e.preventDefault
  }
  return { contents, navigate, open: (url: string) => openHandler?.({ url }) }
}

describe('hardenWebContents', () => {
  const isTrusted = (u: string) => isTrustedRendererUrl(u, fileTrust)

  it('cancels navigation of any frame to untrusted URLs and allows the app document', () => {
    const f = fakeContents()
    hardenWebContents(f.contents, isTrusted)
    for (const ev of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      expect(f.navigate(ev, 'https://example.com/'), ev).toHaveBeenCalled()
      expect(f.navigate(ev, 'file:///C:/Windows/win.ini'), ev).toHaveBeenCalled()
      expect(f.navigate(ev, undefined), ev).toHaveBeenCalled()
      expect(f.navigate(ev, `${indexUrl}#map-window`), ev).not.toHaveBeenCalled()
    }
  })

  it('denies every renderer-initiated window and refuses webviews', () => {
    const f = fakeContents()
    hardenWebContents(f.contents, isTrusted)
    expect(f.open('https://example.com/')).toEqual({ action: 'deny' })
    expect(f.open(`${indexUrl}#map-window`)).toEqual({ action: 'deny' })
    expect(f.navigate('will-attach-webview', undefined)).toHaveBeenCalled()
  })
})

describe('assertTrustedIpcSender', () => {
  const isTrusted = (u: string) => isTrustedRendererUrl(u, fileTrust)
  it('accepts the app renderer and rejects anything else', () => {
    expect(() => assertTrustedIpcSender({ senderFrame: { url: `${indexUrl}#map-window` } }, isTrusted)).not.toThrow()
    expect(() => assertTrustedIpcSender({ senderFrame: { url: 'https://example.com/' } }, isTrusted)).toThrow(/untrusted/)
    expect(() => assertTrustedIpcSender({ senderFrame: null }, isTrusted)).toThrow(/untrusted/)
    expect(() => assertTrustedIpcSender({}, isTrusted)).toThrow(/untrusted/)
  })
})

describe('secureWebPreferences', () => {
  it('locks down every renderer', () => {
    expect(secureWebPreferences('p.js')).toMatchObject({
      preload: 'p.js',
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    })
  })
})

describe('buildContentSecurityPolicy', () => {
  const parse = (csp: string) =>
    Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))

  it('production allows only the bundled app files', () => {
    const p = parse(buildContentSecurityPolicy('production'))
    expect(p['default-src']).toEqual(["'none'"])
    expect(p['script-src']).toEqual(["'self'"])
    expect(p['style-src']).toEqual(["'self'"])
    expect(p['connect-src']).toEqual(["'none'"])
    expect(p['object-src']).toEqual(["'none'"])
    expect(p['base-uri']).toEqual(["'none'"])
    expect(p['frame-src']).toEqual(["'none'"])
    expect(buildContentSecurityPolicy('production')).not.toMatch(/unsafe-|https?:|\*/)
  })

  it('development relaxes only what the Vite dev server needs (never unsafe-eval or remote hosts)', () => {
    const csp = buildContentSecurityPolicy('development')
    const p = parse(csp)
    expect(p['script-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(p['connect-src']).toEqual(["'self'", 'ws://localhost:*', 'ws://127.0.0.1:*'])
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/https?:/)
  })
})
