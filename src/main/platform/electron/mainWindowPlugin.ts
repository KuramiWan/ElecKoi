import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeTheme, protocol, screen, session, shell, type BrowserWindowConstructorOptions } from 'electron'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { AppearanceMode } from '@shared/contracts/settings/schemas'
import { assertTrustedDshClientBoot, isAllowedExternalUrl, isAppRendererUrl, isDshAppUrl, isDshChildUrl } from './validateSender'
import { ElectronWindowHost } from './ElectronWindowHost'
import { installWindowsNativeFrame } from './windowsNativeFrame'
import { authenticateDshClientHost, DSH_CLIENT_ORIGIN, forwardDshClientRequest, isDshClientAsset, resolveElecKoiClientAssets, serveDshClientAsset, serveElecKoiClientAsset } from './dshClientDocument'

export const mainWindowPlugin = {
  name: 'eleckoi-main-window',
  inject: ['appPaths', 'appLog', 'desktopGateway', 'agentSessions', 'pluginHost', 'userSettings'],
  provide: 'electronWindows',
  async apply(ctx: Context) {
    let appearanceMode = ctx.userSettings.read('appearance.mode')
    nativeTheme.themeSource = 'system'

    const windows = new ElectronWindowHost()
    ctx.provide('electronWindows', windows)
    let mainWindow: BrowserWindow | undefined

    windows.define('main', {
      singleton: true,
      closesHostOnClose: true,
      options: () => windowOptions(ctx, false),
      load: (window) => window.loadURL(`${DSH_CLIENT_ORIGIN}/`),
      afterCreate: (window) => {
        mainWindow = window
        window.once('closed', () => { if (mainWindow === window) mainWindow = undefined })
        configureMainWindow(ctx, windows, window)
      }
    })
    windows.define('child', {
      singleton: false,
      instanceKey: (payload) => {
        const frameName = (payload as { frameName?: unknown })?.frameName
        return typeof frameName === 'string' ? frameName : ''
      },
      options: (payload) => windowOptions(ctx, true, payload),
      load: async (window, payload) => {
        const url = (payload as { url?: unknown })?.url
        if (typeof url !== 'string' || (!isAppRendererUrl(url) && !isDshChildUrl(url))) {
          throw new Error('拒绝打开非 ElecKoi 子窗口。')
        }
        await window.loadURL(url)
      },
      afterCreate: (window) => {
        configureWindowsAppDetails(ctx, window)
        installWindowsNativeFrame(window)
        window.webContents.on('did-finish-load', () => installWindowsNativeFrame(window))
        window.webContents.on('console-message', ({ level, message }) => {
          if (level === 'error') ctx.appLog.error({ message }, 'ElecKoi child window console error')
        })
        window.webContents.on('did-fail-load', (_event, code, description, url) => {
          ctx.appLog.error({ code, description, url }, 'ElecKoi child window failed to load')
        })
        window.once('ready-to-show', () => window.show())
        configureWindowNavigation(ctx, windows, window, true)
      }
    })
    let pluginHostReady: { url: string; injections: readonly unknown[]; cookie: string } | undefined
    const rendererDirectory = join(__dirname, '../renderer-dsh')
    const clientAssets = await resolveElecKoiClientAssets(rendererDirectory)
    protocol.handle('dsh-app', async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'app') return new Response(null, { status: 404 })
      if (url.pathname.startsWith('/eleckoi/assets/')) return serveElecKoiClientAsset(request, rendererDirectory)
      if (isDshClientAsset(url.pathname)) return serveDshClientAsset(request, ctx.pluginHost.frontendDirectory())
      const ready = pluginHostReady
      if (ready === undefined) return new Response(null, { status: 503 })
      try {
        const response = await forwardDshClientRequest(request, ready.url, ready.cookie)
        if (!response.ok && url.pathname.startsWith('/plugins/')) {
          ctx.appLog.error({ status: response.status, pathname: url.pathname }, 'DSH client plugin asset failed')
        }
        return response
      } catch (error) {
        ctx.appLog.error({ error, pathname: url.pathname }, 'DSH client request failed')
        return new Response(null, { status: 502 })
      }
    })
    ipcMain.handle('eleckoi:dsh-client-boot', (event) => {
      assertTrustedDshClientBoot(
        event.sender,
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        windows.all().map(window => window.webContents)
      )
      const ready = pluginHostReady
      if (ready === undefined) throw new Error('DSH 插件宿主尚未启动。')
      return {
        injections: [
          ...ready.injections,
          { kind: 'global', name: '__ELECKOI_CLIENT_ASSETS__', value: clientAssets }
        ],
        streamBaseUrl: new URL(ready.url).origin
      }
    })
    ipcMain.handle('eleckoi:dsh-client-boot-failed', (event, message: unknown) => {
      assertTrustedDshClientBoot(
        event.sender,
        event.senderFrame?.url ?? '',
        event.senderFrame === event.sender.mainFrame,
        windows.all().map(window => window.webContents)
      )
      if (typeof message !== 'string') throw new Error('DSH 插件页面错误格式不正确。')
      ctx.appLog.error({ message }, 'DSH plugin client boot failed')
      ctx.desktopGateway.broadcast('plugins.host.failed', { message: `插件页面加载失败：${message}` })
    })
    const syncNativeTheme = (event: Electron.IpcMainEvent, source: unknown) => {
      const mainContents = mainWindow?.webContents
      if (mainContents === undefined || event.sender !== mainContents
        || event.senderFrame !== mainContents.mainFrame
        || event.senderFrame?.url !== `${DSH_CLIENT_ORIGIN}/`) return
      if (source === 'light' || source === 'dark' || source === 'system') nativeTheme.themeSource = source
    }
    ipcMain.on('eleckoi:dsh-native-theme', syncNativeTheme)
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
      const ready = pluginHostReady
      const trustedSender = windows.all().some(window => window.webContents.id === details.webContentsId)
      if (ready === undefined || !trustedSender) { callback({}); return }
      const target = new URL(ready.url)
      if (new URL(details.url).host !== target.host) { callback({}); return }
      const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
      if (headers.origin !== DSH_CLIENT_ORIGIN) { callback({ cancel: true }); return }
      callback({ requestHeaders: { ...headers, origin: target.origin, cookie: ready.cookie, 'sec-fetch-site': 'same-origin' } })
    })
    const focusMainWindow = () => { void windows.open('main') }
    app.on('activate', focusMainWindow)
    app.on('second-instance', focusMainWindow)

    const unregisterControl = ctx.desktopGateway.register(
      'command.window.control',
      ({ action }, request) => {
        const target = request.windowId === undefined ? undefined : BrowserWindow.fromId(request.windowId)
        if (target != null && !target.isDestroyed()) {
          if (action === 'minimize') target.minimize()
          if (action === 'maximize') {
            if (target.isMaximized()) target.unmaximize()
            else target.maximize()
          }
          if (action === 'close') target.close()
        }
        return { ok: true as const }
      }
    )
    const publishAppearanceMode = () => {
      ctx.desktopGateway.broadcast('settings.changed', {
        key: 'appearance.mode',
        value: appearanceMode
      })
    }
    const handleNativeThemeUpdated = () => {
      if (appearanceMode === 'system') publishAppearanceMode()
    }
    nativeTheme.on('updated', handleNativeThemeUpdated)

    const unregisterAppearanceMode = ctx.desktopGateway.register(
      'command.appearance.set_mode',
      ({ mode }) => {
        appearanceMode = ctx.userSettings.write('appearance.mode', mode)
        nativeTheme.themeSource = appearanceMode
        publishAppearanceMode()
        return {
          mode: appearanceMode,
          resolved: resolveAppearanceMode(appearanceMode)
        }
      }
    )

    const ready = await ctx.pluginHost.start()
    pluginHostReady = { ...ready, cookie: await authenticateDshClientHost(ready.url) }
    await windows.open('main')
    return () => {
      unregisterControl()
      ipcMain.removeHandler('eleckoi:dsh-client-boot')
      ipcMain.removeHandler('eleckoi:dsh-client-boot-failed')
      ipcMain.removeListener('eleckoi:dsh-native-theme', syncNativeTheme)
      session.defaultSession.webRequest.onBeforeSendHeaders(null)
      protocol.unhandle('dsh-app')
      unregisterAppearanceMode()
      nativeTheme.removeListener('updated', handleNativeThemeUpdated)
      app.removeListener('activate', focusMainWindow)
      app.removeListener('second-instance', focusMainWindow)
      windows.close()
    }
  }
} satisfies Plugin.Object

