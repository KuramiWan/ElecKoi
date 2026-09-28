import { randomUUID } from 'node:crypto'
import type { ConversationDeleteCleanup, MessageRepository } from '@main/modules/conversations'
import type { SqliteDatabase } from '@main/platform/sqlite/SqliteDatabase'
import type { DshAgentRuntime } from './DshAgentRuntime'
import type { ChatUserFileAttachment } from '@shared/contracts/entities/chat'

const imageKind = 'dsh_image_attachment'
const fileKind = 'dsh_file_attachment'
export class AgentAttachmentCleanupRepository implements ConversationDeleteCleanup {
  constructor(
    private readonly store: SqliteDatabase,
    private readonly runtime: Pick<DshAgentRuntime, 'removeImage'> & Partial<Pick<DshAgentRuntime, 'removeFile'>>,
    private readonly messages: Pick<MessageRepository, 'listInputImageReferences' | 'listInputFileReferences'>
  ) {}

  enqueue(conversationId: string): void {
    const references = this.messages.listInputImageReferences()
    const targets = new Set(references
      .filter((row) => row.conversationId === conversationId)
      .map((row) => row.attachmentId))
    const retained = new Set(references
      .filter((row) => row.conversationId !== conversationId)
      .map((row) => row.attachmentId))
    this.enqueueTargets([...targets].filter((id) => !retained.has(id)))
    this.enqueueFileTargets(this.messages.listInputFileReferences()
      .filter((row) => row.conversationId === conversationId).map((row) => row.file))
  }

  discardPrepared(attachmentIds: readonly string[]): void {
    const retained = new Set(this.messages.listInputImageReferences().map((row) => row.attachmentId))
    this.store.withWriteTx(() => {
      this.enqueueTargets([...new Set(attachmentIds)].filter((id) => !retained.has(id)))
    })
    this.drain()
  }

  discardFiles(files: readonly ChatUserFileAttachment[]): void {
    this.queueFiles(files)
    this.drain()
  }

  queueFiles(files: readonly ChatUserFileAttachment[]): void {
    this.store.withWriteTx(() => this.enqueueFileTargets(files))
  }

  private enqueueFileTargets(files: readonly ChatUserFileAttachment[]): void {
    const insert = this.store.native.prepare(`INSERT INTO cleanup_operations(
      id,kind,targetId,state,attemptCount,createdAtEpochMs,updatedAtEpochMs,lastError
    ) VALUES (?,?,?,'queued',0,?,?,'') ON CONFLICT(kind,targetId) DO NOTHING`)
    for (const file of files) {
      if (!/^sha256:[a-f0-9]{64}$/.test(file.attachmentId)) continue
      insert.run(randomUUID(), fileKind, JSON.stringify(file), Date.now(), Date.now())
    }
  }

  private enqueueTargets(targetIds: readonly string[]): void {
    const insert = this.store.native.prepare(`INSERT OR IGNORE INTO cleanup_operations(
      id,kind,targetId,state,attemptCount,createdAtEpochMs,updatedAtEpochMs,lastError
    ) VALUES (?,?,?,'queued',0,?,?,'')`)
    for (const id of targetIds) insert.run(randomUUID(), imageKind, id, Date.now(), Date.now())
  }

  drain(): void {
    if (this.store.native.inTransaction) return
    const pending = this.store.native.prepare('SELECT id,kind,targetId FROM cleanup_operations WHERE kind IN (?,?) ORDER BY createdAtEpochMs,id')
      .all(imageKind, fileKind) as { id: string; kind: string; targetId: string }[]
    for (const operation of pending) {
      const reference = operation.kind === fileKind ? JSON.parse(operation.targetId) as ChatUserFileAttachment : undefined
      if (reference ? this.isFileReferenced(reference) : this.isReferenced(operation.targetId)) {
        this.store.native.prepare('DELETE FROM cleanup_operations WHERE id=?').run(operation.id)
        continue
      }
      this.store.native.prepare("UPDATE cleanup_operations SET state='running',attemptCount=attemptCount+1,updatedAtEpochMs=? WHERE id=?")
        .run(Date.now(), operation.id)
      try {
        if (reference) {
          const retainedDigest = this.messages.listInputFileReferences()
            .some((row) => row.file.attachmentId === reference.attachmentId)
          if (!this.runtime.removeFile) throw new Error('文件清理器尚未就绪。')
          this.runtime.removeFile(reference, retainedDigest)
        } else this.runtime.removeImage(operation.targetId)
        this.store.native.prepare('DELETE FROM cleanup_operations WHERE id=?').run(operation.id)
      } catch (error) {
        this.store.native.prepare("UPDATE cleanup_operations SET state='failed',updatedAtEpochMs=?,lastError=? WHERE id=?")
          .run(Date.now(), String(error).slice(0, 2000), operation.id)
      }
    }
  }

  private isReferenced(targetId: string): boolean {
    return this.messages.listInputImageReferences().some((row) => row.attachmentId === targetId)
  }

  private isFileReferenced(reference: ChatUserFileAttachment): boolean {
    return this.messages.listInputFileReferences().some((row) =>
      row.file.attachmentId === reference.attachmentId && row.file.name === reference.name)
  }
}
