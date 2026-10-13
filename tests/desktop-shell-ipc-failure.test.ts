/**
 * 边界⑤（主进程 ↔ 渲染层）的失败形态用例。
 *
 * 判据来源：票 EH-5 第 2/3 节；事实底座 `notes/eh-explore-renderer.md` §5（13 个通道 + 逐通道守卫）
 * 与 §6.3（今天渲染层只拿到 Electron 包装的文案，码与详情不随行）。
 *
 * 断言的是**外部行为**：一次壳调用失败时，调用方（渲染层拿到的那个 API）观察到什么。
 * 三段都是真实代码拼起来跑的：
 *
 * 1. 主进程侧薄适配器 `handleDesktopShellCall`（`apps/desktop/src/main/platform/electron/desktopShellIpc.ts`）；
 * 2. 发送方守卫 `assertTrustedDshClientFrame`（`validateSender.ts`）；
 * 3. 真实 preload（`apps/desktop/src/preload/preload.ts`，经 `contextBridge` 暴露的那个 API）。
 *
 * 只有 `electron` 模块本身是桩，且桩按 Electron 的真实行为建模：**`ipcMain.handle` 的 handler 抛出时，
 * 跨进程只带得走 message**（contextBridge 文档：Error 的自定义属性会丢，electron/electron#25596）。
 * 所以码与详情必须走「主进程返回结构化失败对象 → preload 把它变成拒绝」这条路——这正是本票改的东西。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DESKTOP_SHELL_IPC, type DesktopBrowserLeaseId, type DshDesktopProductApi } from '@shared/contracts/desktopShell'
import { DesktopError } from '@shared/foundation/DesktopError'
import { foldFailure } from '@shared/foundation/failure'
import { handleDesktopShellCall } from '../apps/desktop/src/main/platform/electron/desktopShellIpc'
import { assertTrustedDshClientFrame } from '../apps/desktop/src/main/platform/electron/validateSender'

const harness = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const exposed = new Map<string, unknown>()
  const event = { sender: { getURL: () => 'dsh-app://app/' }, frameUrl: 'dsh-app://app/' }
  return {
    handlers,
    exposed,
    event,
    ipcMain: {
      handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
        handlers.set(channel, handler)
      },
      removeHandler(channel: string): void {
        handlers.delete(channel)
      },
      on(): void {},
      removeListener(): void {}
    },
    ipcRenderer: {
      invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
        const handler = handlers.get(channel)
        if (handler === undefined) {
          throw new Error(`Error invoking remote method '${channel}': Error: No handler registered for '${channel}'`)
        }
        try {
          return await handler(event, ...args)
        } catch (error) {
          // Electron 只把 message 带过进程边界；自定义属性在这一步必然丢。
          throw new Error(`Error invoking remote method '${channel}': ${String(error)}`)
        }
      },
      on(): void {},
      off(): void {},
      send(): void {}
    },
    contextBridge: {
      exposeInMainWorld(key: string, api: unknown): void {
        exposed.set(key, api)
      }
    }
  }
})

vi.mock('electron', () => ({
  contextBridge: harness.contextBridge,
  ipcMain: harness.ipcMain,
  ipcRenderer: harness.ipcRenderer
}))

/** `dshDesktopBoot` 的形状（preload.ts 里那个只给 `dsh-app://app` 主框架的第二个出口）。 */
interface BootApi {
  ready(): Promise<unknown>
  failed(message: string): Promise<void>
}

interface InvokeSurface {
  /** 失败信息里说清是哪条通道的哪个入口。 */
  readonly label: string
  readonly channel: string
  readonly call: () => Promise<unknown>
}

function exposed<T>(key: string): T {
  const api = harness.exposed.get(key)
  if (typeof api !== 'object' || api === null) throw new Error(`preload 没有暴露 ${key}`)
  return api as T
}

const desktopApi = (): DshDesktopProductApi => exposed<DshDesktopProductApi>('dshDesktop')
const bootApi = (): BootApi => exposed<BootApi>('dshDesktopBoot')

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`preload 没有暴露 ${label}`)
  return value
}

async function captureFailure(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call()
  } catch (error) {
    return error
  }
  throw new Error('这次调用本应被拒绝，但它成功了。')
}

/**
 * 9 条 invoke 形态通道上的 11 个入口。
 * 另外 3 条通道没有失败方向：2 条 main→renderer 事件（browser-open-requested / updates-changed）
 * 与单向 `send` 的 `eleckoi:dsh-native-theme`（对不可信 sender 静默 return，本票不动）。
 * `dsh-desktop:host-failure` **不在**这一组：它是失败通知，EH-11 起送失败对象
 * （用例在 tests/host-failure-notice.test.ts）。
 */
