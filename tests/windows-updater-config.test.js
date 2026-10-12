import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const lib = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { PublishManager } = lib('./out/publish/PublishManager.js')
const { resolveFunction } = lib('./out/util/resolve.js')
const { AppInfo } = lib('./out/appInfo.js')
const { Packager } = lib('./out/packager.js')
const { Platform } = lib('./out/index.js')
const { load } = lib('js-yaml')
const hook = require('../apps/desktop/scripts/windows-updater-config.cjs')
const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    const child = relative(tmpdir(), directory)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid temporary directory')
    rmSync(directory, { recursive: true, force: true })
  }
})
it('adds the official updater configuration to the directory stage that skips the normal publish hook', async () => {
  const appOutDir = mkdtempSync(join(tmpdir(), 'eleckoi-updater-config-')); directories.push(appOutDir)
  mkdirSync(join(appOutDir, 'resources'))
  const config = load(readFileSync('apps/desktop/electron-builder.yml', 'utf8'))
  const metadata = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'))
  const appInfo = new AppInfo({ config, metadata })
  const packager = { config, platform: Platform.WINDOWS, platformSpecificBuildOptions: config.win,
    appInfo, info: { config, appInfo }, expandMacro: value => value,
    getResourcesDir: directory => join(directory, 'resources'), isForceCodeSigningVerification: false }
  const handlers = []
  new PublishManager({ onAfterPack: handler => handlers.push(handler), onArtifactCreated: () => {} }, { publish: 'never' })
  const context = { packager, appOutDir, arch: 1, electronPlatformName: 'win32', targets: [{ name: 'dir' }] }
  await handlers[0](context)
  expect(existsSync(join(appOutDir, 'resources/app-update.yml'))).toBe(false)
  const applicationPackager = new Packager({ projectDir: resolve('apps/desktop') })
  const hookRoot = await applicationPackager.getWorkspaceRoot()
  const resolvedHook = await resolveFunction('module', config.afterPack, 'afterPack', hookRoot)
  await resolvedHook(context)
  expect(hook.verifyWindowsUpdaterConfig(appOutDir, resolve('.'))).toMatchObject({
    provider: 'github', owner: 'eleckoi', repo: 'ElecKoi', updaterCacheDirName: appInfo.updaterCacheDirName
  })
  packager.isForceCodeSigningVerification = true
  packager.signingManager = { value: Promise.resolve({ computedPublisherName: { value: Promise.resolve(['合成签名者']) } }) }
  await hook(context)
  expect(hook.verifyWindowsUpdaterConfig(appOutDir, resolve('.')).publisherName).toEqual(['合成签名者'])
})
it('rejects a missing or wrong packaged configuration before creating an installer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-updater-check-')); directories.push(directory)
  mkdirSync(join(directory, 'resources'))
  expect(() => hook.verifyWindowsUpdaterConfig(directory, resolve('.'))).toThrow(/ENOENT/)
  writeFileSync(join(directory, 'resources/app-update.yml'), 'provider: github\nowner: example\nrepo: Other\nupdaterCacheDirName: wrong\n')
  expect(() => hook.verifyWindowsUpdaterConfig(directory, resolve('.'))).toThrow('invalid owner')
})
