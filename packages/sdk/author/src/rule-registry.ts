import { runWithAuthorVariableTransaction, type AuthorApiWindow } from './browser'
import { AuthorApiError } from './errors'
import type { AuthorVariableRule, AuthorVariableRuleStage } from './scripts'
import type { AuthorVariableState } from './variables'

interface Registration { owner: string; window: AuthorApiWindow; rule: AuthorVariableRule }

export interface AuthorVariableRuleRun {
  apply(stage: AuthorVariableRuleStage, state: AuthorVariableState, before: AuthorVariableState): Promise<AuthorVariableState>
  close(): void
}

/** Registrations are pinned for the entire candidate update, including asynchronous work. */
export class AuthorVariableRuleRegistry {
  private readonly registrations = new Map<string, Registration>()
  private readonly active = new Set<AbortController>()
  private revision = 0
  private closed = false

  register(owner: string, window: AuthorApiWindow, rule: AuthorVariableRule): () => void {
    if (this.closed) throw new AuthorApiError('RULES_UNAVAILABLE', '作者变量规则服务已经关闭')
    const key = JSON.stringify([owner, rule.id])
    if (this.registrations.has(key)) throw new AuthorApiError('RULE_ID_CONFLICT', `同一脚本内的变量规则编号重复：${rule.id}`)
    const registration = { owner, window, rule: { ...rule } }
    this.registrations.set(key, registration); this.changed()
    return () => {
      if (this.registrations.get(key) !== registration) return
      this.registrations.delete(key); this.changed()
    }
  }

  open(conversationId: string, signal: AbortSignal): AuthorVariableRuleRun {
    if (this.closed) throw new AuthorApiError('RULES_UNAVAILABLE', '作者变量规则服务已经关闭')
    signal.throwIfAborted()
    const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
    this.active.add(controller)
    const revision = this.revision, rules = [...this.registrations.values()]
    let closed = false
    const check = () => {
      controller.signal.throwIfAborted()
      if (closed || this.closed || revision !== this.revision) throw new AuthorApiError('VARIABLE_RULE_CHANGED', '处理期间作者脚本或规则已经变化，请重新读取后重试')
    }
    return {
      apply: async (stage, state, before) => {
        check()
        let working = structuredClone(state)
        for (const { window, rule } of rules) {
          if (rule.stage !== stage) continue
          check()
          const context = { conversationId, stage, state: working, before: structuredClone(before), signal: controller.signal }
          const transaction = { conversationId, signal: controller.signal,
            getState: () => context.state, setState: (value: AuthorVariableState) => { context.state = value } }
          await awaitRule(runWithAuthorVariableTransaction(window, transaction, async () => {
            const result = await rule.run(context)
            if (result !== undefined) throw new AuthorApiError('INVALID_RULE_RESULT', `变量规则 ${rule.id} 应修改 context.state，不返回另一个结果`)
          }), controller.signal)
          check(); working = context.state
        }
        check(); return working
      },
      close: () => {
        if (closed) return
        closed = true; controller.abort(new AuthorApiError('VARIABLE_RULE_CLOSED', '本次变量处理已经结束'))
        signal.removeEventListener('abort', cancel); this.active.delete(controller)
      },
    }
  }

  private changed(): void {
    this.revision++
    for (const controller of this.active) controller.abort(new AuthorApiError('VARIABLE_RULE_CHANGED', '处理期间作者脚本或规则已经变化，请重新读取后重试'))
  }

  close(): void {
    if (this.closed) return
    this.closed = true; this.registrations.clear(); this.changed()
  }
}

function awaitRule<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}
