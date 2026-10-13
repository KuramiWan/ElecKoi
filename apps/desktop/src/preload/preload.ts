import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_SHELL_IPC, type DesktopBrowserBridge, type DesktopBrowserLeaseId, type DesktopBrowserReservation, type DesktopHostFailureNotice, type DshDesktopProductApi } from '@shared/contracts/desktopShell'
import type { UpdateInstallResult, UpdateStatus } from '@shared/contracts/updates/schemas'
import { hasDesktopIpcFailureMarker } from '@shared/foundation/ipcFailure'

/**
 * 边界⑤ preload 侧的**薄适配器**。
 *
 * 主进程侧（`apps/desktop/src/main/platform/electron/desktopShellIpc.ts`）把 handler 的抛出折成线上失败对象
 * 返回；这里把它变成**拒绝**，于是渲染层的 `invoke` 调用方看到一个带 `code`/`details` 的失败。
 *
 * 两条不许越的线：
 *
 * 1. 线上对象**就是**契约形状（`hasDesktopIpcFailureMarker` 认的标记与 `foundation/failure.ts` 的规则 3
 *    同一个），所以这里不做二次解析、不重新拼字符串；
 * 2. 不在这里拼用户可见文案——用户可见文案的唯一解析点在渲染层（ADR 决定 4/8）。
 */
async function invokeDesktopShell<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args)
  if (hasDesktopIpcFailureMarker(result)) throw result
  return result as T
}

function createDesktopBrowserBridge(): DesktopBrowserBridge {
  const listeners = new Map<DesktopBrowserLeaseId, Set<(url: string) => void>>()
  ipcRenderer.on(DESKTOP_SHELL_IPC.browserOpenRequested, (_event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !('lease' in request) || !('url' in request)
      || typeof request.lease !== 'string' || typeof request.url !== 'string') return
    const callbacks = listeners.get(request.lease as DesktopBrowserLeaseId)
    if (callbacks === undefined) return
    for (const callback of [...callbacks]) {
      try {
        callback(request.url)
      } catch (error) {
        console.error('Desktop browser link handler failed', error)
      }
    }
  })
  return {
    acquire: (workspace) => invokeDesktopShell<DesktopBrowserReservation>(DESKTOP_SHELL_IPC.browserAcquire, workspace),
    release: (lease) => invokeDesktopShell<void>(DESKTOP_SHELL_IPC.browserRelease, lease),
    onOpenRequested(lease, listener) {
      let callbacks = listeners.get(lease)
      if (callbacks === undefined) {
        callbacks = new Set()
        listeners.set(lease, callbacks)
      }
      callbacks.add(listener)
      return () => {
        callbacks?.delete(listener)
        if (callbacks?.size === 0) listeners.delete(lease)
      }
    }
  }
}

function createDesktopProductApi(): DshDesktopProductApi {
  return {
    protocolVersion: 1,
    browser: createDesktopBrowserBridge(),
    updates: {
      status: () => invokeDesktopShell<UpdateStatus>(DESKTOP_SHELL_IPC.updatesStatus),
      check: () => invokeDesktopShell<UpdateStatus>(DESKTOP_SHELL_IPC.updatesCheck),
      download: () => invokeDesktopShell<UpdateStatus>(DESKTOP_SHELL_IPC.updatesDownload),
      install: () => invokeDesktopShell<UpdateInstallResult>(DESKTOP_SHELL_IPC.updatesInstall),
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]): void => listener(status)
        ipcRenderer.on(DESKTOP_SHELL_IPC.updatesChanged, handle)
        return () => ipcRenderer.off(DESKTOP_SHELL_IPC.updatesChanged, handle)
      }
    },
    windowControls: {
      minimize: () => invokeDesktopShell<void>(DESKTOP_SHELL_IPC.windowControl, 'minimize'),
      maximizeToggle: () => invokeDesktopShell<void>(DESKTOP_SHELL_IPC.windowControl, 'maximize'),
      close: () => invokeDesktopShell<void>(DESKTOP_SHELL_IPC.windowControl, 'close')
    },
    host: {
      subscribeFailure(listener) {
        // 这条通道送**失败对象**（码 + 参数化详情 + 诊断指针），不是拼好的句子；preload 只验标记、
        // 不改写内容，用户可见文案由渲染层唯一解析点拼（ADR 决定 4/8）。
        const handle = (_event: Electron.IpcRendererEvent, failure: unknown): void => {
          if (!hasDesktopIpcFailureMarker(failure)) return
          listener(failure as DesktopHostFailureNotice)
        }
        ipcRenderer.on(DESKTOP_SHELL_IPC.hostFailure, handle)
        return () => ipcRenderer.off(DESKTOP_SHELL_IPC.hostFailure, handle)
      }
    }
  }
}

const documentLocation = (globalThis as unknown as { location?: { protocol: string; hostname: string } }).location
if (documentLocation?.protocol === 'dsh-app:' && documentLocation.hostname === 'app' && process.isMainFrame) {
  type BootNode = {
    nextElementSibling: BootNode | null
    textContent: string | null
    style: { cssText: string }
    remove(): void
    after(node: BootNode): void
  }
  const browser = globalThis as unknown as {
    document: {
      querySelector(selector: string): BootNode | null
      createElement(tag: string): BootNode
      documentElement: { getAttribute(name: string): string | null }
      readyState: string
    }
    MutationObserver: new (callback: () => void) => { observe(target: object, options: object): void }
    addEventListener(name: string, listener: () => void, options: { once: boolean }): void
  }
  const showBootFailure = (message: string): void => {
    const spinner = browser.document.querySelector('[data-dsh-boot-spinner]')
    if (spinner === null) return
    const hint = spinner.nextElementSibling
    spinner.remove()
    if (hint !== null) hint.textContent = '插件加载失败'
    const detail = browser.document.createElement('pre')
    detail.textContent = message
    detail.style.cssText = 'max-width:min(640px,80vw);white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;font:12px/1.5 monospace;color:inherit;'
    hint?.after(detail)
  }
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => invokeDesktopShell<unknown>('eleckoi:dsh-client-boot'),
    failed: (message: string) => {
      showBootFailure(message)
      return invokeDesktopShell<void>('eleckoi:dsh-client-boot-failed', message)
    }
  })

  let sentThemeSource: string | undefined
  const sendThemeSource = (): void => {
    const source = browser.document.documentElement.getAttribute('data-ds-theme-source')
    if (source === null || source === sentThemeSource) return
    sentThemeSource = source
    ipcRenderer.send('eleckoi:dsh-native-theme', source)
  }
  const observeThemeSource = (): void => {
    new browser.MutationObserver(sendThemeSource).observe(browser.document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ds-theme-source']
    })
    sendThemeSource()
  }
  if (browser.document.readyState === 'loading') {
    browser.addEventListener('DOMContentLoaded', observeThemeSource, { once: true })
  } else observeThemeSource()
}

contextBridge.exposeInMainWorld(
  'dshDesktop',
  documentLocation?.protocol === 'dsh-app:' && documentLocation.hostname === 'app' && process.isMainFrame
    ? createDesktopProductApi()
    : { protocolVersion: 1 }
)
