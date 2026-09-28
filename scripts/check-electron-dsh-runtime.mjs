import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import electron from 'electron'

const executable = electron

const result = spawnSync(executable, [join(process.cwd(), 'scripts', 'probe-dsh-runtime.mjs')], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 90_000
})

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Electron DSH runtime handshake failed.\n')
  process.exit(result.status ?? 1)
}

process.stdout.write(result.stdout)

const pluginHost = spawnSync(executable, [join(process.cwd(), 'scripts', 'probe-dsh-desktop-plugin-host.mjs')], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 90_000
})

if (pluginHost.status !== 0) {
  process.stderr.write(pluginHost.stderr || pluginHost.stdout || 'Electron DSH plugin Host handshake failed.\n')
  process.exit(pluginHost.status ?? 1)
}

process.stdout.write(pluginHost.stdout)
