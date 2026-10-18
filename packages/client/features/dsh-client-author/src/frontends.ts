import type { Context } from '@deepseek-ai/cordis'
import type {} from '@eleckoi/dsh-product-api/remote'
import type { FrontendOwner, FrontendWorkspace } from '@eleckoi/dsh-product-api/frontends'
import { productFailure, ELECKOI_FAILURE_CODES } from '@eleckoi/dsh-product-api'

type Remote = Context['remote']['eleckoiAuthorFrontends']
type Watch = { start(): void; close(): void }

/** Native file projects use the generated Remote, independently of chat/script readiness. */
export class NativeFrontendClient {
  private readonly watchers = new Set<Watch>()
  private closed = false
  constructor(readonly projects: Remote) {}

  /** 订阅明确工作区的最新状态，串行重读并释放旧连接。
   * @param owner - 应用或明确角色的工作区。
   * @param listener - 最新状态回调。
   * @param onError - 未取消的读取或连接错误。
   * @returns 取消订阅函数。
   */
  watch(owner: FrontendOwner, listener: (workspace: FrontendWorkspace) => void, onError: (error: unknown) => void): () => void {
    if (this.closed) throw productFailure(ELECKOI_FAILURE_CODES.lifecycleDisposed, 'Native frontend service is closed', { what: '原生前端服务' })
    const fixedOwner = structuredClone(owner)
    let stopped = false, abort: AbortController | undefined
    const watch: Watch = {
      start: () => {
        abort?.abort(new Error('Frontend connection reset'))
        const generation = new AbortController(); abort = generation
        let requested = -1, accepted = -1, reading: Promise<void> | undefined
        const current = () => !stopped && !this.closed && !generation.signal.aborted && abort === generation
        const read = () => {
          if (reading) return
          let failed = false
          reading = (async () => {
            while (current() && requested > accepted) {
              const result = await this.projects.workspace(fixedOwner)
              if (!current()) return
              if (!result.ok) throw result.error
              const workspace = result.value
              if (workspace.scope !== fixedOwner.scope || fixedOwner.scope === 'character' && workspace.characterId !== fixedOwner.characterId) throw productFailure(ELECKOI_FAILURE_CODES.stateMismatch, 'Frontend workspace owner mismatch', { what: '前端工作区的归属' })
              if (workspace.revision < accepted) throw productFailure(ELECKOI_FAILURE_CODES.stateMismatch, 'Frontend workspace revision decreased', { what: '前端工作区的修订号' })
              accepted = workspace.revision; listener(workspace)
            }
          })().catch(error => { failed = true; if (current()) onError(error) }).finally(() => {
            reading = undefined
            if (!failed && current() && requested > accepted) read()
          })
        }
        const stream = this.projects.changes(fixedOwner, generation.signal)
        void (async () => {
          try {
            for await (const change of stream) {
              if (!current()) return
              requested = Math.max(requested, change.revision); read()
            }
            if (current()) throw productFailure(ELECKOI_FAILURE_CODES.lifecycleDisposed, 'Native frontend changes stream ended', { what: '原生前端变更流' })
          } catch (error) { if (current()) onError(error) }
          finally { await stream.dispose() }
        })().catch(error => { if (current()) onError(error) })
      },
      close: () => { stopped = true; abort?.abort(new Error('Frontend workspace released')); this.watchers.delete(watch) },
    }
    this.watchers.add(watch)
    try { watch.start() } catch (error) { watch.close(); throw error }
    return watch.close
  }

  /** @internal */
  reset(): void { if (!this.closed) for (const watcher of this.watchers) watcher.start() }
  /** @internal */
  dispose(): void { this.closed = true; for (const watcher of this.watchers) watcher.close() }
}
