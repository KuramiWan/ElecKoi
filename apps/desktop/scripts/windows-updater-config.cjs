const { createRequire } = require('node:module')
const { join } = require('node:path')
const { readFileSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const builderLibRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { getAppUpdatePublishConfiguration } = builderLibRequire('./out/publish/PublishManager.js')
const { AppInfo } = builderLibRequire('./out/appInfo.js')
const { serializeToYaml } = builderLibRequire('builder-util')
const { load } = builderLibRequire('js-yaml')

// Write the updater configuration before the verified installer stage.
async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const config = await getAppUpdatePublishConfiguration(context.packager, null, context.arch, true)
  if (!config) throw new Error('Windows application has no updater publish configuration.')
  await writeFile(join(context.packager.getResourcesDir(context.appOutDir), 'app-update.yml'), serializeToYaml(config))
}

function verifyWindowsUpdaterConfig(appOutDir, workspaceRoot) {
  const config = load(readFileSync(join(workspaceRoot, 'apps/desktop/electron-builder.yml'), 'utf8'))
  const metadata = JSON.parse(readFileSync(join(workspaceRoot, 'apps/desktop/package.json'), 'utf8'))
  const expected = { ...config.publish, updaterCacheDirName: new AppInfo({ config, metadata }).updaterCacheDirName }
  const actual = load(readFileSync(join(appOutDir, 'resources/app-update.yml'), 'utf8'))
  for (const field of ['provider', 'owner', 'repo', 'updaterCacheDirName']) {
    if (!actual || typeof expected[field] !== 'string' || actual[field] !== expected[field]) {
      throw new Error(`Packaged updater configuration has an invalid ${field}.`)
    }
  }
  return actual
}

module.exports = afterPack
module.exports.verifyWindowsUpdaterConfig = verifyWindowsUpdaterConfig
