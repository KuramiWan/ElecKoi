import { Service, type Context } from '@deepseek-ai/cordis'
import type { ConversationRuntimePreparation, ConversationRuntimeStateSnapshot } from './types.js'

/** 正文和产品变量已保存时传给插件的本轮信息，不持久记录执行状态。 */
export interface ConversationSave {
  readonly operationId: string
  readonly conversationId: string
  readonly runtimeSessionId: string
  readonly turn: number
}

/** 生成开始前已经确定的角色资料，保留设定库的完整配置。 */
export interface ConversationPreparation {
  readonly operationId: string
  readonly conversationId: string
  readonly runtimeSessionId: string
  readonly turn: number
  readonly text: string
  readonly model: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  readonly runtime: Readonly<ConversationRuntimePreparation>
}

/** 删除或重新生成时需要恢复的位置。 */
export interface ConversationRestore {
  readonly operationId: string
  readonly conversationId: string
  readonly runtimeSessionId: string
  readonly reason: 'delete-messages' | 'regenerate'
  readonly fromTurn: number
  readonly fromEventSeq: number
  readonly state: Readonly<ConversationRuntimeStateSnapshot>
}

/** 插件准备好自己的恢复方案，失败时能够还原操作之前的状态。 */
export interface ConversationRestorePlan {
  apply(): void | Promise<void>
  rollback(): void | Promise<void>
}

/** Host 插件参与正式聊天；回调必须等待自己的工作完成。 */
export interface ConversationLifecycleParticipant {
  readonly id: string
  prepare?(input: ConversationPreparation, signal: AbortSignal): void | Promise<void>
  afterSave?(input: ConversationSave, signal: AbortSignal): void | Promise<void>
  prepareRestore?(input: ConversationRestore, signal: AbortSignal): ConversationRestorePlan | Promise<ConversationRestorePlan>
}

interface ParticipantEntry {
  participant: ConversationLifecycleParticipant
  abort: AbortController
  pending: Set<Promise<unknown>>
}

