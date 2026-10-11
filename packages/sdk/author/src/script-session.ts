import { installElecKoiAuthorApi, type AuthorApiWindow, type AuthorHostAdapter } from './browser'
import { AuthorApiError } from './errors'
import { AuthorVariableRuleRegistry, type AuthorVariableRuleRun } from './rule-registry'
import type { AuthorScriptDescriptor, AuthorScriptProgram, AuthorVariableRuleStage } from './scripts'
import { serializeAuthorJsonObject } from './json'

export interface AuthorScriptFrame {
  window: AuthorApiWindow
  load(source: string, signal: AbortSignal): Promise<AuthorScriptProgram>
  dispose(): void
}
export interface AuthorScriptStatus { key: string; id: string; status: 'starting' | 'running' | 'error' | 'stopped'; error: string }
export interface AuthorScriptSessionOptions {
  conversationId: string
  scripts: readonly AuthorScriptDescriptor[]
  createFrame(script: AuthorScriptDescriptor): AuthorScriptFrame
  adapter(script: AuthorScriptDescriptor): AuthorHostAdapter
  status(value: AuthorScriptStatus): void
}

/** One catalog generation owns its frames, registrations and uncommitted candidates. */
export class AuthorScriptSession {
  private readonly lifetime = new AbortController()
  private readonly registry = new AuthorVariableRuleRegistry()
  private readonly frames: Array<{ frame: AuthorScriptFrame; script: AuthorScriptDescriptor; cleanup?: () => void | Promise<void> }> = []
  private readonly runs = new Map<string, { controller: AbortController; run: AuthorVariableRuleRun; stage: AuthorVariableRuleStage }>()
  private ready = false
  private readonly failed = new Set<string>()
  private closing: Promise<void> | undefined

  private readonly options: AuthorScriptSessionOptions

  constructor(options: AuthorScriptSessionOptions) {
    this.options = { ...options, scripts: structuredClone(options.scripts) }
  }

