import { ipcMain } from 'electron'
import { desktopIpcFailureOf } from '@shared/foundation/ipcFailure'

/**
 * 边界⑤ 主进程侧的**薄适配器**：把壳自己的 IPC 通道的 handler 失败折成线上失败对象。
 *
 * 判据来源：`contracts/errors/boundaries.ts` 的 ⑤ 行（adapter 落点、`carries` 是「结构化克隆的失败对象」）
 * 与票 EH-5 第 2 节。今天 `ipcMain.handle` 的 handler 抛出时，渲染层的 `invoke` 拒绝只剩 Electron
 * 包装的文案，`code`/`details` 不随行（`notes/eh-explore-renderer.md` §6.3）——这个包装改成
 * 「返回失败对象」，由 preload 侧把它变成拒绝。
 *
 * 只做翻译，不做第二套业务信封（ADR 0017 决定 7）：成功的返回值原样透传。
 * 通道仍是壳自己那 9 条 invoke 通道，名字与语义不变，**不新增通道**。
 */
export type DesktopShellCallHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** 注册一条壳 IPC 通道；handler 的抛出不会丢码（形状见 `contracts/errors/ipc.ts`）。 */
export function handleDesktopShellCall(channel: string, handler: DesktopShellCallHandler): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try {
      return await handler(event, ...args)
    } catch (error) {
      return desktopIpcFailureOf(error)
    }
  })
}
