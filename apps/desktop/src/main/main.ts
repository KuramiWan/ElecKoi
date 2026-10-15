import { join } from 'node:path'
import { app, dialog, protocol } from 'electron'
import { DesktopHost } from '@main/host/DesktopHost'
import { StartupProfileStore } from '@main/host/startup/StartupProfileStore'
import { configureElectron, configureRuntimeUserData } from '@main/host/startup/configureElectron'
import { getBootstrapLogger } from '@main/platform/logging/AppLog'
import { localMediaScheme } from '@main/platform/electron/mediaProtocol'
import { windowsAppUserModelId } from '@main/platform/electron/windowsAppIdentity'
import { DesktopFatalRecovery } from '@main/platform/electron/desktopFatalRecovery'

const logger = getBootstrapLogger()
protocol.registerSchemesAsPrivileged([localMediaScheme, {
  scheme: 'dsh-app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    codeCache: true
  }
}])
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
configureRuntimeUserData()
const startupProfiles = new StartupProfileStore()
const startupProfile = startupProfiles.load(join(app.getPath('userData'), 'startup-profile.json'))
configureElectron(startupProfile)

const host = new DesktopHost(error => { void reportFatal(error) })
const recovery = new DesktopFatalRecovery({
  show: options => dialog.showMessageBox(options),
  stop: () => host.stopPluginHost(),
  disableUserPlugins: async () => {
    const backupPath = await host.disableUserPlugins()
    logger.info({ backupPath }, '用户插件已停用，ElecKoi 内置组合已保留')
  },
  exit: () => app.quit(),
  restart: () => { app.relaunch(); app.quit() },
  diagnostic: error => logger.error({ err: error, effects: host.diagnostics() }, 'ElecKoi 运行失败')
})
const ownsPrimaryInstance = app.requestSingleInstanceLock()
let shutdownStarted = false
let shutdownComplete = false

if (!ownsPrimaryInstance) {
  app.quit()
} else {
  void startDesktop()
}

async function startDesktop(): Promise<void> {
  try {
    await host.mountFoundation()
    await app.whenReady()
    app.setAppUserModelId(windowsAppUserModelId)
    await host.mountInteractive()
  } catch (error) {
    await reportFatal(error)
  }
}

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  void host.dispose()
    .catch((error) => logger.error({ err: error }, 'ElecKoi Desktop 关闭运行代失败'))
    .finally(() => {
      shutdownComplete = true
      app.quit()
    })
})

async function reportFatal(error: unknown): Promise<void> {
  await app.whenReady()
  try { await recovery.report(error) }
  catch (failure) { logger.error({ err: failure }, '原生恢复操作失败'); app.quit() }
}
