/**
 * Renderer Content-Security-Policy. Single source of truth: injected into `index.html` by the renderer
 * build (electron.vite.config.ts), so the packaged app always ships the production policy.
 *
 * The renderer is local-only (no remote scripts, styles, fonts, images or network requests), so the
 * production policy only allows the app's own bundled files. Development relaxes exactly what Vite's
 * dev server needs: the React-refresh inline preamble, injected `<style>` tags and the HMR socket.
 */
export type CspMode = 'production' | 'development'

const COMMON: Record<string, string> = {
  'default-src': "'none'",
  'img-src': "'self' data:",
  'font-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
  'frame-src': "'none'",
  'worker-src': "'none'",
  'media-src': "'none'",
  'manifest-src': "'none'"
}

export function buildContentSecurityPolicy(mode: CspMode): string {
  const directives: Record<string, string> =
    mode === 'production'
      ? {
          ...COMMON,
          'script-src': "'self'",
          'style-src': "'self'",
          'connect-src': "'none'"
        }
      : {
          ...COMMON,
          'script-src': "'self' 'unsafe-inline'",
          'style-src': "'self' 'unsafe-inline'",
          'connect-src': "'self' ws://localhost:* ws://127.0.0.1:*"
        }
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ')
}
