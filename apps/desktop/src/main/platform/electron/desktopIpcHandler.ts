import { ipcMain } from 'electron'
import { wrapDesktopIpcHandler } from '@shared/foundation/ipcFailure'

/**
 * 边界⑤ 主进程侧的**Electron 胶水**：注册一条请求/响应通道，handler 的抛出折成线上失败对象。
 *
 * 折叠与判定都是纯函数（`@shared/foundation/ipcFailure` 的 `wrapDesktopIpcHandler`），这里只做
 * Electron 类型接线。不要在每个 handler 里各写一遍 try/catch——那会让「失败怎么过边界」有 9 份
 * 副本。preload 侧的对偶是 `invokeOrFail`（`apps/desktop/src/preload/preload.ts`）。
 *
 * 只做翻译，不做第二套业务信封（ADR 0017 决定 7）：成功的返回值原样透传；失败时返回
 * `{ isDSHRemoteError, code, message, details }`（形状见 `contracts/errors/ipc.ts`）。
 */
export type DesktopIpcCallHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * 注册一条请求/响应通道。
 *
 * @param channel - 通道名（壳自己的最小集合，不新增通道）。
 * @param handler - 原样的 `ipcMain.handle` 监听器。
 */
export function handleDesktopIpcCall(channel: string, handler: DesktopIpcCallHandler): void {
  ipcMain.handle(channel, wrapDesktopIpcHandler(handler))
}
