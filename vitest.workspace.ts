import { fileURLToPath } from 'node:url'
import { defineWorkspace } from 'vitest/config'

const shared = fileURLToPath(new URL('./src/shared', import.meta.url))
const electronStub = fileURLToPath(new URL('./tests/stubs/electron.ts', import.meta.url))

export default defineWorkspace([
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
    // Real SQLite + main-process services. better-sqlite3 is rebuilt for Electron's ABI by
    // `postinstall`, so this project must run under Electron's Node: `npm run test:integration`.
    resolve: { alias: { '@shared': shared, electron: electronStub } },
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      environment: 'node',
      pool: 'forks'
    }
  }
])
