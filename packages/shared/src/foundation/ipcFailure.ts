/**
 * 边界⑤（主进程 ↔ 渲染层）的失败折叠与线上判定——纯函数。
 *
 * 判据来源：ADR 0002 决定 1（每条边界一个薄适配器、统一兜底折叠）、决定 2（⑦ 任何边界都能产出
 * 同一个可记录对象）；票 EH-5 第 2 节。
 *
 * 折叠规则只有一份：`foundation/failure.ts` 的 `foldFailure`。本文件只给它套上边界⑤ 的线上标记
 * （形状见 `contracts/errors/ipc.ts` 的 `DesktopIpcFailure`），**不重写折叠**。
 *
 * 本文件是纯逻辑，不 import `electron` / `node:` / `@deepseek-ai/` / `@eleckoi/`
 * （`scripts/check-architecture.mjs` 的 product-shared 闭集规则），所以主进程与 preload 都能用它。
 */
import type { DesktopHostFailureNotice, DesktopIpcFailure } from '../contracts/errors/ipc.js'
import type { EleckoiFailureCode } from '../contracts/errors/codes.js'
import type { EleckoiFailureDetails } from '../contracts/errors/details.js'
import { foldFailure } from './failure.js'

/**
 * 任意抛出 → 边界⑤ 的线上失败对象。
 *
 * 主进程侧唯一该用的入口：把 `ipcMain.handle` 的抛出变成「跨进程带得走码与详情」的值。
 * 未知失败由 `foldFailure` 折成兜底码，不在这里猜。
 */
export function desktopIpcFailureOf(error: unknown): DesktopIpcFailure {
  const failure = foldFailure(error)
  return {
    isDSHRemoteError: true,
    code: failure.code,
    message: failure.message,
    details: failure.details
  }
}

/**
 * 线上值的判定：**只认标记，不校验码**。
 *
 * 为什么不顺手校验 `code`：标记为真就说明主进程报了一次失败，此时绝不能因为「码不认识」就把它当
 * 成功载荷交回渲染层——那会把一次失败变成一次静默成功。码不认识（例如更新的主进程发来的码）留给
 * 渲染层的唯一解析点：`foldFailure` 会折成兜底码并把原码放进 `details.what`，码不会被吞。
 */
export function hasDesktopIpcFailureMarker(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && 'isDSHRemoteError' in value && value.isDSHRemoteError === true
}

/**
 * 主进程侧：把 `ipcMain.handle` 的 handler 包成「失败以返回的对象过边界」。
 *
 * 成功原样返回载荷；**抛出**（含 async handler 返回的 promise 拒绝——更新的四个通道就是这种）就返回
 * {@link desktopIpcFailureOf} 折出来的线上对象。9 个注册点共用这一条规则，不在每个 handler 里各写
 * 一遍 try/catch。
 *
 * 做成接收 handler 的纯函数是为了能单测（`packages/shared/tests`）：折叠规则不依赖 Electron，
 * 主进程侧只剩两行接线（`apps/desktop/src/main/platform/electron/desktopIpcHandler.ts`）。
 *
 * @param handler - 原样的 `ipcMain.handle` 监听器。
 * @returns 同签名的监听器；失败时不是拒绝，而是**解析**成线上失败对象。
 */
export function wrapDesktopIpcHandler<Event, Arguments extends unknown[], Result>(
  handler: (event: Event, ...args: Arguments) => Result | PromiseLike<Result>
): (event: Event, ...args: Arguments) => Promise<Result | DesktopIpcFailure> {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args) as Result
    } catch (error) {
      return desktopIpcFailureOf(error)
    }
  }
}

/**
 * preload 侧：带失败标记就把它**抛出去**，否则什么也不做。
 *
 * 抛的就是线上对象本身，不重新包成 `Error`：渲染层的 `foldFailure` 认 `isDSHRemoteError` 标记，
 * 码与详情原样到场；换回 `Error` 反而过不了 contextBridge（`Error` 的自定义属性会丢，见
 * `contracts/errors/ipc.ts` 文件头）。
 *
 * @param value - preload 那次 `invoke` 拿到的原样返回值。
 */
export function throwIfDesktopIpcFailure(value: unknown): void {
  if (hasDesktopIpcFailureMarker(value)) throw value
}

/**
 * preload 侧：把一次 `invoke`（或任何返回线上值的回调）解包成「失败时抛、成功时原样返回」。
 *
 * @param invoke - 真正跨边界的那次调用（传回调是为了让本函数保持纯函数、能被单测）。
 * @returns 成功载荷。
 */
export async function unwrapDesktopIpcResult<Result>(invoke: () => Promise<Result>): Promise<Result> {
  const value = await invoke()
  throwIfDesktopIpcFailure(value)
  return value
}

/**
 * 主进程侧**已经折过**的失败对象（`DshPluginHostFailure` 的结构形状）。
 *
 * 不用现成的 {@link desktopIpcFailureOf}：那条路会再折一次，而这个对象的 `name` 既不是
 * `DesktopError`、也没有 `isDSHRemoteError` 标记，再折会把 ③ 边界折好的码与详情整条丢成兜底。
 */
export interface DesktopHostFailureNoticeSource {
  readonly code: EleckoiFailureCode
  readonly message: string
  readonly details: EleckoiFailureDetails
  /** 子进程侧的 stack；拿不到就是 `undefined`（`Error` 的 `stack` 也是可选属性）。 */
  readonly stack?: string | undefined
  /** 宿主本机日志文件指针（宿主收到 fatal 帧后自己记录；子进程不填）；拿不到就是 `undefined`。 */
  readonly logPath?: string | undefined
}

/**
 * 主进程侧的失败对象 → 边界⑤ 的**宿主失败通知**载荷。
 *
 * **不折码、不拼句子**：`code` 是 ③ 边界按契约码表折过的结果（码表外的原码那时已经进了
 * `details.what`），这里只把它搬到可结构化克隆的自有属性上；`message` 是开发者诊断。
 * 拼用户可见文案是渲染层唯一解析点的事（ADR 决定 4/8/9）。
 *
 * `stack` 来自子进程、`logPath` 是宿主收到 fatal 帧后自己记录的本机日志指针（ADR 决定 10），
 * 有就带上；`undefined` 不能出现在过边界的对象上，所以拿不到的属性整个不写。
 *
 * @param failure - 子进程失败在宿主侧的那个可记录对象。
 * @returns 线上载荷（普通对象 + 官方失败标记）。
 */
export function desktopHostFailureNoticeOf(failure: DesktopHostFailureNoticeSource): DesktopHostFailureNotice {
  return {
    isDSHRemoteError: true,
    code: failure.code,
    message: failure.message,
    details: failure.details,
    ...(failure.stack === undefined ? {} : { stack: failure.stack }),
    ...(failure.logPath === undefined ? {} : { logPath: failure.logPath })
  }
}
