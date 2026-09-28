import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '@shared/contracts/desktopBridge'
import { DESKTOP_EVENT_CHANNEL, DESKTOP_REQUEST_CHANNEL } from '@shared/contracts/gateway/channels'
import type { GatewayEventEnvelope } from '@shared/contracts/gateway/types'

const bridge: DesktopBridge = {
  request: (name, input) => ipcRenderer.invoke(DESKTOP_REQUEST_CHANNEL, { name, input }),
  subscribe: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, envelope: GatewayEventEnvelope) => listener(envelope)
    ipcRenderer.on(DESKTOP_EVENT_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(DESKTOP_EVENT_CHANNEL, wrapped)
  }
}

contextBridge.exposeInMainWorld('eleckoi', bridge)

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
  contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1 })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke('eleckoi:dsh-client-boot') as Promise<unknown>,
    failed: (message: string) => {
      showBootFailure(message)
      return ipcRenderer.invoke('eleckoi:dsh-client-boot-failed', message) as Promise<void>
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