function windowOptions(ctx: Context, child: boolean, payload?: unknown): BrowserWindowConstructorOptions {
  const size = child ? initialChildWindowSize(payload) : initialWindowSize()
  return {
    title: child ? 'ElecKoi' : 'ElecKoi',
    ...size,
    minWidth: 900,
    minHeight: 600,
    center: true,
    show: false,
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const }
      : { frame: false }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#13131a' : '#ffffff',
    icon: ctx.appPaths.resolveResource('icons', 'eleckoi-app-icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}

function resolveAppearanceMode(mode: AppearanceMode): 'light' | 'dark' {
  if (mode === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return mode
}

function configureMainWindow(ctx: Context, windows: ElectronWindowHost, window: BrowserWindow): void {
  configureWindowsAppDetails(ctx, window)
  installWindowsNativeFrame(window)
  window.webContents.on('did-finish-load', () => installWindowsNativeFrame(window))
  window.once('ready-to-show', () => window.show())
  configureWindowNavigation(ctx, windows, window, true)
}

function configureWindowNavigation(ctx: Context, windows: ElectronWindowHost, window: BrowserWindow, allowDshClient = false): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppRendererUrl(url) && !(allowDshClient && isDshAppUrl(url))) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (isAppRendererUrl(url) || isDshChildUrl(url)) void windows.open('child', { url, frameName })
    else if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url).catch((error: unknown) => {
        ctx.appLog.warn({ error, url }, 'Failed to open external URL')
      })
    }
    else ctx.appLog.warn({ url }, 'Blocked external window request')
    return { action: 'deny' }
  })
}

