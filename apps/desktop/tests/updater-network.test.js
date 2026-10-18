import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('qualifies update recovery with real Electron HTTP, checksum and NSIS preparation', async () => {
  const project = resolve(import.meta.dirname, '../../..')
  const output = join(project, 'output')
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(join(output, 'updater-network-'))
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const entry = join(directory, 'fixture.cjs')
  try {
    await build({ entryPoints: [join(import.meta.dirname, 'fixtures/updater-network.ts')],
      outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      alias: { '@shared': join(project, 'packages/shared/src') },
      external: ['electron', 'electron-updater', 'electron-updater/*'], logLevel: 'silent' })
    const env = { ...process.env, ELECKOI_UPDATE_TEST_ROOT: directory }
    delete env.ELECTRON_RUN_AS_NODE
    await promisify(execFile)(require('electron'), [entry], {
      env, cwd: project, windowsHide: true, timeout: 25_000, maxBuffer: 1024 * 1024
    })
    const result = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
    expect(result.cases).toHaveLength(6)
  } finally {
    if (dirname(directory) !== output) throw new Error('Unexpected update fixture directory')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 30_000)
