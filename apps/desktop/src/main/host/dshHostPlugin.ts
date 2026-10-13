import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { app, session } from 'electron'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { DshDesktopPluginHost, resolveDshWebFrontendDirectory, type DshPluginHostFailure } from '@eleckoi/desktop-host'
import { resolveDshSystemProxyEnvironment } from '@main/platform/electron/systemProxy'

// 组合根转出失败对象的类型。产品侧文件（`host/desktopContext.ts` 的 Context 声明）不能直接提
// 桌面宿主包名——`check:architecture` 只允许组合根引用它——所以类型从这里转出。
export type { DshPluginHostFailure } from '@eleckoi/desktop-host'

const require = createRequire(import.meta.url)

export const dshHostPlugin = {
  name: 'eleckoi-dsh-host',
  inject: ['appPaths', 'appLog'],
  provide: 'pluginHost',
  apply(ctx: Context) {
    const failureListeners = new Set<(failure: DshPluginHostFailure) => void>()
    const packageManager = app.isPackaged
      ? {
          entryPath: join(process.resourcesPath, 'dsh', 'pnpm', 'bin', 'pnpm.mjs'),
          nodeBinPath: join(process.resourcesPath, 'dsh', 'node-bin')
        }
      : {
          entryPath: join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'),
          nodeBinPath: ctx.appPaths.resolveResource('dsh', 'node-bin')
        }
    const host = new DshDesktopPluginHost({
      runtimeDataRoot: ctx.appPaths.dshRuntime,
      workspaceRoot: ctx.appPaths.workspace,
      productDatabasePath: ctx.appPaths.database,
      productMediaRoot: ctx.appPaths.media,
      presetTemplatePath: ctx.appPaths.resolveResource('dsh', 'agent-preset-template', 'agent.cordis.yml'),
      agentPatchPath: ctx.appPaths.resolveResource('dsh', 'desktop-agent.patch.yml'),
      executablePath: process.execPath,
      packageManager,
      // 子进程 stdout/stderr 的每一段输出都进宿主已有的 logger（此前 onDiagnostic 没人接，
      // 读出来就丢）。文件输出与保留期是 EH-7 的活，这里只保证「进了同一个 logger」。
      onDiagnostic(diagnostic) {
        ctx.appLog.info({ diagnostic }, 'DSH plugin Host diagnostic')
      },
      onFailure(failure) {
        // 失败码、诊断指针与详情都要落进日志：用户故事 6 要的「日志里有子进程的诊断输出和失败码」
        // 就在这一行（此前只记了个拿不到码的 Error）。
        ctx.appLog.error({
          code: failure.code,
          message: failure.message,
          stack: failure.stack,
          logPath: failure.logPath,
          details: failure.details
        }, 'DSH plugin Host exited unexpectedly')
        for (const listener of failureListeners) listener(failure)
      }
    })
    ctx.provide('pluginHost', {
      async start() {
        const proxyEnvironment = await resolveDshSystemProxyEnvironment(
          url => session.defaultSession.resolveProxy(url),
          process.env,
          message => ctx.appLog.warn(message)
        )
        return host.start(proxyEnvironment)
      },
      frontendDirectory: resolveDshWebFrontendDirectory,
      updateTasks: (action) => host.updateTasks(action),
      onFailure(listener) {
        failureListeners.add(listener)
        return () => { failureListeners.delete(listener) }
      }
    })
    return () => host.close()
  }
} satisfies Plugin.Object