  async start(): Promise<void> {
    if (this.ready || this.frames.length) throw new AuthorApiError('SCRIPT_ALREADY_STARTED', '这份脚本配置已经启动')
    try {
      for (const script of this.options.scripts) {
        this.lifetime.signal.throwIfAborted()
        this.options.status({ key: script.key, id: script.id, status: 'starting', error: '' })
        try {
          const frame = this.options.createFrame(script), entry: typeof this.frames[number] = { script, frame }
          this.frames.push(entry)
          const adapter = this.options.adapter(script)
          const api = installElecKoiAuthorApi(frame.window, { ...adapter,
            registerVariableRule: rule => this.registry.register(script.key, frame.window, rule) })
          const program = await awaitStartup(frame.load(script.source, this.lifetime.signal), this.lifetime.signal)
          this.lifetime.signal.throwIfAborted()
          if (typeof program !== 'function') throw new AuthorApiError('INVALID_SCRIPT_MODULE', '原生脚本需要 export default 启动函数')
          const cleanup = await awaitStartup(Promise.resolve(program({ api, signal: this.lifetime.signal,
            get settings() { return structuredClone(script.settings) },
            get librarySettings() { return structuredClone(script.librarySettings) },
            scope: script.scope, ownerId: script.ownerId, scriptId: script.id })), this.lifetime.signal, lateCleanup => {
              if (typeof lateCleanup === 'function') Promise.resolve().then(lateCleanup).catch(error => {
                frame.window.console.error(`原生脚本停用后的清理失败：${script.key}`, error)
              })
            })
          if (cleanup !== undefined && typeof cleanup !== 'function') throw new AuthorApiError('INVALID_SCRIPT_CLEANUP', '脚本启动函数只返回清理函数或不返回值')
          if (typeof cleanup === 'function') entry.cleanup = cleanup
          this.lifetime.signal.throwIfAborted()
          this.options.status({ key: script.key, id: script.id, status: 'running', error: '' })
        } catch (error) {
          if (!this.lifetime.signal.aborted) {
            this.failed.add(script.key)
            this.options.status({ key: script.key, id: script.id, status: 'error', error: error instanceof Error ? error.message : String(error) })
          }
          throw error
        }
      }
      this.ready = true
    } catch (error) {
      try { await this.close() }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], '原生脚本启动与清理均失败') }
      throw error
    }
  }

  updateSettings(updates: readonly Pick<AuthorScriptDescriptor, 'key' | 'settings' | 'librarySettings'>[]): void {
    this.lifetime.signal.throwIfAborted()
    if (updates.length !== this.options.scripts.length || new Set(updates.map(item => item.key)).size !== updates.length
      || updates.some(item => !this.options.scripts.some(script => script.key === item.key))) {
      throw new AuthorApiError('SCRIPT_CATALOG_CHANGED', '设置更新不属于当前运行脚本')
    }
    const changed = updates.some(item => {
      const script = this.options.scripts.find(script => script.key === item.key)!
      return JSON.stringify([script.settings, script.librarySettings]) !== JSON.stringify([item.settings, item.librarySettings])
    })
    if (!changed) return
    for (const id of this.runs.keys()) this.cancel(id)
    for (const item of updates) {
      const script = this.options.scripts.find(script => script.key === item.key)!
      script.settings = structuredClone(item.settings); script.librarySettings = structuredClone(item.librarySettings)
    }
  }

  async apply(runId: string, stage: AuthorVariableRuleStage, stateJson: string, beforeJson: string): Promise<string> {
    if (!this.ready || this.lifetime.signal.aborted) throw new AuthorApiError('SCRIPT_NOT_READY', '原生作者脚本尚未启动完成')
    let entry = this.runs.get(runId)
    if (stage === 'before') {
      if (entry) throw new AuthorApiError('VARIABLE_RULE_DUPLICATED', '同一候选不能重复执行作者规则')
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
      entry = { controller, stage, run: this.registry.open(this.options.conversationId, signal) }
      this.runs.set(runId, entry)
    } else if (!entry || stage !== (entry.stage === 'before' ? 'after' : entry.stage === 'after' ? 'afterSchema' : undefined)) {
      throw new AuthorApiError('VARIABLE_RULE_ORDER', '变量规则任务不属于当前处理阶段')
    }
    try {
      entry.stage = stage
      const result = await entry.run.apply(stage, objectJson(stateJson), objectJson(beforeJson))
      const json = serializeAuthorJsonObject(result, this.frames.map(({ frame }) => (frame.window as AuthorApiWindow & { Object: typeof Object }).Object.prototype))
      if (stage === 'afterSchema') this.cancel(runId)
      return json
    } catch (error) { this.cancel(runId); throw error }
  }

  cancel(runId: string): void {
    const entry = this.runs.get(runId)
    if (!entry) return
    this.runs.delete(runId); entry.controller.abort(new AuthorApiError('VARIABLE_RULE_CANCELLED', '本次变量处理已经取消')); entry.run.close()
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.ready = false; this.lifetime.abort(new AuthorApiError('SCRIPT_CLOSED', '原生作者脚本已停用'))
    for (const id of this.runs.keys()) this.cancel(id)
    this.registry.close()
    const frames = this.frames.splice(0)
    const failures: unknown[] = []
    for (const { frame, script } of frames) {
      try { frame.window.dispatchEvent(new frame.window.CustomEvent('pagehide')) }
      catch (error) {
        failures.push(error); this.failed.add(script.key)
        this.options.status({ key: script.key, id: script.id, status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
    this.closing = Promise.resolve().then(async () => {
      for (const { script, frame, cleanup } of frames.reverse()) {
        try {
          await cleanup?.()
          if (!this.failed.has(script.key)) this.options.status({ key: script.key, id: script.id, status: 'stopped', error: '' })
        } catch (error) {
          failures.push(error)
          this.options.status({ key: script.key, id: script.id, status: 'error', error: error instanceof Error ? error.message : String(error) })
        } finally {
          try { frame.dispose() }
          catch (error) {
            failures.push(error)
            this.options.status({ key: script.key, id: script.id, status: 'error', error: error instanceof Error ? error.message : String(error) })
          }
        }
      }
      if (failures.length) throw new AggregateError(failures, '原生脚本清理失败')
    })
    return this.closing
  }
}

function awaitStartup<T>(promise: Promise<T>, signal: AbortSignal, lateResult?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let cancelled = false
    const cancel = () => { cancelled = true; reject(signal.reason) }
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
    promise.then(value => {
      signal.removeEventListener('abort', cancel)
      if (cancelled) lateResult?.(value)
      else resolve(value)
    }, error => { signal.removeEventListener('abort', cancel); reject(error) })
  })
}

function objectJson(json: string): Record<string, unknown> {
  const state: unknown = JSON.parse(json)
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new AuthorApiError('INVALID_RULE_STATE', '变量规则候选必须是 JSON 对象')
  return state as Record<string, unknown>
}