function configureWindowsAppDetails(ctx: Context, window: BrowserWindow): void {
  if (process.platform !== 'win32') return

  const executable = `"${process.execPath}"`
  const relaunchCommand = process.defaultApp
    ? `${executable} "${app.getAppPath()}"`
    : executable

  window.setAppDetails({
    appId: 'com.eleckoi.desktop',
    appIconPath: process.defaultApp
      ? ctx.appPaths.resolveResource('icons', 'eleckoi-app-icon.ico')
      : process.execPath,
    appIconIndex: 0,
    relaunchCommand,
    relaunchDisplayName: 'ElecKoi'
  })
}

function initialWindowSize(): { width: number; height: number } {
  return fitWindowSize(1536, 1070)
}

function initialChildWindowSize(payload?: unknown): { width: number; height: number } {
  const frameName = (payload as { frameName?: unknown } | undefined)?.frameName
  if (typeof frameName === 'string' && frameName.startsWith('character-editor-')) {
    return fitWindowSize(1520, 1120)
  }
  if (frameName === 'creator-studio') {
    return fitWindowSize(1536, 1070)
  }
  if (frameName === 'character-manager' || frameName === 'preset-manager') {
    return fitWindowSize(1500, 1040)
  }
  return fitWindowSize(960, 720)
}

function fitWindowSize(preferredWidth: number, preferredHeight: number): { width: number; height: number } {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const workAreaMargin = 64
  const scale = Math.min(
    1,
    (workArea.width - workAreaMargin) / preferredWidth,
    (workArea.height - workAreaMargin) / preferredHeight
  )

  return {
    width: Math.max(900, Math.floor(preferredWidth * scale)),
    height: Math.max(600, Math.floor(preferredHeight * scale))
  }
}
