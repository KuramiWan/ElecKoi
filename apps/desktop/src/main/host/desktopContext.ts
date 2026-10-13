import type { Context } from '@deepseek-ai/cordis'
import type { Logger } from 'pino'
// 类型从组合根转出：产品侧文件不能直接引用桌面宿主包（check:architecture 的规则）。
import type { DshPluginHostFailure } from './dshHostPlugin'
import type { ElectronWindowHost } from '@main/platform/electron/ElectronWindowHost'
import type { AppPaths } from '@main/platform/filesystem/AppPaths'
import type { UpdateService } from '@main/modules/updates'

declare module '@deepseek-ai/cordis' {
  interface Context {
    appPaths: AppPaths
    appLog: Logger
    pluginHost: {
      start(): Promise<{ url: string; injections: readonly unknown[] }>
      frontendDirectory(): string
      updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean>
      /** 插件宿主失败出口。给的是可记录对象（`code` / `message` / `details` / `stack` / `logPath`），不是裸 Error。 */
      onFailure(listener: (failure: DshPluginHostFailure) => void): () => void
    }
    electronWindows: ElectronWindowHost
    updates: UpdateService
  }
}

export type DesktopContext = Context
