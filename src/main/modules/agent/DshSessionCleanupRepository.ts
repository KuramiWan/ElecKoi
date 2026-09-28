import { randomUUID } from 'node:crypto'
import type { ConversationDeleteCleanup, MessageRepository } from '@main/modules/conversations'
import type { SqliteDatabase } from '@main/platform/sqlite/SqliteDatabase'
import type { AgentRuntimePort } from '@shared/contracts/agent/runtime'

const kind = 'dsh_conversation_session'

/** Persist log cleanup with the conversation deletion so interrupted cleanup can resume on startup. */
export class DshSessionCleanupRepository implements ConversationDeleteCleanup {
  private draining: Promise<void> | undefined

  constructor(
    private readonly store: SqliteDatabase,
    private readonly messages: Pick<MessageRepository, 'runtimeThreadIdsForDeletion'>,
    private readonly runtime: Pick<AgentRuntimePort, 'disposeConversation'>
  ) {}

  enqueue(conversationId: string): void {
    const targetId = JSON.stringify({
      conversationId,
      runtimeThreadIds: this.messages.runtimeThreadIdsForDeletion(conversationId)
    })
    const now = Date.now()
    this.store.native.prepare(`INSERT OR IGNORE INTO cleanup_operations(
      id,kind,targetId,state,attemptCount,createdAtEpochMs,updatedAtEpochMs,lastError
    ) VALUES (?,?,?,'queued',0,?,?,'')`).run(randomUUID(), kind, targetId, now, now)
  }

  drain(): void {
    if (this.store.native.inTransaction) return
    void this.drainAsync().catch((error) => console.error('DSH 会话日志清理队列读取失败。', error))
  }

  drainAsync(): Promise<void> {
    if (this.draining) return this.draining
    const task = this.drainOnce().finally(() => {
      if (this.draining === task) this.draining = undefined
    })
    this.draining = task
    return task
  }

  private async drainOnce(): Promise<void> {
    const pending = this.store.native.prepare(`SELECT id,targetId FROM cleanup_operations
      WHERE kind=? ORDER BY createdAtEpochMs,id`).all(kind) as Array<{ id: string; targetId: string }>
    for (const operation of pending) {
      try {
        const target = JSON.parse(operation.targetId) as { conversationId: string; runtimeThreadIds: string[] }
        if (!target.conversationId || !Array.isArray(target.runtimeThreadIds)) throw new Error('DSH 清理目标无效。')
        await this.runtime.disposeConversation(target.conversationId, target.runtimeThreadIds)
        this.store.native.prepare('DELETE FROM cleanup_operations WHERE id=?').run(operation.id)
      } catch (error) {
        this.store.native.prepare(`UPDATE cleanup_operations SET state='failed',attemptCount=attemptCount+1,
          updatedAtEpochMs=?,lastError=? WHERE id=?`).run(Date.now(), String(error).slice(0, 2000), operation.id)
      }
    }
  }
}
