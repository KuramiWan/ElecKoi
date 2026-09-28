import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pnpmCli = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')

function run(args) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

let testStatus = 1
let needsRestore = false
try {
  const rebuildStatus = run(['rebuild:node'])
  if (rebuildStatus === 0) {
    needsRestore = true
    testStatus = run(['exec', 'vitest', 'run', ...process.argv.slice(2)])
  } else {
    testStatus = rebuildStatus
    needsRestore = run(['check:electron-sqlite']) !== 0
  }
} finally {
  if (needsRestore) {
    const restoreStatus = run(['rebuild:electron'])
    if (restoreStatus !== 0) {
      console.error('Electron SQLite 原生模块恢复失败。')
      process.exitCode = restoreStatus
    }
  }
}

if (!process.exitCode) process.exitCode = testStatus