/** 按 Cordis 插件生命周期管理聊天参与者，不管理 Agent 分工或模型路由。 */
export class ElecKoiConversationLifecycle extends Service {
  static inject = ['eleckoiProductData']
  private readonly participants = new Map<string, ParticipantEntry>()
  private readonly current = new Map<string, { input: ConversationSave; pending?: Promise<void>; settled: boolean }>()
  private readonly busyConversations = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'eleckoiConversationLifecycle')
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.current.values()].map(entry => entry.pending))
      this.current.clear()
    })
  }

  /** @internal 同一聊天的准备和编辑互斥，其他聊天独立运行。 */
  async exclusive<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    if (this.busyConversations.has(conversationId)) throw new Error('当前聊天正在准备生成或处理消息，请稍后重试。')
    this.busyConversations.add(conversationId)
    try { return await operation() } finally { this.busyConversations.delete(conversationId) }
  }

  /**
   * 注册生成准备、保存收尾和回退处理，停用插件时自动取消并等待正在执行的回调。
   * @param participant - 插件编号和需要参与的处理函数。
   * @returns 注销当前注册项的函数；插件卸载也会自动注销。
   */
  register(participant: ConversationLifecycleParticipant): () => void {
    if (!participant.id?.trim() || this.participants.has(participant.id)) throw new Error('聊天参与插件编号为空或重复。')
    const entry: ParticipantEntry = { participant: { ...participant }, abort: new AbortController(), pending: new Set() }
    return this.ctx.effect(() => {
      this.participants.set(participant.id, entry)
      return async () => {
        if (this.participants.get(participant.id) === entry) this.participants.delete(participant.id)
        entry.abort.abort(new Error('聊天参与插件已停用。'))
        await Promise.allSettled([...entry.pending])
      }
    })
  }

  /** @internal 在产品资料写入当前请求之前等待所有参与者。 */
  async prepare(input: ConversationPreparation, signal?: AbortSignal): Promise<void> {
    for (const entry of [...this.participants.values()]) {
      await this.invoke(entry, current => entry.participant.prepare?.(structuredClone(input), current), signal)
    }
  }

  /** @internal 正文及变量保存完成后等待插件。 */
  async afterSave(input: ConversationSave): Promise<void> {
    for (const entry of [...this.participants.values()]) {
      await this.invoke(entry, signal => entry.participant.afterSave?.(structuredClone(input), signal))
    }
  }

  /** @internal 先准备全部插件，再进入已有 Session 编辑流程；失败按相反顺序还原。 */
  async restore(input: ConversationRestore, operation: () => Promise<void>): Promise<void> {
    const plans: Array<{ entry: ParticipantEntry; plan: ConversationRestorePlan }> = []
    try {
      for (const entry of [...this.participants.values()]) {
        if (entry.participant.prepareRestore) {
          const plan = await this.invoke(entry, signal => entry.participant.prepareRestore!(structuredClone(input), signal))
          if (!plan || typeof plan.apply !== 'function' || typeof plan.rollback !== 'function') throw new Error(`插件 ${entry.participant.id} 没有提供完整的回退处理。`)
          plans.push({ entry, plan })
        }
      }
      for (const { entry, plan } of plans) await this.invoke(entry, () => plan.apply())
      await operation()
    } catch (error) {
      const failures: unknown[] = [error]
      for (const { plan } of plans.reverse()) {
        try { await plan.rollback() } catch (rollbackError) { failures.push(rollbackError) }
      }
      if (failures.length > 1) throw new AggregateError(failures, '聊天回退失败，部分插件未能恢复；请检查插件状态。')
      throw error
    }
  }

  /** @internal 每条聊天只保留当前操作，下一次准备替换，删除聊天及 Host 卸载清空。 */
  begin(input: ConversationSave): void {
    const previous = this.current.get(input.conversationId)
    if (previous?.pending && !previous.settled) throw new Error('当前聊天尚未完成保存或插件收尾。')
    this.current.set(input.conversationId, { input: { ...input }, settled: false })
  }

  /** @internal 仅接收本进程已准备的操作及正式轮次，不从旧请求文件恢复完成状态。 */
  matches(conversationId: string, operationId: string, turn: number): boolean {
    const entry = this.current.get(conversationId)
    return entry?.input.operationId === operationId && entry.input.turn === turn
  }

  /** @internal Session 通知只安排工作；同一当前操作只保存一次。 */
  track(conversationId: string, operationId: string, operation: () => Promise<void>): void {
    const entry = this.current.get(conversationId)
    if (!entry || entry.input.operationId !== operationId) throw new Error('本次生成没有对应的准备过程。')
    if (entry.pending) return
    const pending = Promise.resolve().then(operation).finally(() => { entry.settled = true })
    entry.pending = pending
    void pending.catch(error => this.ctx.logger.error(`聊天保存或插件收尾失败：${String(error)}`))
  }

  /** @internal 等待当前进程本轮收尾，失败传给调用方；不提供历史结果查询。 */
  async wait(conversationId: string, operationId: string): Promise<void> {
    const entry = this.current.get(conversationId)
    if (!entry || entry.input.operationId !== operationId) throw new Error('本次生成的等待信息已不存在，请使用当前生成流程。')
    if (!entry.pending) throw new Error('本轮尚未进入保存流程，请先等待 DSH 运行结束。')
    await entry.pending
  }

  /** @internal 等待上一轮结束后允许重试；原失败已经通过调用结果和变更事件报告。 */
  async drain(conversationId: string): Promise<void> {
    await this.current.get(conversationId)?.pending?.catch(() => undefined)
  }

  /** @internal 删除聊天后释放本进程当前操作，调用前等待正在收尾的工作。 */
  forget(conversationId: string): void {
    this.current.delete(conversationId)
  }

  private async invoke<T>(entry: ParticipantEntry, callback: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    const effective = signal ? AbortSignal.any([entry.abort.signal, signal]) : entry.abort.signal
    effective.throwIfAborted()
    const pending = Promise.resolve().then(() => callback(effective))
    entry.pending.add(pending)
    try {
      const result = await pending
      effective.throwIfAborted()
      return result
    } finally { entry.pending.delete(pending) }
  }
}
