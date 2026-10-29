import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const shared = fileURLToPath(new URL('./src/shared', import.meta.url))
const electronStub = fileURLToPath(new URL('./tests/stubs/electron.ts', import.meta.url))

// Vitest 4 replaced the separate workspace file with `test.projects`; the two projects are unchanged.
export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic (parsers, validation, map geometry). Runs under plain Node. Some parsers live in
        // main-process modules whose import graph reaches `electron`, hence the stub here too.
        resolve: { alias: { '@shared': shared, electron: electronStub } },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        // Real SQLite + main-process services, run under Electron's Node (`npm run test:integration`)
        // so they exercise the shipped runtime. better-sqlite3 ships N-API prebuilds, so no rebuild.
        resolve: { alias: { '@shared': shared, electron: electronStub } },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          pool: 'forks'
        }
      }
    ]
  }
})
