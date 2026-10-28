// Runs the Vitest "integration" project under Electron's bundled Node (ELECTRON_RUN_AS_NODE), so the
// better-sqlite3 binary rebuilt for Electron by `postinstall` loads without a second native build.
// Extra CLI args are forwarded to Vitest (e.g. `npm run test:integration -- tests/integration/database.test.ts`).
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const vitestCli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')

const result = spawnSync(
  electronBinary,
  [vitestCli, 'run', '--project', 'integration', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
)

if (result.error) {
  console.error('[test:integration] failed to launch Electron:', result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
