/**
 * 边界⑤ 的**宿主失败通知**（`dsh-desktop:host-failure`）送的是失败对象，不是拼好的中文句子。
 *
 * 判据来源：ADR 0002 决定 4/8（用户可见文案**只有一个解析点**，在渲染层；宿主侧不拼用户可见句子）、
 * 决定 10（诊断用 `stack` / `logPath` 指针承载）、spec 决定 8 与用户故事 6；票 EH-11 的 G 项。
 *
 * 断言的是**外部行为**：渲染层订阅到的那个值里有没有码与详情。三段是真实代码拼起来跑的：
 *
 * 1. 主进程侧的载荷构造 `desktopHostFailureNoticeOf`（`foundation/ipcFailure.ts`）；
 * 2. ③ 边界折出来的那个可记录对象 `DshPluginHostFailure`（真实类，不是用例里重写的形状）；
 * 3. 真实 preload（`contextBridge` 暴露的 `dshDesktop.host.subscribeFailure`）。
 *
 * 只有 `electron` 模块本身是桩。**改这条通道时不要退回字符串**：宿主一旦拼句子，用户就看不到
 * `code` / `details`（正是修复前的状态）。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DESKTOP_SHELL_IPC, type DshDesktopProductApi } from '@shared/contracts/desktopShell'
import { foldFailure } from '@shared/foundation/failure'
import { desktopHostFailureNoticeOf } from '@shared/foundation/ipcFailure'
import { DshPluginHostFailure } from '@eleckoi/desktop-host'

const harness = vi.hoisted(() => {
  const exposed = new Map<string, unknown>()
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>()
  return {
    exposed,
    listeners,
    ipcMain: {
      handle(): void {},
      removeHandler(): void {},
      on(): void {},
      removeListener(): void {}
    },
    ipcRenderer: {
      invoke: async (): Promise<unknown> => undefined,
      on(channel: string, handler: (event: unknown, ...args: unknown[]) => void): void {
        listeners.set(channel, handler)
      },
      off(channel: string): void {
        listeners.delete(channel)
      },
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

beforeAll(async () => {
  // preload.ts 只在 `dsh-app://app` 主框架暴露完整 API，所以这三样要照它的前提摆好。
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

/** 子进程 fatal 帧折出来的那个对象（③ 边界的真实构造点，行为见 tests/host-child-failure.test.ts）。 */
function hostFailure(): DshPluginHostFailure {
  return new DshPluginHostFailure({
    code: ELECKOI_FAILURE_CODES.ioFailed,
    message: 'DSH 插件宿主退出：1',
    stack: 'at desktopPluginHostChild.ts:42:7',
    logPath: '/tmp/eleckoi/logs/app.log'
  })
}

function desktopApi(): DshDesktopProductApi {
  const api = harness.exposed.get('dshDesktop')
  if (typeof api !== 'object' || api === null) throw new Error('preload 没有暴露 dshDesktop')
  return api as DshDesktopProductApi
}

describe('宿主失败通知送的是失败对象', () => {
  it('主进程侧的载荷保有码、参数化详情与两个诊断指针', () => {
    const notice = desktopHostFailureNoticeOf(hostFailure())

    expect(notice).toEqual({
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: 'DSH 插件宿主退出：1',
      details: {},
      stack: 'at desktopPluginHostChild.ts:42:7',
      logPath: '/tmp/eleckoi/logs/app.log'
    })
  })

  it('渲染层的解析点保住这个码，不折成兜底码', () => {
    const notice = desktopHostFailureNoticeOf(hostFailure())

    expect(foldFailure(notice).code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
    expect(foldFailure(notice).message).toBe('DSH 插件宿主退出：1')
  })

  it('拿不到诊断指针时属性整个不出现（undefined 不是可克隆的值）', () => {
    const notice = desktopHostFailureNoticeOf({
      code: ELECKOI_FAILURE_CODES.internal,
      message: '插件宿主起不来',
      details: {},
      stack: undefined,
      logPath: undefined
    })

    expect(notice).not.toHaveProperty('stack')
    expect(notice).not.toHaveProperty('logPath')
    expect(notice).toEqual({
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.internal,
      message: '插件宿主起不来',
      details: {}
    })
  })

  it('preload 把失败对象原样交给订阅者（不是字符串）', () => {
    const notice = desktopHostFailureNoticeOf(hostFailure())
    const received: unknown[] = []
    const unsubscribe = desktopApi().host?.subscribeFailure((failure) => { received.push(failure) })

    const handle = harness.listeners.get(DESKTOP_SHELL_IPC.hostFailure)
    if (handle === undefined) throw new Error('preload 没有订阅宿主失败通道')
    handle({}, notice)

    expect(received).toHaveLength(1)
    expect(typeof received[0]).toBe('object')
    expect(received[0]).toEqual(notice)
    unsubscribe?.()
    expect(harness.listeners.has(DESKTOP_SHELL_IPC.hostFailure)).toBe(false)
  })

  it('没有失败标记的推送不冒充失败（静默丢弃，不把未知值当失败对象）', () => {
    const received: unknown[] = []
    desktopApi().host?.subscribeFailure((failure) => { received.push(failure) })

    const handle = harness.listeners.get(DESKTOP_SHELL_IPC.hostFailure)
    if (handle === undefined) throw new Error('preload 没有订阅宿主失败通道')
    handle({}, '插件服务意外退出，请重新打开插件中心。')

    expect(received).toEqual([])
  })
})
