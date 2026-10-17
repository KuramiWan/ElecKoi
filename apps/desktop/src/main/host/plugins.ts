import type { Context, Plugin } from '@deepseek-ai/cordis'
import { AppPaths } from '@main/platform/filesystem/AppPaths'
import { createAppLog } from '@main/platform/logging/AppLog'
import './desktopContext'

export const platformPlugin = {
  name: 'eleckoi-platform',
  provide: ['appPaths', 'appLog'],
  apply(ctx: Context) {
    const appPaths = new AppPaths()
    ctx.provide('appPaths', appPaths)
    // 落盘目录从 AppPaths 的 userData 算：启动配置可能改写 app.setPath('userData')，
    // 所以在平台插件里建日志，而不是在 main.ts 顶部自己读 app.getPath。
    ctx.provide('appLog', createAppLog(appPaths.userData))
  }
} satisfies Plugin.Object