const invokeSurfaces: readonly InvokeSurface[] = [
  {
    label: 'browser.acquire',
    channel: DESKTOP_SHELL_IPC.browserAcquire,
    call: () => required(desktopApi().browser, 'browser').acquire('workspace-1')
  },
  {
    label: 'browser.release',
    channel: DESKTOP_SHELL_IPC.browserRelease,
    call: () => required(desktopApi().browser, 'browser').release('lease-1' as DesktopBrowserLeaseId)
  },
  {
    label: 'updates.status',
    channel: DESKTOP_SHELL_IPC.updatesStatus,
    call: () => required(desktopApi().updates, 'updates').status()
  },
  {
    label: 'updates.check',
    channel: DESKTOP_SHELL_IPC.updatesCheck,
    call: () => required(desktopApi().updates, 'updates').check()
  },
  {
    label: 'updates.download',
    channel: DESKTOP_SHELL_IPC.updatesDownload,
    call: () => required(desktopApi().updates, 'updates').download()
  },
  {
    label: 'updates.install',
    channel: DESKTOP_SHELL_IPC.updatesInstall,
    call: () => required(desktopApi().updates, 'updates').install()
  },
  {
    label: 'window-control minimize',
    channel: DESKTOP_SHELL_IPC.windowControl,
    call: () => required(desktopApi().windowControls, 'windowControls').minimize()
  },
  {
    label: 'window-control maximize',
    channel: DESKTOP_SHELL_IPC.windowControl,
    call: () => required(desktopApi().windowControls, 'windowControls').maximizeToggle()
  },
  {
    label: 'window-control close',
    channel: DESKTOP_SHELL_IPC.windowControl,
    call: () => required(desktopApi().windowControls, 'windowControls').close()
  },
  { label: 'dsh-client-boot', channel: 'eleckoi:dsh-client-boot', call: () => bootApi().ready() },
  {
    label: 'dsh-client-boot-failed',
    channel: 'eleckoi:dsh-client-boot-failed',
    call: () => bootApi().failed('插件页面起不来')
  }
]

beforeAll(async () => {
  // preload.ts 只在 `dsh-app://app` 主框架暴露完整 API（`:127`），所以这三样要照它的前提摆好。
  Object.defineProperty(process, 'isMainFrame', { value: true, configurable: true })
  const scope = globalThis as unknown as {
    location: { protocol: string; hostname: string }
    document: unknown
    MutationObserver: unknown
    addEventListener: unknown
  }
  scope.location = { protocol: 'dsh-app:', hostname: 'app' }
  scope.document = {
    querySelector: () => null,
    createElement: () => ({
      nextElementSibling: null,
      textContent: null,
      style: { cssText: '' },
      remove: () => {},
      after: () => {}
    }),
    documentElement: { getAttribute: () => null },
    readyState: 'complete'
  }
  scope.MutationObserver = class {
    observe(): void {}
  }
  scope.addEventListener = (): void => {}
  await import('../apps/desktop/src/preload/preload')
})

beforeEach(() => {
  harness.handlers.clear()
  harness.event.frameUrl = 'dsh-app://app/'
})

describe('边界⑤：主进程 ↔ 渲染层的失败形态', () => {
  for (const surface of invokeSurfaces) {
    it(`${surface.label}：主进程失败时调用方观察到契约码与详情`, async () => {
      handleDesktopShellCall(surface.channel, () => {
        throw new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, `${surface.label} 失败。`, {
          operation: 'read',
          path: surface.label
        })
      })

      const failure = await captureFailure(surface.call)

      expect(failure).toMatchObject({
        code: ELECKOI_FAILURE_CODES.ioFailed,
        details: { operation: 'read', path: surface.label }
      })
      // 渲染层那个唯一解析点（EH-4b 的 resolveFailure）走的正是 foldFailure：码必须保住。
      expect(foldFailure(failure).code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
    })
  }

  it('不可信发送方：守卫拒绝，调用方观察到 eleckoi/sender/untrusted 与 guard 详情', async () => {
    handleDesktopShellCall(DESKTOP_SHELL_IPC.windowControl, (event) => {
      const frame = event as unknown as { sender: WebContents; frameUrl: string }
      assertTrustedDshClientFrame(frame.sender, frame.frameUrl, true, [])
    })

    const failure = await captureFailure(() => required(desktopApi().windowControls, 'windowControls').minimize())

    expect(failure).toMatchObject({
      code: ELECKOI_FAILURE_CODES.senderUntrusted,
      details: { guard: 'assertTrustedDshClientFrame', what: 'dsh-app://app/' }
    })
    expect(foldFailure(failure).code).toBe(ELECKOI_FAILURE_CODES.senderUntrusted)
  })

  it('活守卫直接抛出契约码 eleckoi/sender/untrusted 与 guard 详情', () => {
    const sender = { getURL: () => 'dsh-app://app/' } as WebContents
    let failure: unknown
    try {
      assertTrustedDshClientFrame(sender, 'dsh-app://app/', true, [])
    } catch (error) {
      failure = error
    }

    expect(foldFailure(failure)).toMatchObject({
      code: ELECKOI_FAILURE_CODES.senderUntrusted,
      details: { guard: 'assertTrustedDshClientFrame', what: 'dsh-app://app/' }
    })
  })

  it('壳内部的普通失败折成兜底码，开发者诊断文案保留', async () => {
    handleDesktopShellCall(DESKTOP_SHELL_IPC.windowControl, () => {
      throw new Error('壳内部炸了。')
    })

    const failure = await captureFailure(() => required(desktopApi().windowControls, 'windowControls').minimize())

    expect(failure).toMatchObject({ code: ELECKOI_FAILURE_CODES.internal, message: '壳内部炸了。' })
  })

  it('成功的调用原样返回载荷（失败对象只在失败时出现，不是第二套业务信封）', async () => {
    handleDesktopShellCall(DESKTOP_SHELL_IPC.browserAcquire, () => ({
      lease: 'lease-1',
      partition: 'persist:desktop-browser'
    }))

    await expect(required(desktopApi().browser, 'browser').acquire('workspace-1')).resolves.toEqual({
      lease: 'lease-1',
      partition: 'persist:desktop-browser'
    })

    handleDesktopShellCall(DESKTOP_SHELL_IPC.windowControl, () => undefined)

    await expect(required(desktopApi().windowControls, 'windowControls').minimize()).resolves.toBeUndefined()
  })
})
