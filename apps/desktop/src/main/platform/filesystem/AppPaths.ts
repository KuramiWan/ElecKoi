import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * logs 目录的命名只有这一处真相：`AppPaths.logs` 与 bootstrap logger 都读它。
 *
 * 两条路拿不到同一个 `AppPaths` 实例：bootstrap logger 在 `main.ts` 把 `userData` 定下最终路径
 * **之前**就构造了，所以它只能在写入时用同一条命名规则重新解析（见 `AppLog.ts`）。
 * 别再往别处拼绝对路径——那会让两份「日志在哪」各说各话。
 */
export function appLogsDirectory(userData: string): string {
  return join(userData, 'logs')
}

export class AppPaths {
  readonly database: string
  readonly workspace: string
  readonly dshRuntime: string
  readonly media: string
  readonly logs: string

  constructor(readonly userData: string = app.getPath('userData')) {
    this.database = join(userData, 'eleckoi-common.sqlite3')
    this.workspace = join(userData, 'workspace')
    this.dshRuntime = join(userData, 'dsh-runtime')
    this.media = join(userData, 'media')
    this.logs = appLogsDirectory(userData)
    mkdirSync(this.workspace, { recursive: true })
    mkdirSync(this.dshRuntime, { recursive: true })
    mkdirSync(this.media, { recursive: true })
    mkdirSync(this.logs, { recursive: true })
  }

  resolveResource(...segments: string[]): string {
    const candidates = [
      join(app.getAppPath(), 'resources', ...segments),
      join(process.resourcesPath, ...segments)
    ]
    const match = candidates.find(existsSync)
    if (match === undefined) throw new Error(`缺少应用资源：apps/desktop/resources/${segments.join('/')}`)
    return match
  }
}
