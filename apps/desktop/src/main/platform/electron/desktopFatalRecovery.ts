import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'

interface RecoveryOperations {
  show(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  stop(): Promise<void>
  disableUserPlugins(): Promise<void>
  restart(): void
  exit(): void
  diagnostic(error: unknown): void
}

function diagnosticText(error: unknown): string {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  return error instanceof AggregateError ? [message, ...error.errors.map(diagnosticText)].join('\n') : message
}

/** Native recovery stays usable when the Host or the client plugin tree cannot start. */
export class DesktopFatalRecovery {
  private task: Promise<void> | undefined

  constructor(private readonly operations: RecoveryOperations) {}

  report(error: unknown): Promise<void> {
    return this.task ??= this.recover(error)
  }

  private async recover(error: unknown): Promise<void> {
    let failure = error
    for (;;) {
      this.operations.diagnostic(failure)
      const detail = diagnosticText(failure)
      const { response } = await this.operations.show({
        type: 'error', title: 'ElecKoi 运行失败', message: 'ElecKoi 无法正常运行',
        detail: `${detail}\n\n停用用户插件会保留 ElecKoi 内置插件、已安装的插件包及聊天数据，并备份用户插件配置。`,
        buttons: ['退出', '重启', '停用用户插件并重启'], defaultId: 1, cancelId: 0, noLink: true
      })
      try {
        await this.operations.stop()
        if (response === 0) { this.operations.exit(); return }
        if (response === 2) await this.operations.disableUserPlugins()
        this.operations.restart()
        return
      } catch (next) {
        if (response === 0) { this.operations.diagnostic(next); this.operations.exit(); return }
        failure = next
      }
    }
  }
}
