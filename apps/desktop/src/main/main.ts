import { join } from 'node:path'
import { app, dialog, protocol } from 'electron'
import { DesktopHost } from '@main/host/DesktopHost'
import { StartupProfileStore } from '@main/host/startup/StartupProfileStore'
import { configureElectron, configureRuntimeUserData } from '@main/host/startup/configureElectron'
import { getBootstrapLogger } from '@main/platform/logging/AppLog'
import { installProcessFailureOutlet } from '@main/platform/logging/processFailureOutlet'
import { localMediaScheme } from '@main/platform/electron/mediaProtocol'
import { windowsAppUserModelId } from '@main/platform/electron/windowsAppIdentity'

const logger = getBootstrapLogger()
// 进程级落点：未被 catch 的拒绝与异常也要进同一个日志出口（ADR 0002 决定 12 最后一条）。
installProcessFailureOutlet(logger)
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

const host = new DesktopHost()
const ownsPrimaryInstance = app.requestSingleInstanceLock()
let shutdownStarted = false
let shutdownComplete = false

if (!ownsPrimaryInstance) {
  app.quit()
} else {
  // `startDesktop()` 内部那个 try/catch 已经兜住启动失败；这里兜的是**它的收尾本身**抛出
  // （日志、对话框、退出任一步失败）。没有这条 `.catch()` 时那是一个无人接的拒绝。
  void startDesktop().catch((error: unknown) => {
    logger.error({ err: error }, 'ElecKoi Desktop 启动失败后的收尾也失败')
    process.exitCode = 1
    app.exit(1)
  })
}

async function startDesktop(): Promise<void> {
  try {
    await host.mountFoundation()
    await app.whenReady()
    app.setAppUserModelId(windowsAppUserModelId)
    await host.mountInteractive()
  } catch (error) {
    logger.error(
      { err: error, code: failureCodeOf(error), effects: host.diagnostics() },
      'ElecKoi Desktop 启动失败'
    )
    dialog.showErrorBox('ElecKoi 启动失败', `${formatError(error)}\n\n请把这段错误发给开发者。`)
    // 启动失败要以非零码退出：否则「应用没起来」与「用户自己关掉了」在外部看是同一个结果。
    process.exitCode = 1
    app.quit()
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

// 失败码排在 stack 前面：用户把它抄给维护者时不用在一大段 stack 里找。
// 这就是 ready 之前那条 `fatal` 的用户面（插件宿主启动失败 → 异常冒到 startDesktop）。
function formatError(error: unknown): string {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  const code = failureCodeOf(error)
  return code === undefined ? detail : `失败码：${code}\n\n${detail}`
}

// 结构判定，不用 `instanceof`：失败对象是从桌面宿主包跨包来的，
// 打包边界上不保证类身份唯一（同上游 `remoteErrorOf` 的理由）。没有 string `code` 就当没有码。
function failureCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' && error.code.length > 0 ? error.code : undefined
}
