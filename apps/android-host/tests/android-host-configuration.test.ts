import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadNodeHostConfiguration } from '../src/pluginHostConfiguration'

const runtimeManifest = JSON.parse(readFileSync(new URL('../../desktop/resources/dsh/runtime-manifest.json', import.meta.url), 'utf8'))
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
    rmSync(directory, { recursive: true, force: true })
  }
})

function configuration(manifest = runtimeManifest): string {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-android-config-'))
  directories.push(root)
  writeFileSync(join(root, 'runtime-manifest.json'), JSON.stringify(manifest))
  for (const file of ['preset.yml', 'agent.patch.yml', 'pnpm.mjs', 'dsh.html']) {
    writeFileSync(join(root, file), '')
  }
  const path = join(root, 'runtime-config.json')
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    runtimeDataRoot: './data', homeRoot: './home', workspaceRoot: './workspace',
    productDatabasePath: './data/product.db', productMediaRoot: './media',
    resourceRoot: '.', clientDirectory: '.', presetTemplatePath: './preset.yml',
    agentPatchPath: './agent.patch.yml', packageManagerEntryPath: './pnpm.mjs'
  }))
  return path
}

describe('Android Host resource admission', () => {
  it('starts configuration loading with the shipped manifest and installed DSH batch', () => {
    const path = configuration()
    expect(loadNodeHostConfiguration(path).productDatabasePath).toBe(resolve(path, '../data/product.db'))
  })

  it.each([
    ['schema', { ...runtimeManifest, schemaVersion: 2 }],
    ['version', { ...runtimeManifest, upstream: { ...runtimeManifest.upstream, version: '0.0.0' } }],
    ['commit', { ...runtimeManifest, upstream: { ...runtimeManifest.upstream, commit: '0'.repeat(40) } }]
  ])('rejects a mismatched %s before loading product data', (_field, manifest) => {
    expect(() => loadNodeHostConfiguration(configuration(manifest))).toThrow('Android Host resources do not match the locked DSH installation')
  })
})
