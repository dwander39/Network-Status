import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'
import { buildContentSecurityPolicy } from './src/shared/contentSecurityPolicy'

/** Injects the renderer CSP as the first `<head>` element: strict for builds, relaxed for the dev server. */
function contentSecurityPolicy(): Plugin {
  let mode: 'production' | 'development' = 'production'
  return {
    name: 'network-status-csp',
    configResolved(config) {
      mode = config.command === 'serve' ? 'development' : 'production'
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildContentSecurityPolicy(mode) },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'es' } } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [externalizeDepsPlugin()],
    // CJS so Electron can execute the preload without ESM ("import outside a module").
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } }
  },
  renderer: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    plugins: [contentSecurityPolicy(), react()]
  }
})
