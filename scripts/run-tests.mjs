import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { selectTestSuite } from './test-suites.mjs'

export async function runTests(suiteName, args, run, isCancelled = () => false) {
  const suite = selectTestSuite(suiteName)
  // Preparation options belong to the suite; forwarding a different project would
  // otherwise run native tests without preparing their runtime.
  if (args.some(arg => /^(?:--project|-c|--config|--workspace)(?:=|$)/.test(arg))) {
    throw new Error('请通过 test:<分组> 选择测试环境，不要覆盖分组或配置。')
  }
  let restore = false
  let status = 1
  try {
    if (suite.runtime) {
      status = await run(['build:workspace-runtime'])
      if (status !== 0 || isCancelled()) return isCancelled() ? 130 : status
    }
    if (suite.sqlite) {
      // Even a failed/interrupted rebuild may have changed the native binary.
      restore = true
      status = await run(['rebuild:node'])
      if (status !== 0 || isCancelled()) return isCancelled() ? 130 : status
    }
    if (isCancelled()) return 130
    status = await run(['exec', 'vitest', 'run', ...(suiteName === 'all' ? [] : ['--project', suiteName]), ...args])
    if (isCancelled()) status = 130
  } finally {
    if (restore) {
      const restored = await run(['rebuild:electron'], { restoring: true })
      if (restored !== 0) throw new Error(`Electron SQLite 原生模块恢复失败（退出码 ${restored}）。`)
    }
  }
  return status
}

export function createProcessRunner({ cwd = process.cwd() } = {}) {
  const require = createRequire(import.meta.url)
  const pnpmCli = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
  let active, cancelled = false
  const cancel = () => {
    cancelled = true
    if (!active || active.restoring) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try { process.kill(-active.child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
  }
  const run = (args, { restoring = false } = {}) => new Promise((resolve, reject) => {
    if (cancelled && !restoring) return resolve(130)
    const child = spawn(process.execPath, [pnpmCli, ...args], {
      cwd, env: process.env, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32',
    })
    active = { child, restoring }
    child.once('error', error => { if (active?.child === child) active = undefined; reject(error) })
    child.once('close', (code, signal) => { if (active?.child === child) active = undefined; resolve(code ?? (signal ? 130 : 1)) })
  })
  return { run, cancel, isCancelled: () => cancelled }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runner = createProcessRunner()
  process.on('SIGINT', runner.cancel)
  process.on('SIGTERM', runner.cancel)
  try {
    process.exitCode = await runTests(process.argv[2] ?? 'all', process.argv.slice(3), runner.run, runner.isCancelled)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    process.off('SIGINT', runner.cancel)
    process.off('SIGTERM', runner.cancel)
  }
}
