import type { Context, Plugin } from '@deepseek-ai/cordis'
import { AppPaths } from '@main/platform/filesystem/AppPaths'
import { createAppLog } from '@main/platform/logging/AppLog'
import './desktopContext'

export const platformPlugin = {
  name: 'eleckoi-platform',
  provide: ['appPaths', 'appLog'],
  apply(ctx: Context) {
    ctx.provide('appPaths', new AppPaths())
    // 日志目录来自 `AppPaths`（logs 的命名只有那一个真相）；保留期与轮转在 `AppLog` 之内。
    ctx.provide('appLog', createAppLog(ctx.appPaths.logs))
  }
} satisfies Plugin.Object
