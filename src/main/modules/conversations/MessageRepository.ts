import { randomUUID } from 'node:crypto'
import type { AgentConversationHistoryItem } from '@shared/contracts/agent/runtime'
import type { AgentProcessItem, ChatMessage, ChatUserFileAttachment, ChatUserImageAttachment, MessageRole, MessageStatus } from '@shared/contracts/entities/chat'
import { regexRuleSchema, type RegexRule } from '@shared/contracts/regex/schemas'
import { transformWithRegexRules } from '@shared/foundation/regex/RegexRuleProcessor'
import { type ElecKoiDatabase, SqliteDatabase } from '@main/platform/sqlite/SqliteDatabase'
import {
  readCurrentConversationVariableState,
  writeCurrentConversationVariableState
} from './ConversationVariableStateStore'

interface LedgerMessage { id: string; ownerId: string; ownerType: 'turn' | 'response'; turnId: string; speakerId: string; sequence: number; responseIndex: number; role: MessageRole; status: string; createdAt: string; variableStateJson: string }
interface Speaker { id: string; name: string; avatar: string; kind: string }
interface DraftMessage { content: string; images: ChatUserImageAttachment[]; files: ChatUserFileAttachment[]; process: AgentProcessItem[] }
interface RuntimeTranscriptTurn {
  turn: number
  completed: boolean
  userSeq: number | null
  userMessageId?: string | null
  userText: string
  userImages: ChatUserImageAttachment[]
  userFiles?: ChatUserFileAttachment[]
  assistantText: string
  assistantMessageId?: string | null
  process: AgentProcessItem[]
  turnUsage?: ChatMessage['turnUsage']
}
const toStoredStatus = (status: MessageStatus) => status === 'complete' ? 'completed' : status === 'streaming' ? 'pending' : status
const toMessageStatus = (status: string): MessageStatus => status === 'completed' ? 'complete' : status === 'pending' ? 'streaming' : status === 'cancelled' ? 'cancelled' : 'error'

export class MessageRepository {
  private transcriptReader: ((runtimeThreadId: string) => readonly RuntimeTranscriptTurn[] | undefined) | undefined
  private readonly drafts = new Map<string, DraftMessage>()

  constructor(private readonly store: SqliteDatabase) {}

  captureDrafts(messageIds: readonly string[]): Map<string, DraftMessage | undefined> {
    return new Map(messageIds.map((id) => [id, this.drafts.get(id) ?? this.readPendingInput(id)]))
  }

  restoreDrafts(snapshot: ReadonlyMap<string, DraftMessage | undefined>, addedMessageId?: string): void {
    if (addedMessageId) this.drafts.delete(addedMessageId)
    for (const [id, draft] of snapshot) {
      if (draft) this.drafts.set(id, draft)
      else this.drafts.delete(id)
    }
  }

  preservePendingUserInput(message: Pick<ChatMessage,
    'id' | 'role' | 'content' | 'inputImageAttachments' | 'inputFileAttachments'>): void {
    if (message.role !== 'user') throw new Error('只能保留用户输入。')
    const draft: DraftMessage = {
      content: message.content,
      images: message.inputImageAttachments ?? [],
      files: message.inputFileAttachments ?? [],
      process: []
    }
    this.writePendingInput(message.id, draft)
    this.drafts.set(message.id, draft)
  }

  attachTranscriptReader(reader: (runtimeThreadId: string) => readonly RuntimeTranscriptTurn[] | undefined): () => void {
    if (this.transcriptReader) throw new Error('聊天日志读取器已注册。')
    this.transcriptReader = reader
    return () => { if (this.transcriptReader === reader) this.transcriptReader = undefined }
  }

  assertReadableHistory(conversationId: string): void {
    if (!this.transcriptReader) return
    const bindings = this.store.native.prepare(`SELECT r.runtimeThreadId,r.dshTurn
      FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.id=r.conversationId AND c.activeBranchId=p.branchId
      WHERE c.id=? AND r.status='completed' AND r.runtimeThreadId<>''`)
      .all(conversationId) as Array<{ runtimeThreadId: string; dshTurn: number | null }>
    const transcripts = new Map<string, readonly RuntimeTranscriptTurn[] | undefined>()
    for (const binding of bindings) {
      if (!transcripts.has(binding.runtimeThreadId)) {
        transcripts.set(binding.runtimeThreadId, this.transcriptReader(binding.runtimeThreadId))
      }
      if (binding.dshTurn === null || !transcripts.get(binding.runtimeThreadId)
        ?.some((turn) => turn.turn === binding.dshTurn)) {
        throw new Error('已有回复对应的 DSH 会话日志无法读取；本次发送已取消，原聊天记录未修改。')
      }
    }
  }

  page(conversationId: string, beforeSequence?: number, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('每页轮次数必须在 1 到 200 之间。')
    if (beforeSequence !== undefined && (!Number.isSafeInteger(beforeSequence) || beforeSequence < 0)) throw new Error('历史游标必须是非负整数。')
    const path = this.store.native.prepare(`SELECT p.sequence FROM agent_branch_turns p
      JOIN agent_conversations c ON c.activeBranchId = p.branchId JOIN agent_branches b ON b.id=p.branchId AND b.conversationId=c.id
      WHERE c.id = ? AND p.sequence < ?
      ORDER BY p.sequence DESC LIMIT ?`).all(conversationId, beforeSequence ?? Number.MAX_SAFE_INTEGER, limit + 1) as { sequence: number }[]
    const hasMore = path.length > limit
    const selected = path.slice(0, limit)
    const firstSequence = selected.at(-1)?.sequence
    if (firstSequence === undefined) return { messages: [] as ChatMessage[], hasMore: false, beforeSequence: null }
    const rows = this.store.native.prepare(`
      SELECT CASE WHEN t.kind='opening' THEN 'opening' ELSE t.id END AS id, t.id AS ownerId, 'turn' AS ownerType, t.id AS turnId, t.speakerId, p.sequence, -1 AS responseIndex,
        CASE WHEN t.kind = 'user' THEN 'user' ELSE 'assistant' END AS role, 'completed' AS status, t.createdAt, t.variableStateJson
      FROM agent_conversations c JOIN agent_branch_turns p ON p.branchId = c.activeBranchId JOIN agent_turns t ON t.id = p.turnId AND t.conversationId = c.id
      WHERE c.id = ? AND p.sequence >= ? AND p.sequence < ?
      UNION ALL
      SELECT r.id, r.id, 'response', r.turnId, r.speakerId, p.sequence, r.responseIndex, 'assistant', r.status, r.createdAt, r.variableStateJson
      FROM agent_conversations c JOIN agent_branch_turns p ON p.branchId = c.activeBranchId JOIN agent_responses r ON r.turnId = p.turnId AND r.conversationId = c.id
      WHERE c.id = ? AND p.sequence >= ? AND p.sequence < ? ORDER BY sequence, responseIndex
    `).all(conversationId, firstSequence, beforeSequence ?? Number.MAX_SAFE_INTEGER, conversationId, firstSequence, beforeSequence ?? Number.MAX_SAFE_INTEGER) as LedgerMessage[]
    const preceding = this.store.native.prepare(`SELECT
      (SELECT COUNT(*) FROM agent_branch_turns p WHERE p.branchId=c.activeBranchId AND p.sequence<?)
      + (SELECT COUNT(*) FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
        WHERE p.branchId=c.activeBranchId AND p.sequence<?) AS count
      FROM agent_conversations c WHERE c.id=?`
    ).get(firstSequence, firstSequence, conversationId) as { count: number }
    const transcripts = new Map<string, readonly RuntimeTranscriptTurn[] | undefined>()
    return {
      messages: rows.map((row, index) => ({ ...this.project(conversationId, row, transcripts), messageIndex: preceding.count + index })),
      hasMore,
      beforeSequence: firstSequence
    }
  }

