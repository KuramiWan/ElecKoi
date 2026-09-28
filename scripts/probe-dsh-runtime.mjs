import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DshDesktopPluginHost, DshRuntime } from '@eleckoi/dsh-runtime'

const root = await mkdtemp(join(tmpdir(), 'eleckoi-electron-dsh-'))
const runtime = new DshRuntime({
  configPath: resolve('resources/dsh/cordis.yml'),
  presetTemplatePath: resolve('resources/dsh/agent-preset-template/agent.cordis.yml'),
  workspaceRoot: join(root, 'workspace'),
  runtimeDataRoot: join(root, 'runtime'),
  executablePath: process.execPath
})
runtime.bindSessionHost(new DshDesktopPluginHost({
  runtimeDataRoot: join(root, 'runtime'),
  workspaceRoot: join(root, 'workspace'),
  agentPatchPath: resolve('resources/dsh/desktop-agent.patch.yml'),
  hostConfiguration: () => runtime.hostConfiguration(),
  executablePath: process.execPath
}))

try {
  await runtime.verify()
  console.log('Electron DSH runtime handshake passed.')
} finally {
  await runtime.close()
  await rm(root, { recursive: true, force: true })
}