  list(conversationId: string): ChatMessage[] {
    // Current UI still consumes a complete conversation. The bounded page API is
    // available independently; switching the UI to it is a separate task.
    const result: ChatMessage[] = []
    let cursor: number | undefined
    do {
      const page = this.page(conversationId, cursor, 200)
      result.unshift(...page.messages)
      if (!page.hasMore || page.beforeSequence === null) return result
      cursor = page.beforeSequence
    } while (true)
  }

  latestPreview(conversationId: string): string | undefined {
    return this.page(conversationId, undefined, 1).messages.at(-1)?.content
  }

  create(
    conversationId: string,
    role: MessageRole,
    content: string,
    status: MessageStatus,
    _db?: ElecKoiDatabase,
    runtimeThreadId = '',
    inputImageAttachments: ChatUserImageAttachment[] = [],
    inputFileAttachments: ChatUserFileAttachment[] = []
  ): ChatMessage {
    return this.store.withWriteTx(() => {
      const conversation = this.store.native.prepare('SELECT activeBranchId FROM agent_conversations WHERE id = ?').get(conversationId) as { activeBranchId: string } | undefined
      if (!conversation) throw new Error('找不到会话账本。')
      if (role === 'assistant') {
        const turn = this.store.native.prepare('SELECT turnId FROM agent_branch_turns WHERE branchId = ? ORDER BY sequence DESC LIMIT 1').get(conversation.activeBranchId) as { turnId: string } | undefined
        if (!turn) throw new Error('回复必须属于已有轮次。')
        const session = this.store.native.prepare('SELECT characterId, characterName, characterAvatar FROM chat_sessions WHERE id = ?').get(conversationId) as { characterId: string; characterName: string; characterAvatar: string }
        return this.createResponse(conversationId, turn.turnId, content, status, { id: session.characterId || 'assistant', name: session.characterName || 'ElecKoi', avatar: session.characterAvatar, kind: session.characterId ? 'card_character' : 'assistant' }, runtimeThreadId)
      }
      const id = randomUUID()
      const now = new Date().toISOString()
      const profile = this.store.native.prepare("SELECT userName, userAvatar FROM user_profile WHERE id = 'default'").get() as { userName: string; userAvatar: string } | undefined
      const speakerId = this.ensureSpeaker(conversationId, { id: 'user', name: profile?.userName ?? '你', avatar: profile?.userAvatar ?? '', kind: 'user' })
      const sequence = (this.store.native.prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM agent_branch_turns WHERE branchId = ?').get(conversation.activeBranchId) as { next: number }).next
      const variableStateJson = readCurrentConversationVariableState(conversationId, this.store.db)
      this.store.native.prepare(`INSERT INTO agent_turns(id,conversationId,speakerId,kind,createdAt,variableStateJson) VALUES (?,?,?,'user',?,?)`).run(id, conversationId, speakerId, now, variableStateJson)
      this.store.native.prepare('INSERT INTO agent_branch_turns(branchId,sequence,turnId) VALUES (?,?,?)').run(conversation.activeBranchId, sequence, id)
      const draft = { content, images: inputImageAttachments, files: inputFileAttachments, process: [] }
      this.writePendingInput(id, draft)
      this.drafts.set(id, draft)
      this.publish(conversationId, 1, 1)
      return {
        id, conversationId, turnId: id, speakerId, sequence, role, content,
        variableStateJson, status: 'complete', createdAt: now,
        ...(inputImageAttachments.length ? { inputImageAttachments } : {}),
        ...(inputFileAttachments.length ? { inputFileAttachments } : {})
      }
    })
  }

  createResponse(conversationId: string, turnId: string, content: string, status: MessageStatus, speaker: Speaker, runtimeThreadId = ''): ChatMessage {
    return this.store.withWriteTx(() => {
      const turn = this.store.native.prepare(`SELECT t.id,p.sequence FROM agent_turns t JOIN agent_branch_turns p ON p.turnId=t.id
        JOIN agent_conversations c ON c.activeBranchId=p.branchId WHERE t.id=? AND t.conversationId=? AND c.id=?`).get(turnId, conversationId, conversationId) as { id: string; sequence: number } | undefined
      if (!turn) throw new Error('回复轮次必须属于当前会话的活动分支。')
      const id = randomUUID()
      const speakerId = this.ensureSpeaker(conversationId, speaker)
      const now = new Date().toISOString()
      const responseIndex = (this.store.native.prepare('SELECT COALESCE(MAX(responseIndex),-1)+1 AS next FROM agent_responses WHERE turnId=?').get(turnId) as { next: number }).next
      const variableStateJson = readCurrentConversationVariableState(conversationId, this.store.db)
      this.store.native.prepare(`INSERT INTO agent_responses(id,conversationId,turnId,responseIndex,speakerId,status,createdAt,variableStateJson,runtimeThreadId)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, conversationId, turnId, responseIndex, speakerId, toStoredStatus(status), now, variableStateJson, runtimeThreadId)
      this.drafts.set(id, { content, images: [], files: [], process: [] })
      this.publish(conversationId, 1, 0)
      return { id, conversationId, turnId, speakerId, sequence: turn.sequence, responseIndex, role: 'assistant', content, variableStateJson, status, createdAt: now }
    })
  }

  appendCheckpoint(messageId: string, delta: string): void {
    if (delta.length === 0) return
    const response = this.response(messageId)
    if (response.status !== 'pending') return
    const draft = this.drafts.get(messageId)
    if (draft) draft.content += delta
  }

  requirePendingResponse(conversationId: string, messageId: string): string {
    const response = this.store.native.prepare(
      "SELECT id FROM agent_responses WHERE conversationId=? AND id=? AND status='pending'"
    ).get(conversationId, messageId) as { id: string } | undefined
    if (!response) throw new Error('执行记录必须关联本场回复。')
    return response.id
  }

  bindDshTurn(conversationId: string, messageId: string, runtimeThreadId: string, turn: number): void {
    if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('DSH 回合编号无效。')
    const response = this.store.native.prepare(`SELECT dshTurn FROM agent_responses
      WHERE conversationId=? AND id=? AND runtimeThreadId=? AND status='pending'`)
      .get(conversationId, messageId, runtimeThreadId) as { dshTurn: number | null } | undefined
    if (!response) throw new Error('DSH 回合与当前回复不匹配。')
    if (response.dshTurn !== null && response.dshTurn !== turn) {
      throw new Error('同一回复收到了不同的 DSH 回合编号。')
    }
    this.store.native.prepare(`UPDATE agent_responses SET dshTurn=?
      WHERE conversationId=? AND id=? AND runtimeThreadId=?`).run(turn, conversationId, messageId, runtimeThreadId)
  }

  unboundActiveResponses(): Array<{
    conversationId: string
    messageId: string
    runtimeThreadId: string
  }> {
    return this.store.native.prepare(`SELECT r.id AS messageId,r.conversationId,r.runtimeThreadId
      FROM agent_responses r
      JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.id=r.conversationId AND c.activeBranchId=p.branchId
      WHERE r.status IN ('completed','cancelled','error') AND r.dshTurn IS NULL AND r.runtimeThreadId<>''
      ORDER BY r.conversationId,p.sequence,r.responseIndex`)
      .all() as Array<{ messageId: string; conversationId: string; runtimeThreadId: string }>
  }

  bindHistoricalDshTurn(conversationId: string, messageId: string, runtimeThreadId: string, turn: number): void {
    if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('DSH 回合编号无效。')
    const updated = this.store.native.prepare(`UPDATE agent_responses SET dshTurn=?
      WHERE conversationId=? AND id=? AND runtimeThreadId=? AND status='completed' AND dshTurn IS NULL`)
      .run(turn, conversationId, messageId, runtimeThreadId)
    if (updated.changes !== 1) throw new Error('历史回复的 DSH 回合绑定已发生变化。')
  }

  /** Bind interrupted replies only when the complete active ledger and Session turns agree. */
  reconcileUnboundActiveResponses(runtimeThreadId: string): void {
    const transcript = this.transcriptReader?.(runtimeThreadId)
    if (!transcript) return
    const rows = this.store.native.prepare(`SELECT r.id,r.status,r.dshTurn FROM agent_responses r
      JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.id=r.conversationId AND c.activeBranchId=p.branchId
      WHERE r.runtimeThreadId=? ORDER BY p.sequence,r.responseIndex`)
      .all(runtimeThreadId) as Array<{ id: string; status: string; dshTurn: number | null }>
    if (!rows.some((row) => row.dshTurn === null) || rows.some((row) => row.status === 'pending')) return
    const turns = [...transcript].sort((left, right) => left.turn - right.turn)
    if (rows.length !== turns.length || new Set(turns.map((turn) => turn.turn)).size !== turns.length
      || rows.some((row, index) => row.dshTurn !== null && row.dshTurn !== turns[index]?.turn)
      || rows.some((row, index) => row.status === 'completed' && !turns[index]?.completed)) return
    this.store.withWriteTx(() => {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const turn = turns[index]
        if (!row || !turn || row.dshTurn !== null) continue
        this.store.native.prepare('UPDATE agent_responses SET dshTurn=? WHERE id=? AND dshTurn IS NULL')
          .run(turn.turn, row.id)
      }
      for (let index = 0; index < rows.length; index += 1) {
        if (turns[index] && turns[index]!.userSeq !== null) {
          this.store.native.prepare('DELETE FROM agent_pending_inputs WHERE turnId=(SELECT turnId FROM agent_responses WHERE id=?)')
            .run(rows[index]!.id)
        }
      }
    })
  }

  /** A cancelled reply without a turn may still have a queued prompt in the Session. */
  unstartedDeletionTurn(runtimeThreadId: string, removedResponseIds: readonly string[]): number | null | undefined {
    if (!this.transcriptReader) return undefined
    const removed = new Set(removedResponseIds)
    const rows = this.store.native.prepare(`SELECT id,status,dshTurn FROM agent_responses
      WHERE runtimeThreadId=? ORDER BY dshTurn`)
      .all(runtimeThreadId) as Array<{ id: string; status: string; dshTurn: number | null }>
    if (rows.some((row) => removed.has(row.id) && row.dshTurn === null
      && row.status !== 'cancelled' && row.status !== 'error')) return undefined
    const transcript = this.transcriptReader(runtimeThreadId)
    const boundRows = rows.filter((row) => row.dshTurn !== null)
    if (!transcript) return boundRows.length === 0 ? null : undefined
    const bindingByTurn = new Map(boundRows.map((row) => [row.dshTurn, row]))
    const orderedTurns = [...transcript].sort((left, right) => left.turn - right.turn)
    const logTurns = new Set(orderedTurns.map((turn) => turn.turn))
    if (bindingByTurn.size !== boundRows.length || logTurns.size !== orderedTurns.length
      || orderedTurns.some((turn) => !bindingByTurn.has(turn.turn))
      || boundRows.some((row) => !logTurns.has(row.dshTurn!))) return undefined
    const firstRemoved = orderedTurns.findIndex((turn) => removed.has(bindingByTurn.get(turn.turn)!.id))
    if (firstRemoved >= 0 && orderedTurns.slice(firstRemoved)
      .some((turn) => !removed.has(bindingByTurn.get(turn.turn)!.id))) return undefined
    if (firstRemoved >= 0) {
      if (firstRemoved > 0 && !orderedTurns[firstRemoved - 1]?.completed) return undefined
      return orderedTurns[firstRemoved]!.turn
    }
    const last = orderedTurns.at(-1)
    return last && !last.completed ? undefined : (last?.turn ?? 0) + 1
  }

  listInputImageReferences(): Array<{ conversationId: string; attachmentId: string }> {
    const references: Array<{ conversationId: string; attachmentId: string }> = []
    const pending = this.store.native.prepare(`SELECT t.id,t.conversationId FROM agent_turns t
      JOIN agent_branch_turns p ON p.turnId=t.id JOIN agent_conversations c ON c.id=t.conversationId AND c.activeBranchId=p.branchId`)
      .all() as Array<{ id: string; conversationId: string }>
    for (const row of pending) {
      for (const image of (this.drafts.get(row.id) ?? this.readPendingInput(row.id))?.images ?? []) {
        references.push({ conversationId: row.conversationId, attachmentId: image.attachmentId })
      }
    }
    const bindings = this.store.native.prepare(`SELECT DISTINCT r.conversationId,r.runtimeThreadId,r.dshTurn
      FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.id=r.conversationId AND c.activeBranchId=p.branchId
      WHERE r.runtimeThreadId<>'' AND r.dshTurn IS NOT NULL`)
      .all() as Array<{ conversationId: string; runtimeThreadId: string; dshTurn: number }>
    const transcripts = new Map<string, readonly RuntimeTranscriptTurn[] | undefined>()
    for (const binding of bindings) {
      if (!transcripts.has(binding.runtimeThreadId)) {
        transcripts.set(binding.runtimeThreadId, this.transcriptReader?.(binding.runtimeThreadId))
      }
      const turn = transcripts.get(binding.runtimeThreadId)?.find((item) => item.turn === binding.dshTurn)
      for (const image of turn?.userImages ?? []) {
        references.push({ conversationId: binding.conversationId, attachmentId: image.attachmentId })
      }
    }
    return [...new Map(references.map((item) => [`${item.conversationId}\u0000${item.attachmentId}`, item])).values()]
  }

  listInputFileReferences(): Array<{ conversationId: string; file: ChatUserFileAttachment }> {
    const references: Array<{ conversationId: string; file: ChatUserFileAttachment }> = []
    const pending = this.store.native.prepare(`SELECT t.id,t.conversationId FROM agent_turns t
      JOIN agent_branch_turns p ON p.turnId=t.id JOIN agent_conversations c ON c.id=t.conversationId AND c.activeBranchId=p.branchId`)
      .all() as Array<{ id: string; conversationId: string }>
    for (const row of pending) for (const file of (this.drafts.get(row.id) ?? this.readPendingInput(row.id))?.files ?? []) {
      references.push({ conversationId: row.conversationId, file })
    }
    const bindings = this.store.native.prepare(`SELECT DISTINCT r.conversationId,r.runtimeThreadId,r.dshTurn
      FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.id=r.conversationId AND c.activeBranchId=p.branchId
      WHERE r.runtimeThreadId<>'' AND r.dshTurn IS NOT NULL`)
      .all() as Array<{ conversationId: string; runtimeThreadId: string; dshTurn: number }>
    const transcripts = new Map<string, readonly RuntimeTranscriptTurn[] | undefined>()
    for (const binding of bindings) {
      if (!transcripts.has(binding.runtimeThreadId)) transcripts.set(binding.runtimeThreadId, this.transcriptReader?.(binding.runtimeThreadId))
      const turn = transcripts.get(binding.runtimeThreadId)?.find((item) => item.turn === binding.dshTurn)
      for (const file of turn?.userFiles ?? []) references.push({ conversationId: binding.conversationId, file })
    }
    return [...new Map(references.map((item) => [`${item.conversationId}\u0000${item.file.attachmentId}\u0000${item.file.name}`, item])).values()]
  }

  findInputFile(conversationId: string, attachmentId: string, name: string): ChatUserFileAttachment {
    const reference = this.listInputFileReferences().find((row) => row.conversationId === conversationId
      && row.file.attachmentId === attachmentId && row.file.name === name
      && /^sha256:[a-f0-9]{64}$/.test(row.file.attachmentId))
    if (!reference) throw new Error('文件不在当前聊天记录中。')
    return reference.file
  }

  recordUploadedFile(responseId: string, draftId: string, file: ChatUserFileAttachment): void {
    const response = this.store.native.prepare('SELECT turnId FROM agent_responses WHERE id=?')
      .get(responseId) as { turnId: string } | undefined
    const draft = response ? this.drafts.get(response.turnId) ?? this.readPendingInput(response.turnId) : undefined
    if (!draft) return
    const next = { ...draft, files: draft.files.map((current) => current.attachmentId === draftId ? file : current) }
    this.store.withWriteTx(() => this.writePendingInput(response!.turnId, next))
    this.drafts.set(response!.turnId, next)
  }

  get(conversationId: string, messageId: string): ChatMessage {
    const row = this.store.native.prepare(`
      SELECT CASE WHEN t.kind='opening' THEN 'opening' ELSE t.id END AS id, t.id AS ownerId, 'turn' AS ownerType, t.id AS turnId, t.speakerId,
        p.sequence, -1 AS responseIndex, CASE WHEN t.kind='user' THEN 'user' ELSE 'assistant' END AS role,
        'completed' AS status, t.createdAt, t.variableStateJson
      FROM agent_conversations c JOIN agent_branch_turns p ON p.branchId=c.activeBranchId
      JOIN agent_turns t ON t.id=p.turnId AND t.conversationId=c.id
      WHERE c.id=? AND (t.id=? OR (t.kind='opening' AND ?='opening'))
      UNION ALL
      SELECT r.id, r.id, 'response', r.turnId, r.speakerId, p.sequence, r.responseIndex,
        'assistant', r.status, r.createdAt, r.variableStateJson
      FROM agent_conversations c JOIN agent_branch_turns p ON p.branchId=c.activeBranchId
      JOIN agent_responses r ON r.turnId=p.turnId AND r.conversationId=c.id
      WHERE c.id=? AND r.id=?
      ORDER BY responseIndex DESC LIMIT 1
    `).get(conversationId, messageId, messageId, conversationId, messageId) as LedgerMessage | undefined
    if (!row) throw new Error('找不到对应的聊天消息。')
    return this.project(conversationId, row)
  }

  findInputImage(conversationId: string, attachmentId: string): ChatUserImageAttachment {
    const bindings = this.store.native.prepare(`SELECT DISTINCT r.runtimeThreadId,r.dshTurn
      FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.id=r.conversationId AND c.activeBranchId=p.branchId
      WHERE r.conversationId=? AND r.runtimeThreadId<>'' AND r.dshTurn IS NOT NULL`)
      .all(conversationId) as Array<{ runtimeThreadId: string; dshTurn: number }>
    const transcripts = new Map<string, readonly RuntimeTranscriptTurn[] | undefined>()
    for (const binding of bindings) {
      if (!transcripts.has(binding.runtimeThreadId)) {
        transcripts.set(binding.runtimeThreadId, this.transcriptReader?.(binding.runtimeThreadId))
      }
      const image = transcripts.get(binding.runtimeThreadId)?.find((item) => item.turn === binding.dshTurn)
        ?.userImages.find((item) => item.attachmentId === attachmentId)
      if (image) return image
    }
    const pending = this.store.native.prepare(`SELECT t.id FROM agent_turns t
      JOIN agent_branch_turns p ON p.turnId=t.id JOIN agent_conversations c ON c.id=t.conversationId AND c.activeBranchId=p.branchId
      WHERE t.conversationId=?`).all(conversationId) as Array<{ id: string }>
    for (const row of pending) {
      const image = (this.drafts.get(row.id) ?? this.readPendingInput(row.id))?.images.find((item) => item.attachmentId === attachmentId)
      if (image) return image
    }
    throw new Error('找不到这张聊天图片。')
  }

  /** Product history before the latest user input, used to seed a fresh DSH session. */
  runtimeHistory(conversationId: string): AgentConversationHistoryItem[] {
    const messages = this.list(conversationId)
    const latestUserIndex = [...messages].map((message) => message.role).lastIndexOf('user')
    return messages
      .filter((message, index) => index !== latestUserIndex && message.content.trim().length > 0 && message.status !== 'streaming')
      .map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.speakerName ? { speakerName: message.speakerName } : {})
      }))
  }

  latestCompletedRuntimeThreadId(conversationId: string): string | undefined {
    const row = this.store.native.prepare(`SELECT r.runtimeThreadId
      FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.activeBranchId=p.branchId
      WHERE r.conversationId=? AND c.id=? AND r.status='completed' AND r.runtimeThreadId<>''
      ORDER BY p.sequence DESC, r.responseIndex DESC LIMIT 1`).get(conversationId, conversationId) as { runtimeThreadId: string } | undefined
    return row?.runtimeThreadId || undefined
  }

  conversationRuntimeThreadId(conversationId: string): string {
    const row = this.store.native.prepare('SELECT runtimeThreadId FROM agent_conversations WHERE id=?')
      .get(conversationId) as { runtimeThreadId: string } | undefined
    if (!row?.runtimeThreadId) throw new Error('聊天存档缺少 DSH 会话编号。')
    return row.runtimeThreadId
  }

  runtimeThreadIdsForArchive(conversationId: string): string[] {
    const ids = this.store.native.prepare(`
      SELECT runtimeThreadId AS id FROM agent_conversations WHERE id=?
      UNION SELECT runtimeThreadId AS id FROM agent_responses WHERE conversationId=? AND runtimeThreadId<>''
    `).all(conversationId, conversationId) as Array<{ id: string }>
    return ids.map((row) => row.id).filter(Boolean)
  }

  runtimeThreadIdsForDeletion(conversationId: string): string[] {
    const ids = this.store.native.prepare(`
      SELECT runtimeThreadId AS id FROM agent_conversations WHERE id=?
      UNION SELECT runtimeThreadId AS id FROM agent_responses WHERE conversationId=? AND runtimeThreadId<>''
    `).all(conversationId, conversationId) as Array<{ id: string }>
    return ids.map((row) => row.id).filter((id) => id && !(this.store.native.prepare(`
      SELECT 1 FROM agent_conversations WHERE id<>? AND runtimeThreadId=?
      UNION SELECT 1 FROM agent_responses WHERE conversationId<>? AND runtimeThreadId=? LIMIT 1
    `).get(conversationId, id, conversationId, id)))
  }

  latestRuntimeThreadId(conversationId: string): string | undefined {
    const row = this.store.native.prepare(`SELECT r.runtimeThreadId
      FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.activeBranchId=p.branchId
      WHERE r.conversationId=? AND c.id=? AND r.runtimeThreadId<>''
      ORDER BY p.sequence DESC, r.responseIndex DESC LIMIT 1`).get(conversationId, conversationId) as { runtimeThreadId: string } | undefined
    return row?.runtimeThreadId || undefined
  }

  /** The first persisted DSH turn for a user input and all of its replies. */
  regenerationDshBoundary(conversationId: string, targetMessageId: string): { runtimeThreadId: string; turn: number } | undefined {
    const row = this.store.native.prepare(`SELECT r.runtimeThreadId,r.dshTurn AS turn
      FROM agent_conversations c
      JOIN agent_branch_turns p ON p.branchId=c.activeBranchId
      JOIN agent_turns t ON t.id=p.turnId AND t.conversationId=c.id
      JOIN agent_responses r ON r.turnId=t.id AND r.conversationId=c.id
      WHERE c.id=? AND (t.id=? OR t.id=(SELECT turnId FROM agent_responses WHERE id=? AND conversationId=?))
        AND r.runtimeThreadId<>'' AND r.dshTurn IS NOT NULL
      ORDER BY r.dshTurn ASC LIMIT 1`)
      .get(conversationId, targetMessageId, targetMessageId, conversationId) as { runtimeThreadId: string; turn: number } | undefined
    return row && Number.isSafeInteger(row.turn) && row.turn > 0 ? row : undefined
  }

  /** The selected reply's turn, or the first reply to a selected user input. */
  deletionDshBoundary(conversationId: string, targetMessageId: string): { runtimeThreadId: string; turn: number } | undefined {
    const row = this.store.native.prepare(`SELECT r.runtimeThreadId,r.dshTurn AS turn
      FROM agent_conversations c
      JOIN agent_branch_turns p ON p.branchId=c.activeBranchId
      JOIN agent_turns t ON t.id=p.turnId AND t.conversationId=c.id
      JOIN agent_responses r ON r.turnId=t.id AND r.conversationId=c.id
      WHERE c.id=? AND (r.id=? OR (t.id=? AND NOT EXISTS (
        SELECT 1 FROM agent_responses WHERE id=? AND conversationId=?
      ))) AND r.runtimeThreadId<>'' AND r.dshTurn IS NOT NULL
      ORDER BY r.dshTurn ASC LIMIT 1`)
      .get(conversationId, targetMessageId, targetMessageId, targetMessageId, conversationId) as { runtimeThreadId: string; turn: number } | undefined
    return row && Number.isSafeInteger(row.turn) && row.turn > 0 ? row : undefined
  }

  canRetainRuntimeThread(conversationId: string, runtimeThreadId: string): boolean {
    const row = this.store.native.prepare(`SELECT COUNT(*) AS count FROM agent_responses r
      JOIN agent_branch_turns p ON p.turnId=r.turnId
      JOIN agent_conversations c ON c.activeBranchId=p.branchId
      WHERE c.id=? AND r.runtimeThreadId<>'' AND r.runtimeThreadId<>?`)
      .get(conversationId, runtimeThreadId) as { count: number }
    return row.count === 0
  }

  canRewindRuntimeThread(runtimeThreadId: string, fromTurn: number, removedResponseIds: readonly string[]): boolean {
    const removed = new Set(removedResponseIds)
    const referenced = this.store.native.prepare(`
      SELECT id FROM agent_responses WHERE runtimeThreadId=? AND dshTurn>=?
    `).all(runtimeThreadId, fromTurn) as Array<{ id: string }>
    return referenced.every((row) => removed.has(row.id))
  }

  /**
   * Deletes one public message and every message after it on the active branch.
   * This deliberately follows the conversation's causal order: retaining later
   * replies after removing their input would leave Agent state and variables invalid.
   */
  deleteFrom(conversationId: string, targetMessageId: string, sourceDeletedAttachmentIds: readonly string[] = []): {
    deletedMessageCount: number
    remainingMessageCount: number
    deletedAttachmentIds: string[]
    obsoleteRuntimeThreadIds: string[]
    retainedRuntimeThreadIds: string[]
    deletedResponseIds: string[]
    deletedMessageIds: string[]
    rollbackSettingLibraryStateJson?: string | undefined
  } {
    return this.store.withWriteTx(() => {
      const branch = this.store.native.prepare(
        'SELECT activeBranchId AS branchId FROM agent_conversations WHERE id=?'
      ).get(conversationId) as { branchId: string } | undefined
      if (!branch) throw new Error('找不到当前对话分支。')

      const target = this.store.native.prepare(`
        SELECT t.id AS ownerId, 'turn' AS ownerType, p.sequence, -1 AS responseIndex
        FROM agent_branch_turns p
        JOIN agent_turns t ON t.id=p.turnId AND t.conversationId=?
        WHERE p.branchId=? AND (t.id=? OR (t.kind='opening' AND ?='opening'))
        UNION ALL
        SELECT r.id AS ownerId, 'response' AS ownerType, p.sequence, r.responseIndex
        FROM agent_branch_turns p
        JOIN agent_responses r ON r.turnId=p.turnId AND r.conversationId=?
        WHERE p.branchId=? AND r.id=?
        ORDER BY responseIndex DESC LIMIT 1
      `).get(
        conversationId, branch.branchId, targetMessageId, targetMessageId,
        conversationId, branch.branchId, targetMessageId
      ) as { ownerId: string; ownerType: 'turn' | 'response'; sequence: number; responseIndex: number } | undefined
      if (!target) throw new Error('找不到要删除的聊天消息。')

      const targetTurn = this.store.native.prepare(`SELECT t.id,t.kind,t.variableStateJson
        FROM agent_turns t JOIN agent_branch_turns p ON p.turnId=t.id
        WHERE t.conversationId=? AND p.branchId=? AND p.sequence=?`)
        .get(conversationId, branch.branchId, target.sequence) as {
          id: string
          kind: string
          variableStateJson: string
        } | undefined
      if (!targetTurn) throw new Error('找不到要删除消息所属的对话轮次。')
      const initialState = this.store.native.prepare(`SELECT stateJson FROM chat_session_variable_states
        WHERE sessionId=? AND kind='initial'`).get(conversationId) as { stateJson: string } | undefined
      const previousResponse = target.ownerType === 'response'
        ? this.store.native.prepare(`SELECT id,variableStateJson FROM agent_responses
            WHERE conversationId=? AND turnId=? AND responseIndex<?
            ORDER BY responseIndex DESC LIMIT 1`)
          .get(conversationId, targetTurn.id, target.responseIndex) as { id: string; variableStateJson: string } | undefined
        : undefined
      const rollbackVariableStateJson = targetTurn.kind === 'opening'
        ? initialState?.stateJson || '{}'
        : previousResponse?.variableStateJson || targetTurn.variableStateJson || initialState?.stateJson || '{}'
      const rollbackSettingLibraryOwner = targetTurn.kind === 'opening'
        ? undefined
        : previousResponse
          ? { ownerType: 'response', ownerId: previousResponse.id }
          : { ownerType: 'turn', ownerId: targetTurn.id }
      const rollbackSettingLibraryStateJson = rollbackSettingLibraryOwner
        ? (this.store.native.prepare(`SELECT stateJson FROM agent_setting_snapshots
            WHERE conversationId=? AND ownerType=? AND ownerId=?`)
          .get(conversationId, rollbackSettingLibraryOwner.ownerType, rollbackSettingLibraryOwner.ownerId) as { stateJson: string } | undefined)?.stateJson
        : '[]'

      const turns = this.store.native.prepare(`
        SELECT p.turnId,t.kind,p.sequence
        FROM agent_branch_turns p JOIN agent_turns t ON t.id=p.turnId
        WHERE p.branchId=? AND p.sequence>=? ORDER BY p.sequence
      `).all(branch.branchId, target.sequence) as Array<{ turnId: string; kind: string; sequence: number }>
      const turnIds = turns
        .filter((row) => target.ownerType === 'turn' || row.sequence > target.sequence)
        .map((row) => row.turnId)
      const responseRows = this.store.native.prepare(`
        SELECT r.id,r.turnId,r.responseIndex,r.runtimeThreadId,p.sequence
        FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
        WHERE r.conversationId=? AND p.branchId=? AND (
          p.sequence>? OR (p.sequence=? AND ?='response' AND r.responseIndex>=?) OR
          (p.sequence=? AND ?='turn')
        ) ORDER BY p.sequence,r.responseIndex
      `).all(
        conversationId, branch.branchId,
        target.sequence, target.sequence, target.ownerType, target.responseIndex,
        target.sequence, target.ownerType
      ) as Array<{ id: string; turnId: string; responseIndex: number; runtimeThreadId: string; sequence: number }>
      const responseIds = responseRows.map((row) => row.id)
      const publicTurnIds = turns
        .filter((row) => turnIds.includes(row.turnId))
        .map((row) => row.kind === 'opening' ? 'opening' : row.turnId)
      const deletedPublicMessageIds = [...publicTurnIds, ...responseIds]
      if (deletedPublicMessageIds.length === 0) throw new Error('没有可删除的聊天消息。')

      const deletedOwners = [
        ...turnIds.map((id) => ({ ownerType: 'turn', ownerId: id })),
        ...responseIds.map((id) => ({ ownerType: 'response', ownerId: id }))
      ]
      const deletedAttachmentIds = deletedOwners.flatMap(({ ownerId }) =>
        (this.drafts.get(ownerId) ?? this.readPendingInput(ownerId))?.images.map((image) => image.attachmentId) ?? [])
      const previousRuntimeThreadIds = (this.store.native.prepare(`
        SELECT DISTINCT runtimeThreadId FROM agent_responses
        WHERE conversationId=? AND runtimeThreadId<>'' ORDER BY runtimeThreadId
      `).all(conversationId) as { runtimeThreadId: string }[]).map((row) => row.runtimeThreadId)

      for (const { ownerType, ownerId } of deletedOwners) {
        this.drafts.delete(ownerId)
        this.store.native.prepare('DELETE FROM agent_setting_snapshots WHERE conversationId=? AND ownerType=? AND ownerId=?')
          .run(conversationId, ownerType, ownerId)
      }
      for (const id of responseIds) this.store.native.prepare('DELETE FROM agent_responses WHERE id=? AND conversationId=?').run(id, conversationId)
      for (const id of turnIds) this.store.native.prepare('DELETE FROM agent_branch_turns WHERE branchId=? AND turnId=?').run(branch.branchId, id)
      for (const id of turnIds) this.store.native.prepare('DELETE FROM agent_turns WHERE id=? AND conversationId=?').run(id, conversationId)

      const retainedRuntimeThreadIds = (this.store.native.prepare(`
        SELECT DISTINCT runtimeThreadId FROM agent_responses
        WHERE conversationId=? AND runtimeThreadId<>'' ORDER BY runtimeThreadId
      `).all(conversationId) as { runtimeThreadId: string }[]).map((row) => row.runtimeThreadId)
      const stableRuntimeThreadId = this.conversationRuntimeThreadId(conversationId)
      if (!retainedRuntimeThreadIds.includes(stableRuntimeThreadId)) retainedRuntimeThreadIds.push(stableRuntimeThreadId)
      const globallyReferenced = new Set((this.store.native.prepare(`
        SELECT DISTINCT runtimeThreadId FROM agent_responses WHERE runtimeThreadId<>''
      `).all() as { runtimeThreadId: string }[]).map((row) => row.runtimeThreadId))
      const obsoleteRuntimeThreadIds = previousRuntimeThreadIds.filter((id) =>
        !globallyReferenced.has(id) && !retainedRuntimeThreadIds.includes(id))
      this.store.native.prepare(`DELETE FROM conversation_speakers WHERE conversationId=?
        AND id NOT IN (SELECT speakerId FROM agent_turns WHERE conversationId=?)
        AND id NOT IN (SELECT speakerId FROM agent_responses WHERE conversationId=?)`)
        .run(conversationId, conversationId, conversationId)

      const remainingMessages = this.list(conversationId)
      const remainingUserCount = remainingMessages.filter((item) => item.role === 'user').length
      writeCurrentConversationVariableState(
        conversationId,
        rollbackVariableStateJson,
        this.store.db
      )
      this.store.native.prepare(`UPDATE chat_sessions SET
        historyMessageCount=?,historyUserMessageCount=?,updatedAt=? WHERE id=?`)
        .run(
          remainingMessages.length,
          remainingUserCount,
          new Date().toISOString(),
          conversationId
        )

      return {
        deletedMessageCount: deletedPublicMessageIds.length,
        remainingMessageCount: remainingMessages.length,
        deletedAttachmentIds: [...new Set([...deletedAttachmentIds, ...sourceDeletedAttachmentIds])],
        obsoleteRuntimeThreadIds,
        retainedRuntimeThreadIds,
        deletedResponseIds: responseIds,
        deletedMessageIds: deletedPublicMessageIds,
        rollbackSettingLibraryStateJson
      }
    })
  }

  writeSettingLibraryStateSnapshot(conversationId: string, messageId: string, stateJson: string): void {
    this.store.withWriteTx(() => {
      const owner = this.store.native.prepare(`
        SELECT t.id AS ownerId,'turn' AS ownerType
        FROM agent_turns t WHERE t.conversationId=? AND (t.id=? OR (t.kind='opening' AND ?='opening'))
        UNION ALL
        SELECT r.id AS ownerId,'response' AS ownerType
        FROM agent_responses r WHERE r.conversationId=? AND r.id=?
        LIMIT 1
      `).get(conversationId, messageId, messageId, conversationId, messageId) as {
        ownerId: string
        ownerType: 'turn' | 'response'
      } | undefined
      if (!owner) throw new Error('找不到设定状态快照所属的消息。')
      let value: unknown
      try { value = JSON.parse(stateJson) } catch (error) {
        throw new Error('设定状态快照不是合法 JSON。', { cause: error })
      }
      if (!Array.isArray(value)) throw new Error('设定状态快照格式不正确。')
      this.store.native.prepare(`INSERT INTO agent_setting_snapshots(conversationId,ownerType,ownerId,stateJson)
        VALUES (?,?,?,?) ON CONFLICT(ownerType,ownerId) DO UPDATE SET stateJson=excluded.stateJson`)
        .run(conversationId, owner.ownerType, owner.ownerId, JSON.stringify(value))
    })
  }

  /** Truncate the active branch at a user turn for Android-style edit/regenerate. */
  prepareRegeneration(
    conversationId: string,
    targetMessageId: string,
    replacement?: string,
    sourceInput?: Pick<ChatMessage, 'content' | 'inputImageAttachments' | 'inputFileAttachments'>
  ): {
    turnId: string
    text: string
    inputImages: ChatUserImageAttachment[]
    inputFiles: ChatUserFileAttachment[]
    runtimeThreadId: string
    obsoleteRuntimeThreadIds: string[]
    retainedTurns: number
  } {
    return this.store.withWriteTx(() => {
      const target = this.store.native.prepare(`SELECT r.turnId AS responseTurnId, t.id AS turnId, p.sequence, t.kind
        FROM agent_conversations c JOIN agent_branch_turns p ON p.branchId=c.activeBranchId
        JOIN agent_turns t ON t.id=p.turnId
        LEFT JOIN agent_responses r ON r.id=? AND r.turnId=t.id
        WHERE c.id=? AND (t.id=? OR r.id=?)
        ORDER BY p.sequence DESC LIMIT 1`).get(targetMessageId, conversationId, targetMessageId, targetMessageId) as {
          responseTurnId?: string; turnId: string; sequence: number; kind: string
        } | undefined
      if (!target || target.kind === 'opening') throw new Error('只能从用户输入或对应的 AI 回复重新生成。')
      const turnId = target.responseTurnId || target.turnId
      const user = this.store.native.prepare('SELECT id FROM agent_turns WHERE id=?').get(turnId) as { id: string } | undefined
      if (!user) throw new Error('找不到需要重新生成的用户输入。')
      const currentInput = sourceInput ?? this.get(conversationId, turnId)
      const inputImages = currentInput.inputImageAttachments ?? []
      const inputFiles = currentInput.inputFileAttachments ?? []
      const nextText = replacement === undefined ? currentInput.content : replacement.trim()
      if (!nextText && inputImages.length === 0 && inputFiles.length === 0) throw new Error('用户输入不能为空。')

      const branch = this.store.native.prepare('SELECT activeBranchId AS branchId FROM agent_conversations WHERE id=?').get(conversationId) as { branchId: string } | undefined
      if (!branch) throw new Error('找不到当前对话分支。')
      const previousRuntimeThreadIds = (this.store.native.prepare(`SELECT DISTINCT r.runtimeThreadId
        FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId
        WHERE p.branchId=? AND r.runtimeThreadId<>'' ORDER BY r.runtimeThreadId`).all(branch.branchId) as { runtimeThreadId: string }[])
        .map((row) => row.runtimeThreadId)
      const tail = this.store.native.prepare('SELECT turnId FROM agent_branch_turns WHERE branchId=? AND sequence>=?').all(branch.branchId, target.sequence) as { turnId: string }[]
      const tailIds = [...new Set(tail.map((row) => row.turnId))]
      const responseIds = tailIds.length
        ? this.store.native.prepare(`SELECT id FROM agent_responses WHERE conversationId=? AND turnId IN (${tailIds.map(() => '?').join(',')})`).all(conversationId, ...tailIds) as { id: string }[]
        : []
      this.store.native.prepare('DELETE FROM agent_branch_turns WHERE branchId=? AND sequence>?').run(branch.branchId, target.sequence)
      for (const row of responseIds) {
        this.drafts.delete(row.id)
        this.store.native.prepare("DELETE FROM agent_setting_snapshots WHERE conversationId=? AND ownerType='response' AND ownerId=?").run(conversationId, row.id)
      }
      for (const row of tailIds) {
        this.drafts.delete(row)
        this.store.native.prepare("DELETE FROM agent_setting_snapshots WHERE conversationId=? AND ownerType='turn' AND ownerId=?").run(conversationId, row)
      }
      if (responseIds.length) this.store.native.prepare(`DELETE FROM agent_responses WHERE id IN (${responseIds.map(() => '?').join(',')})`).run(...responseIds.map((row) => row.id))
      for (const row of tailIds.filter((id) => id !== turnId)) this.store.native.prepare('DELETE FROM agent_turns WHERE id=?').run(row)
      const referencedRuntimeThreadIds = new Set((this.store.native.prepare(`
        SELECT DISTINCT runtimeThreadId FROM agent_responses WHERE runtimeThreadId<>''
      `).all() as { runtimeThreadId: string }[]).map((row) => row.runtimeThreadId))
      const stableRuntimeThreadId = this.conversationRuntimeThreadId(conversationId)
      const obsoleteRuntimeThreadIds = previousRuntimeThreadIds.filter((id) =>
        !referencedRuntimeThreadIds.has(id) && id !== stableRuntimeThreadId)
      const draft = { content: nextText, images: inputImages, files: inputFiles, process: [] }
      this.writePendingInput(turnId, draft)
      this.drafts.set(turnId, draft)
      const retained = this.store.native.prepare('SELECT COUNT(*) AS count FROM agent_branch_turns WHERE branchId=?').get(branch.branchId) as { count: number }
      const retainedResponses = this.store.native.prepare('SELECT COUNT(*) AS count FROM agent_responses r JOIN agent_branch_turns p ON p.turnId=r.turnId WHERE p.branchId=?').get(branch.branchId) as { count: number }
      const users = this.store.native.prepare("SELECT COUNT(*) AS count FROM agent_branch_turns p JOIN agent_turns t ON t.id=p.turnId WHERE p.branchId=? AND t.kind='user'").get(branch.branchId) as { count: number }
      this.store.native.prepare('UPDATE chat_sessions SET historyMessageCount=?,historyUserMessageCount=?,updatedAt=? WHERE id=?')
        .run(retained.count + retainedResponses.count, users.count, new Date().toISOString(), conversationId)
      const state = this.store.native.prepare('SELECT variableStateJson FROM agent_turns WHERE id=?').get(turnId) as { variableStateJson: string } | undefined
      if (state?.variableStateJson) {
        writeCurrentConversationVariableState(conversationId, state.variableStateJson, this.store.db)
      }
      return {
        turnId, text: nextText, inputImages, inputFiles,
        runtimeThreadId: stableRuntimeThreadId,
        obsoleteRuntimeThreadIds,
        retainedTurns: users.count
      }
    })
  }

  upsertProcessItem(messageId: string, item: AgentProcessItem): void {
    const response = this.response(messageId)
    const draft = this.drafts.get(response.id)
    if (!draft) return
    const index = draft.process.findIndex((entry) => entry.id === item.id)
    if (index < 0) draft.process.push(item)
    else draft.process[index] = item
  }

  finish(messageId: string, content: string, status: MessageStatus, _db?: ElecKoiDatabase, variableStateJson?: string, storedRegexRules: RegexRule[] = []): ChatMessage {
    return this.store.withWriteTx(() => {
      const response = this.response(messageId)
      const path = this.store.native.prepare(`SELECT p.sequence FROM agent_branch_turns p
        JOIN agent_conversations c ON c.activeBranchId=p.branchId WHERE p.turnId=? AND c.id=?`).get(response.turnId, response.conversationId) as { sequence: number } | undefined
      if (!path) throw new Error('生成回复已不属于活动分支。')
      if (response.status !== 'pending') return this.project(response.conversationId, {
        id: messageId, ownerId: response.id, ownerType: 'response', turnId: response.turnId,
        speakerId: response.speakerId, sequence: path.sequence, responseIndex: response.responseIndex,
        role: 'assistant', status: response.status, createdAt: response.createdAt, variableStateJson: response.variableStateJson
      })
      const draft = this.drafts.get(response.id)
      if (draft) draft.content = content
      this.store.native.prepare('UPDATE agent_responses SET storedRegexRulesJson=? WHERE id=?')
        .run(JSON.stringify(storedRegexRules), response.id)
      if (variableStateJson === undefined) {
        this.store.native.prepare('UPDATE agent_responses SET status=? WHERE id=?').run(toStoredStatus(status), response.id)
      } else {
        this.store.native.prepare('UPDATE agent_responses SET status=?,variableStateJson=? WHERE id=?')
          .run(toStoredStatus(status), variableStateJson, response.id)
      }
      if (draft) draft.process = draft.process.map((item) => item.status === 'running'
        ? { ...item, status: status === 'cancelled' ? 'cancelled' : status === 'error' ? 'error' : 'complete', completedAtMillis: Date.now() }
        : item)
      if (response.dshTurn !== null && this.transcriptReader?.(response.runtimeThreadId)
        ?.some((turn) => turn.turn === response.dshTurn && turn.userSeq !== null)) {
        this.store.native.prepare('DELETE FROM agent_pending_inputs WHERE turnId=?').run(response.turnId)
      }
      this.publish(response.conversationId)
      return this.project(response.conversationId, {
        id: messageId, ownerId: response.id, ownerType: 'response', turnId: response.turnId,
        speakerId: response.speakerId, sequence: path.sequence, responseIndex: response.responseIndex,
        role: 'assistant', status: toStoredStatus(status), createdAt: response.createdAt,
        variableStateJson: variableStateJson ?? response.variableStateJson
      })
    })
  }

  private response(messageId: string) {
    // Desktop message identities are the response primary key, never a scan of all source-message IDs.
    const response = this.store.native.prepare('SELECT * FROM agent_responses WHERE id=?').get(messageId) as { id: string; conversationId: string; turnId: string; speakerId: string; status: string; responseIndex: number; createdAt: string; variableStateJson: string; runtimeThreadId: string; dshTurn: number | null } | undefined
    if (!response) throw new Error('找不到正在生成的回复。')
    return response
  }

  private ensureSpeaker(conversationId: string, speaker: Speaker): string {
    const existing = this.store.native.prepare('SELECT id FROM conversation_speakers WHERE conversationId=? AND sourceSpeakerId=?').get(conversationId, speaker.id) as { id: string } | undefined
    if (existing) return existing.id
    const id = randomUUID()
    this.store.native.prepare('INSERT INTO conversation_speakers(id,conversationId,sourceSpeakerId,kind,displayName,avatarAssetId) VALUES (?,?,?,?,?,?)').run(id, conversationId, speaker.id, speaker.kind, speaker.name, speaker.avatar)
    return id
  }

  private readPendingInput(turnId: string): DraftMessage | undefined {
    const row = this.store.native.prepare('SELECT draftJson FROM agent_pending_inputs WHERE turnId=?')
      .get(turnId) as { draftJson: string } | undefined
    if (!row) return undefined
    const value: unknown = JSON.parse(row.draftJson)
    if (!value || typeof value !== 'object' || !('content' in value) || typeof value.content !== 'string'
      || !('images' in value) || !Array.isArray(value.images)
      || !('files' in value) || !Array.isArray(value.files)) {
      throw new Error('待提交的用户输入记录无效。')
    }
    return { content: value.content, images: value.images, files: value.files, process: [] }
  }

  private writePendingInput(turnId: string, draft: DraftMessage): void {
    this.store.native.prepare(`INSERT INTO agent_pending_inputs(turnId,draftJson) VALUES (?,?)
      ON CONFLICT(turnId) DO UPDATE SET draftJson=excluded.draftJson`)
      .run(turnId, JSON.stringify({ content: draft.content, images: draft.images, files: draft.files }))
  }

  private publish(conversationId: string, messages = 0, users = 0): void {
    if (messages) this.store.native.prepare('UPDATE chat_sessions SET historyMessageCount=historyMessageCount+?,historyUserMessageCount=historyUserMessageCount+?,updatedAt=? WHERE id=?')
      .run(messages, users, new Date().toISOString(), conversationId)
  }

  private project(
    conversationId: string,
    row: LedgerMessage,
    transcripts = new Map<string, readonly RuntimeTranscriptTurn[] | undefined>()
  ): ChatMessage {
    const speaker = this.store.native.prepare('SELECT displayName,avatarAssetId FROM conversation_speakers WHERE id=? AND conversationId=?').get(row.speakerId, conversationId) as { displayName: string; avatarAssetId: string } | undefined
    const draft = this.drafts.get(row.ownerId) ?? (row.role === 'user' ? this.readPendingInput(row.ownerId) : undefined)
    const openingContent = row.id === 'opening'
      ? (this.store.native.prepare('SELECT content FROM agent_openings WHERE conversationId=? AND turnId=?')
        .get(conversationId, row.ownerId) as { content: string } | undefined)?.content
      : undefined
    let process = draft?.process ?? []
    let messageContent = openingContent ?? draft?.content ?? ''
    let transcript: RuntimeTranscriptTurn | undefined
    let runtimeSessionId = ''
    if (row.id !== 'opening') {
      const binding = row.ownerType === 'response'
        ? this.store.native.prepare(`SELECT runtimeThreadId,dshTurn,storedRegexRulesJson FROM agent_responses
            WHERE conversationId=? AND id=? AND dshTurn IS NOT NULL`)
          .get(conversationId, row.ownerId) as { runtimeThreadId: string; dshTurn: number; storedRegexRulesJson: string } | undefined
        : row.role === 'user'
          ? this.store.native.prepare(`SELECT runtimeThreadId,dshTurn,storedRegexRulesJson FROM agent_responses
              WHERE conversationId=? AND turnId=? AND dshTurn IS NOT NULL
              ORDER BY responseIndex DESC LIMIT 1`)
            .get(conversationId, row.turnId) as { runtimeThreadId: string; dshTurn: number; storedRegexRulesJson: string } | undefined
          : undefined
      if (binding) {
        runtimeSessionId = binding.runtimeThreadId
        if (!transcripts.has(binding.runtimeThreadId)) {
          transcripts.set(binding.runtimeThreadId, this.transcriptReader?.(binding.runtimeThreadId))
        }
        transcript = transcripts.get(binding.runtimeThreadId)?.find((item) => item.turn === binding.dshTurn)
        if (!transcript && row.status === 'completed' && !draft) throw new Error('当前消息对应的 DSH 会话日志无法读取。')
        if (transcript) {
          messageContent = row.role === 'user' ? (transcript.userSeq !== null ? transcript.userText : draft?.content ?? '') : transcript.assistantText
            ? transformWithRegexRules(
            transcript.assistantText,
            parseStoredRegexRules(binding.storedRegexRulesJson),
            'AiOutput'
          ) : draft?.content ?? ''
          if (row.ownerType === 'response') process = transcript.process.length ? transcript.process : process
        }
      }
    }
    const inputImageAttachments = row.role === 'user'
      ? transcript?.userSeq !== null && transcript !== undefined ? transcript.userImages : draft?.images ?? []
      : []
    const inputFileAttachments = row.role === 'user'
      ? transcript?.userSeq !== null && transcript !== undefined ? transcript.userFiles ?? [] : draft?.files ?? []
      : []
    const openingSelectable = row.id === 'opening' && !(this.store.native.prepare(
      'SELECT historyUserMessageCount FROM chat_sessions WHERE id=?'
    ).get(conversationId) as { historyUserMessageCount: number } | undefined)?.historyUserMessageCount
    const opening = openingSelectable
      ? this.store.native.prepare('SELECT payloadJson FROM agent_openings WHERE conversationId=? AND turnId=?').get(conversationId, row.ownerId) as { payloadJson: string } | undefined
      : undefined
    let openingData: { options?: ChatMessage['openingOptions']; selectedId?: string } = {}
    if (opening?.payloadJson) {
      try { openingData = JSON.parse(opening.payloadJson) as typeof openingData } catch { openingData = {} }
    }
    return { id: row.id, conversationId, turnId: row.turnId, speakerId: row.speakerId, sequence: row.sequence,
      speakerName: speaker?.displayName ?? '', speakerAvatar: speaker?.avatarAssetId ?? '',
      ...(row.responseIndex >= 0 ? { responseIndex: row.responseIndex } : {}), role: row.role,
      content: messageContent, variableStateJson: row.variableStateJson ?? '{}',
      status: toMessageStatus(row.status), createdAt: row.createdAt,
      ...(runtimeSessionId ? { runtimeSessionId } : {}),
      ...(row.ownerType === 'response' && transcript?.assistantMessageId
        ? { dshMessageId: transcript.assistantMessageId }
        : row.role === 'user' && transcript?.userMessageId
          ? { dshMessageId: transcript.userMessageId } : {}),
      ...(process.length ? { process } : {}),
      ...(row.ownerType === 'response' && transcript?.turnUsage ? { turnUsage: transcript.turnUsage } : {}),
      ...(inputImageAttachments.length ? { inputImageAttachments } : {}),
      ...(inputFileAttachments.length ? { inputFileAttachments } : {}),
      ...(openingData.options?.length ? { openingOptions: openingData.options, selectedOpeningId: openingData.selectedId ?? '' } : {}) }
  }

}

function parseStoredRegexRules(raw: string): RegexRule[] {
  try { return regexRuleSchema.array().parse(JSON.parse(raw)) }
  catch (error) { throw new Error('聊天消息的正则快照无法读取。', { cause: error }) }
}
