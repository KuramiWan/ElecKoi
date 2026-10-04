import type { Context, Plugin } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-projection'
import { createUserMessage, ReasoningEffortId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AgentPreset,
  AgentPresetCatalog,
  AgentPresetExportFormat,
  AgentPresetExportResult,
  AgentPresetImportDocument,
  AgentPresetImportResult,
  AgentPresetImportSource,
  AuthorConversationState,
  CreateCreatorProjectInput,
  CharacterCollection,
  CharacterExportFormat,
  CharacterExportResult,
  CharacterGroupAssignment,
  CharacterImportFile,
  CharacterImportPreview,
  CharacterImportResult,
  CharacterImportSource,
  CharacterRecord,
  CharacterConfigurationChange,
  ConversationChange,
  ConversationArchiveSnapshot,
  ConversationModelSelection,
  ConversationCreateInput,
  ConversationDetailsMetadata,
  ConversationMessageDisplayInput,
  ConversationMessageDisplayResult,
  ConversationSummary,
  CreatorProjectCollection,
  DisplayPreferencesSnapshot,
  DisplayPreferenceValue,
  ElecKoiHostStatus,
  ElecKoiProductDataStore,
  PersonaProfile,
  ProductRecordChange,
  RegexRule,
  RegexRuleCollection,
  RegexRuleImportDocument,
  RegexRuleImportResult,
  RegexRuleScope,
  RegexRuleTarget,
  RegexRuleTestResult,
  SettingLibrary,
  SettingLibraryConversation,
  TavilyConnection,
  WebSearchMode,
  VariableConfig,
  VariableViewerTimeline
} from './types.js'
import { testTavilyConnection } from './tavily.js'
import { testModelConnection, discoverDraftModels, readModelApiKey } from './modelConnection.js'
export { testModelConnection, discoverDraftModels, readModelApiKey } from './modelConnection.js'
import type { ModelConnectionInput, ModelDiscoveryInput, ModelDiscoveryResult } from './types.js'

export type {
  AgentPreset,
  AgentPresetCatalog,
  AgentPresetExportFormat,
  AgentPresetExportResult,
  AgentPresetImportDocument,
  AgentPresetImportResult,
  AgentPresetImportSource,
  AgentPresetLibraryGroup,
  AgentPresetModelFamily,
  AgentPresetModelTag,
  AgentPresetProfile,
  AgentPresetSummary,
  AgentPresetTimelineItem,
  AgentToolGroup,
  AgentToolMember,
  AuthorConversationState,
  TavilyConnection,
  WebSearchMode,
  CreateCreatorProjectInput,
  CharacterCollection,
  CharacterExportFormat,
  CharacterExportResult,
  CharacterGroupAssignment,
  CharacterImportFile,
  CharacterImportPreview,
  CharacterImportPreviewItem,
  CharacterImportResult,
  CharacterImportSource,
  CharacterPersona,
  CharacterRecord,
  CharacterConfigurationChange,
  ConversationChange,
  ConversationModelSelection,
  ConversationMetadata,
  ConversationArchiveSnapshot,
  ConversationRecord,
  ConversationCreateInput,
  ConversationSummary,
  CreatorProject,
  CreatorProjectCollection,
  CreatorProjectMode,
  DisplayPreferencesSnapshot,
  DisplayPreferenceValue,
  ElecKoiHostStatus,
  PersonaProfile,
  ProductRecordChange,
  RegexRule,
  RegexRuleCollection,
  RegexRuleImportDocument,
  RegexRuleImportResult,
  RegexRuleScope,
  RegexRuleTarget,
  RegexRuleTestResult,
  RegexRuleVersion,
  SettingLibrary,
  SettingLibraryConversation,
  SettingLibraryEntry,
  SettingLibraryGroup,
  SettingLibraryPromptPosition,
  SettingLibraryVersion,
  VariableConfig,
  VariableConfigVersion,
  VariableItemConfig,
  VariableObjectConfig,
  VariableViewerTimeline
} from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    eleckoiSystemApi: ElecKoiSystemApi
    eleckoiModelsApi: ElecKoiModelsApi
    eleckoiPersonaApi: ElecKoiPersonaApi
    eleckoiCharactersApi: ElecKoiCharactersApi
    eleckoiCharacterConfigurationApi: ElecKoiCharacterConfigurationApi
    eleckoiAgentPresetsApi: ElecKoiAgentPresetsApi
    eleckoiCreatorStudioApi: ElecKoiCreatorStudioApi
    eleckoiWebSearchApi: ElecKoiWebSearchApi
    eleckoiDisplayPreferencesApi: ElecKoiDisplayPreferencesApi
    eleckoiConversationModelsApi: ElecKoiConversationModelsApi
    eleckoiConversationsApi: ElecKoiConversationsApi
    eleckoiConversationChanges: ConversationChangeFeed
    eleckoiCharacterConfigurationChanges: CharacterConfigurationChangeFeed
    eleckoiProductRecordChanges: ProductRecordChangeFeed
    eleckoiProductData: ElecKoiProductDataStore
    eleckoiRoleplaySessions: {
      create(conversationId: string): Promise<string>
      prepareSessionAccess(conversationId: string): Promise<string>
      preparePrompt(conversationId: string, text: string): Promise<string>
      prepareRegeneration(conversationId: string, text: string): Promise<{
        rollback(): void
      }>
      variableStatesByTurn(conversationId: string): Record<string, string>
      prepareRestoreBeforeTurn(conversationId: string, sessionId: string, fromTurn: number, beforeMessageId?: string): () => void
      removeArtifacts(conversationId: string, sessionId: string): void
    }
    eleckoiSessionEditor: {
      editMessage(sessionId: string, eventSeq: number, role: 'user' | 'assistant', content: string): Promise<void>
      rewind(sessionId: string, fromTurn: number, fromEventSeq?: number): Promise<number | undefined>
      transaction<T>(sessionId: string, operation: () => Promise<T>): Promise<T>
      deleteSession(sessionId: string): Promise<void>
    }
  }
}

const WEB_ENTRY_ID = 'web'
const DEEPSEEK_WEB_PROVIDER = 'deepseek-official'
const TAVILY_WEB_PROVIDER = 'tavily'
const TAVILY_API_KEY_REF = 'TAVILY_API_KEY'
const DISPLAY_PREFERENCES_NAMESPACE = 'eleckoi-display-preferences'

interface RemoteChangeSubscriber<T> {
  readonly queue: T[]
  closed: boolean
  waiter: (() => void) | undefined
}

/**
 * Host-owned notification feed for product projection changes.
 *
 * It carries no message history and has no replay state. Each Remote stream
 * starts with a snapshot marker so a reconnecting Client can refresh its
 * authoritative DSH Session/product projections before accepting deltas.
 */
class RemoteChangeFeed<T> {
  private readonly subscribers = new Set<RemoteChangeSubscriber<T>>()

  constructor(private readonly snapshot: T) {}

  stream(signal: AbortSignal): AsyncIterable<T> {
    const subscriber: RemoteChangeSubscriber<T> = {
      queue: [this.snapshot],
      closed: false,
      waiter: undefined
    }
    this.subscribers.add(subscriber)
    const close = (): void => {
      if (subscriber.closed) return
      subscriber.closed = true
      this.subscribers.delete(subscriber)
      subscriber.waiter?.()
      subscriber.waiter = undefined
    }
    const abort = (): void => close()
    if (signal.aborted) close()
    else signal.addEventListener('abort', abort, { once: true })

    return (async function* (): AsyncIterable<T> {
      try {
        while (!subscriber.closed) {
          if (subscriber.queue.length > 0) {
            yield subscriber.queue.shift() as T
            continue
          }
          await new Promise<void>((resolve) => { subscriber.waiter = resolve })
          subscriber.waiter = undefined
        }
      } finally {
        signal.removeEventListener('abort', abort)
        close()
      }
    })()
  }

  publish(change: T): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.closed) continue
      subscriber.queue.push(change)
      subscriber.waiter?.()
      subscriber.waiter = undefined
    }
  }

  close(): void {
    for (const subscriber of this.subscribers) subscriber.closed = true
    for (const subscriber of this.subscribers) subscriber.waiter?.()
    this.subscribers.clear()
  }
}

export class ConversationChangeFeed extends RemoteChangeFeed<ConversationChange> {
  constructor() {
    super({ kind: 'snapshot' })
  }
}

export class CharacterConfigurationChangeFeed extends RemoteChangeFeed<CharacterConfigurationChange> {
  constructor() {
    super({ kind: 'snapshot' })
  }
}

export class ProductRecordChangeFeed extends RemoteChangeFeed<ProductRecordChange> {
  constructor() {
    super({ kind: 'snapshot' })
  }
}

function productRecordChanges(
  feed: ProductRecordChangeFeed,
  signal: AbortSignal,
  domain: Exclude<ProductRecordChange, { kind: 'snapshot' }>['domain']
): AsyncIterable<ProductRecordChange> {
  return (async function* () {
    for await (const change of feed.stream(signal)) {
      if (change.kind === 'snapshot' || change.domain === domain) yield change
    }
  })()
}

export class ElecKoiDisplayPreferencesApi extends TypertRemoteService {
  static inject = ['typert', 'settings', 'eleckoiProductData']

  private readonly ownerContext: Context
  private readonly productData: ElecKoiProductDataStore

  constructor(ctx: Context) {
    super(ctx, 'eleckoiDisplayPreferencesApi', { namespace: 'eleckoiDisplayPreferences' })
    this.ownerContext = ctx
    this.productData = ctx.eleckoiProductData
  }

  @Remote
  read(): DisplayPreferencesSnapshot {
    return this.snapshot()
  }

  @Remote
  async updateUi(
    ui: Record<string, DisplayPreferenceValue>,
    expectedRevision?: number
  ): Promise<DisplayPreferencesSnapshot> {
    const pending = this.productData.prepareDisplayUi(ui)
    try {
      await this.ownerContext.settings.mutate(
        DISPLAY_PREFERENCES_NAMESPACE,
        [{ op: 'set', path: ['ui'], value: pending.value }],
        expectedRevision
      )
      pending.commit()
      this.productData.setDisplayPreferences(pending.value)
      return this.snapshot()
    } catch (error) {
      pending.rollback()
      throw error
    }
  }

  @Remote
  async setChatDisplay(
    chatDisplay: Record<string, DisplayPreferenceValue>,
    expectedRevision?: number
  ): Promise<DisplayPreferencesSnapshot> {
    await this.ownerContext.settings.mutate(
      DISPLAY_PREFERENCES_NAMESPACE,
      [{ op: 'set', path: ['chatDisplay'], value: chatDisplay }],
      expectedRevision
    )
    return this.snapshot()
  }

  private snapshot(): DisplayPreferencesSnapshot {
    const descriptor = this.ownerContext.settings.describe()
      .find(item => item.ns === DISPLAY_PREFERENCES_NAMESPACE)
    if (!descriptor) throw new Error('DSH 显示偏好配置尚未加载。')
    const value = jsonObject(descriptor.value)
    return {
      ui: jsonObject(value.ui),
      chatDisplay: jsonObject(value.chatDisplay),
      writable: this.ownerContext.settings.writable,
      revision: descriptor.revision
    }
  }
}

export class ElecKoiConversationModelsApi extends TypertRemoteService {
  static inject = ['typert', 'llm', 'agentDefaultModel']

  private readonly ownerContext: Context

  constructor(ctx: Context) {
    super(ctx, 'eleckoiConversationModelsApi', { namespace: 'eleckoiConversationModels' })
    this.ownerContext = ctx
  }

  @Remote
  async current(conversationId: string): Promise<ConversationModelSelection> {
    void conversationId
    const selected = this.ownerContext.agentDefaultModel.currentSelection()
    return {
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: String(selected.reasoningEffort) })
    }
  }

  @Remote
  async select(conversationId: string, selection: ConversationModelSelection): Promise<ConversationModelSelection> {
    void conversationId
    const selected = await this.ownerContext.llm.resolveCallConfig({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) })
    })
    await this.ownerContext.agentDefaultModel.saveSelection(selected)
    return {
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: String(selected.reasoningEffort) })
    }
  }
}

export class ElecKoiConversationsApi extends TypertRemoteService {
  private readonly pendingRegenerations = new Map<string, { requestId: string; message: ReturnType<typeof regeneratedUserMessage> }>()
  static inject = [
    'typert',
    'agents',
    'sessionController',
    'sessionPersistence',
    'eleckoiProductData',
    'eleckoiRoleplaySessions',
    'eleckoiSessionEditor',
    'eleckoiConversationChanges'
  ]

  private readonly ownerContext: Context
  private readonly productData: ElecKoiProductDataStore
  private readonly changeFeed: ConversationChangeFeed

  constructor(ctx: Context) {
    super(ctx, 'eleckoiConversationsApi', { namespace: 'eleckoiConversations' })
    this.ownerContext = ctx
    this.productData = ctx.eleckoiProductData
    this.changeFeed = ctx.eleckoiConversationChanges
  }

  @Remote({ mode: 'stream' })
  changes(signal: AbortSignal): AsyncIterable<ConversationChange> {
    return this.changeFeed.stream(signal)
  }

  @Remote
  async list(signal: AbortSignal): Promise<ConversationSummary[]> {
    const records = this.productData.readConversationCatalog()
    return Promise.all(records.map(async (summary) => {
      try {
        const inspection = await this.ownerContext.sessionController.inspect(
          summary.runtimeSessionId as SessionId,
          signal
        )
        return { ...summary, preview: latestSessionPreview(inspection.events) || summary.preview }
      } catch {
        return summary
      }
    }))
  }

  @Remote
  details(conversationId: string, beforeSequence?: number, limit?: number): ConversationDetailsMetadata {
    return {
      ...this.productData.readConversationDetails(conversationId, beforeSequence, limit),
      runtimeVariableStateByTurn: this.ownerContext.eleckoiRoleplaySessions.variableStatesByTurn(conversationId)
    }
  }

  @Remote
  projectDisplay(
    conversationId: string,
    messages: ConversationMessageDisplayInput[]
  ): ConversationMessageDisplayResult[] {
    if (!Array.isArray(messages) || messages.length > 200) throw new Error('待显示的消息数量无效。')
    let totalLength = 0
    for (const message of messages) {
      if (!message || typeof message.id !== 'string' || !message.id
        || (message.role !== 'user' && message.role !== 'assistant')
        || typeof message.content !== 'string'
        || typeof message.variableStateJson !== 'string'
        || !['complete', 'streaming', 'error', 'cancelled'].includes(message.status)
        || typeof message.createdAt !== 'string') {
        throw new Error('待显示的消息格式无效。')
      }
      totalLength += message.content.length + message.variableStateJson.length
    }
    if (totalLength > 4 * 1024 * 1024) throw new Error('待显示的消息内容过大。')
    return this.productData.projectConversationMessages(conversationId, messages)
  }

  @Remote
  async variableTimeline(conversationId: string): Promise<VariableViewerTimeline> {
    const runtimeSessionId = this.productData.runtimeSessionId(conversationId)
    const inspection = await this.ownerContext.sessionController.inspect(runtimeSessionId as SessionId)
    const variableStateByTurn = this.ownerContext.eleckoiRoleplaySessions.variableStatesByTurn(conversationId)
    const sessionMessages = sessionAssistantMessages(
      conversationId,
      runtimeSessionId,
      inspection.events,
      variableStateByTurn
    )
    return this.productData.readVariableTimeline(conversationId, sessionMessages)
  }

  @Remote
  authorState(conversationId: string): AuthorConversationState {
    return this.productData.readAuthorConversationState(conversationId)
  }

  @Remote
  replaceVariableState(conversationId: string, stateJson: string): string {
    const next = this.productData.replaceConversationVariableState(conversationId, stateJson)
    this.changeFeed.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: [] })
    return next
  }

  @Remote
  async exportArchive(conversationId: string): Promise<string> {
    const snapshot = this.productData.exportConversationArchive(conversationId)
    const runtimeSessionIds = this.productData.conversationArchiveRuntimeSessionIds(snapshot)
    const requiredIds = new Set(this.productData.requiredConversationArchiveRuntimeSessionIds(snapshot))
    const sessionLogs: DshSessionArchive[] = []
    for (const runtimeSessionId of runtimeSessionIds) {
      const liveAgent = this.ownerContext.agents.get(runtimeSessionId as SessionId)
      if (liveAgent !== undefined && liveAgent.status !== 'idle') {
        throw new Error('请先等待当前回复结束，再导出聊天记录。')
      }
      try {
        const inspection = await this.ownerContext.sessionController.inspect(runtimeSessionId as SessionId)
        sessionLogs.push({
          header: inspection.meta,
          inheritedEventCount: inspection.inheritedEventCount,
          events: [...inspection.events]
        })
      } catch (error) {
        if (requiredIds.has(runtimeSessionId)) throw new Error('聊天记录缺少对应的 DSH 会话日志，无法完整导出。', { cause: error })
      }
    }
    const archivedIds = new Set(sessionLogs.map((item) => item.header.id as string))
    if ([...requiredIds].some((id) => !archivedIds.has(id))) {
      throw new Error('聊天记录缺少对应的 DSH 会话日志，无法完整导出。')
    }
    return JSON.stringify({
      format: 'eleckoi.desktop-chat-history',
      version: 1,
      exportedAt: new Date().toISOString(),
      snapshot,
      sessionLogs
    }, null, 2)
  }

  @Remote
  async importArchive(characterId: string, json: string): Promise<string> {
    if (json.length > 100_000_000) throw new Error('聊天记录文件过大。')
    let value: unknown
    try { value = JSON.parse(json) } catch { throw new Error('聊天记录不是有效的 JSON 文件。') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('聊天记录文件格式不正确。')
    const archive = value as Record<string, unknown>
    if (archive.format !== 'eleckoi.desktop-chat-history' || archive.version !== 1
      || !Array.isArray(archive.sessionLogs)) throw new Error('不支持此聊天记录文件。')
    const snapshot = this.productData.parseConversationArchive(archive.snapshot)
    if (snapshot.characterId !== characterId) throw new Error('聊天记录与当前角色不匹配。')
    const expectedIds = new Set(this.productData.conversationArchiveRuntimeSessionIds(snapshot))
    const logs = parseDshSessionArchives(archive.sessionLogs, expectedIds)
    const archivedIds = new Set(logs.map((item) => item.header.id as string))
    if (this.productData.requiredConversationArchiveRuntimeSessionIds(snapshot).some((id) => !archivedIds.has(id))) {
      throw new Error('聊天记录缺少对应的 DSH 会话日志。')
    }
    const conversationId = randomUUID()
    const ids = new Map([...expectedIds].map((id) => [id, id === snapshot.conversationId ? conversationId : randomUUID()]))
    const createdIds: string[] = []
    try {
      for (const log of logs) {
        const id = ids.get(log.header.id as string)
        if (!id) throw new Error('聊天记录缺少 DSH 会话映射。')
        const parentSession = log.header.parentSession
        const header = {
          ...log.header,
          id,
          cwd: process.env.ELECKOI_WORKSPACE_ROOT ?? log.header.cwd,
          ...(parentSession === undefined ? {} : { parentSession: ids.get(parentSession as string) ?? parentSession })
        } as SessionHeader
        const handle = await this.ownerContext.sessionPersistence.create(header, {
          inheritedEventCount: SessionLogOffset(log.inheritedEventCount)
        })
        createdIds.push(id)
        try {
          if (log.events.length > 0) await handle.append(log.events)
          await handle.flush()
        } finally {
          await handle.close()
        }
      }
      const importedId = this.productData.importConversationArchive(snapshot, characterId, ids, conversationId)
      this.changeFeed.publish({ kind: 'catalog', conversationId: importedId, reason: 'created' })
      return importedId
    } catch (error) {
      await Promise.allSettled(createdIds.map((id) => this.ownerContext.eleckoiSessionEditor.deleteSession(id)))
      throw error
    }
  }

  @Remote
  async revealFile(
    conversationId: string,
    attachmentId: string,
    name: string,
    signal: AbortSignal
  ): Promise<void> {
    const runtimeSessionId = this.productData.runtimeSessionId(conversationId)
    const inspection = await this.ownerContext.sessionController.inspect(runtimeSessionId as SessionId, signal)
    if (!sessionContainsFile(inspection.events, attachmentId, name)) {
      throw new Error('文件不在当前聊天记录中。')
    }
    const path = storedFilePath(attachmentId, name)
    await this.ownerContext.sessionController.openWorkspacePath({ path, action: 'reveal' }, signal)
  }

  @Remote
  async create(input: ConversationCreateInput): Promise<ConversationDetailsMetadata> {
    const details = this.productData.createConversation(input)
    try {
      await this.ownerContext.eleckoiRoleplaySessions.create(details.conversation.id)
      this.changeFeed.publish({ kind: 'catalog', conversationId: details.conversation.id, reason: 'created' })
      return this.productData.readConversationDetails(details.conversation.id)
    } catch (error) {
      await this.productData.deleteConversation(details.conversation.id)
      throw error
    }
  }

  @Remote
  async delete(conversationId: string): Promise<void> {
    const runtimeSessionId = this.productData.runtimeSessionId(conversationId)
    await this.ownerContext.eleckoiSessionEditor.deleteSession(runtimeSessionId)
    this.ownerContext.eleckoiRoleplaySessions.removeArtifacts(conversationId, runtimeSessionId)
    await this.productData.deleteConversation(conversationId)
    this.changeFeed.publish({ kind: 'catalog', conversationId, reason: 'deleted' })
  }

  @Remote
  async preparePrompt(conversationId: string, text: string): Promise<{ runtimeSessionId: string }> {
    const runtimeSessionId = await this.ownerContext.eleckoiRoleplaySessions.preparePrompt(conversationId, text)
    return { runtimeSessionId }
  }

  @Remote
  async editMessage(
    conversationId: string,
    eventSeq: number,
    role: 'user' | 'assistant',
    content: string
  ): Promise<ConversationDetailsMetadata> {
    const runtimeSessionId = this.productData.runtimeSessionId(conversationId)
    await requireSessionMessage(
      await this.ownerContext.sessionController.inspect(runtimeSessionId as SessionId),
      eventSeq,
      role
    )
    await this.ownerContext.eleckoiSessionEditor.editMessage(runtimeSessionId, eventSeq, role, content)
    this.changeFeed.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: [String(eventSeq)] })
    return this.productData.readConversationDetails(conversationId)
  }

  @Remote
  async deleteMessagesFrom(
    conversationId: string,
    eventSeq: number,
    role: 'user' | 'assistant'
  ): Promise<{
    details: ConversationDetailsMetadata
    deletedMessageCount: number
    remainingMessageCount: number
  }> {
    const runtimeSessionId = this.productData.runtimeSessionId(conversationId)
    await this.ownerContext.eleckoiRoleplaySessions.prepareSessionAccess(conversationId)
    const inspection = await this.ownerContext.sessionController.inspect(runtimeSessionId as SessionId)
    const target = requireSessionMessage(inspection, eventSeq, role)
    const fromTurn = sessionMessageTurn(inspection.events, target.index)
    const visible = visibleSessionMessages(inspection.events)
    const selectedVisibleIndex = visible.findIndex(item => item.seq === eventSeq)
    if (selectedVisibleIndex < 0) throw new Error('找不到要删除的 DSH 消息。')
    const retainedUser = role === 'assistant'
      ? directUserMessageBeforeTurn(inspection.events, target.index, fromTurn)
      : undefined
    const restoreRuntime = this.ownerContext.eleckoiRoleplaySessions.prepareRestoreBeforeTurn(
      conversationId,
      runtimeSessionId,
      fromTurn,
      historicalInputId(inspection.events, target.index)
    )
    const rewound = await this.ownerContext.eleckoiSessionEditor.rewind(runtimeSessionId, fromTurn, eventSeq)
    if (rewound === undefined) throw new Error('当前 DSH Session 不能安全回退。')
    restoreRuntime()
    if (retainedUser !== undefined) {
      const resolved = await this.ownerContext.sessionController.resolveAgent(runtimeSessionId as SessionId)
      if ('error' in resolved) throw resolved.error
      resolved.agent.session.append('user/message', retainedUser as never, { surfaceOp: 'append' })
    }
    this.changeFeed.publish({
      kind: 'messages',
      conversationId,
      reason: 'deleted',
      messageIds: visible.slice(selectedVisibleIndex).map(item => String(item.seq))
    })
    return {
      details: this.productData.readConversationDetails(conversationId),
      deletedMessageCount: visible.length - selectedVisibleIndex,
      remainingMessageCount: selectedVisibleIndex
    }
  }

  @Remote
  async regenerateMessage(
    conversationId: string,
    eventSeq: number,
    requestId: string,
    replacementMessage?: string
  ): Promise<{ runtimeSessionId: string; prepared: true }> {
    if (!requestId.trim()) throw new Error('重新生成请求缺少有效标识。')
    const runtimeSessionId = this.productData.runtimeSessionId(conversationId)
    await this.ownerContext.eleckoiRoleplaySessions.prepareSessionAccess(conversationId)
    const inspection = await this.ownerContext.sessionController.inspect(runtimeSessionId as SessionId)
    const target = requireSessionMessage(inspection, eventSeq, 'user')
    const fromTurn = sessionMessageTurn(inspection.events, target.index)
    const userMessage = regeneratedUserMessage(target.event, requestId, replacementMessage)
    const promptText = userMessage.content
      .flatMap(part => part.type === 'text' ? [part.text] : [])
      .join('')
    const restoreRuntime = this.ownerContext.eleckoiRoleplaySessions.prepareRestoreBeforeTurn(
      conversationId,
      runtimeSessionId,
      fromTurn,
      historicalInputId(inspection.events, target.index)
    )
    const preparation = await this.ownerContext.eleckoiRoleplaySessions.prepareRegeneration(conversationId, promptText)
    try {
      await this.ownerContext.eleckoiSessionEditor.transaction(runtimeSessionId, async () => {
        const rewound = await this.ownerContext.eleckoiSessionEditor.rewind(runtimeSessionId, fromTurn, eventSeq)
        if (rewound === undefined) throw new Error('当前 DSH Session 不能安全回退。')
        restoreRuntime()
        await this.ownerContext.eleckoiRoleplaySessions.preparePrompt(conversationId, promptText)
      })
    } catch (error) {
      preparation.rollback()
      this.changeFeed.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: [String(eventSeq)] })
      throw error
    }
    this.pendingRegenerations.set(conversationId, { requestId, message: userMessage })
    this.changeFeed.publish({ kind: 'messages', conversationId, reason: 'regenerated', messageIds: [String(eventSeq)] })
    return { runtimeSessionId, prepared: true }
  }

  @Remote
  async startRegeneration(conversationId: string, requestId: string, cancelled: boolean): Promise<{ accepted: boolean }> {
    const pending = this.pendingRegenerations.get(conversationId)
    if (!pending || pending.requestId !== requestId) throw new Error('重新生成请求已失效。')
    this.pendingRegenerations.delete(conversationId)
    if (cancelled) return { accepted: false }
    const runtimeSessionId = this.productData.runtimeSessionId(conversationId)
    const resolved = await this.ownerContext.sessionController.resolveAgent(runtimeSessionId as SessionId)
    if ('error' in resolved) throw resolved.error
    resolved.agent.followup(pending.message)
    return { accepted: true }
  }

  @Remote
  selectOpening(conversationId: string, openingId: string): ConversationDetailsMetadata {
    const details = this.productData.selectConversationOpening(conversationId, openingId)
    this.changeFeed.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: ['opening'] })
    return details
  }

  @Remote
  updateOpening(conversationId: string, content: string): ConversationDetailsMetadata {
    const details = this.productData.updateConversationOpening(conversationId, content)
    this.changeFeed.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: ['opening'] })
    return details
  }
}

interface DshSessionArchive {
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly events: SessionEvent[]
}

function parseDshSessionArchives(value: unknown[], expectedIds: ReadonlySet<string>): DshSessionArchive[] {
  const archivedIds = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('聊天记录中的 DSH 会话数据无效。')
    }
    const archive = item as Partial<DshSessionArchive>
    const id = archive.header?.id as string | undefined
    if (!id || !expectedIds.has(id) || archivedIds.has(id)
      || !Array.isArray(archive.events)
      || !Number.isSafeInteger(archive.inheritedEventCount)
      || (archive.inheritedEventCount ?? -1) < 0) {
      throw new Error('聊天记录中的 DSH 会话数据无效。')
    }
    archivedIds.add(id)
    return archive as DshSessionArchive
  })
}

function sessionContainsFile(events: readonly SessionEvent[], attachmentId: string, name: string): boolean {
  return events.some((event) => {
    if (event.type !== 'user/message') return false
    const content = (event.data as { content?: unknown }).content
    return Array.isArray(content) && content.some((block) => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return false
      const file = block as { type?: unknown; attachment?: { attachmentId?: unknown; name?: unknown } }
      return file.type === 'file'
        && file.attachment?.attachmentId === attachmentId
        && file.attachment.name === name
    })
  })
}

function storedFilePath(attachmentId: string, name: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(attachmentId)
  if (!match?.[1] || !name || name !== name.trim() || name === '.' || name === '..'
    || /[/\\\u0000-\u001f\u007f<>:"|?*]/u.test(name)) {
    throw new Error('文件附件引用无效。')
  }
  const home = process.env.DSH_HOME
  if (!home) throw new Error('DSH 附件目录尚未就绪。')
  return join(home, 'attachments', 'v1', 'files', match[1].slice(0, 2), match[1], name)
}

function latestSessionPreview(events: readonly unknown[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = jsonRecord(events[index])
    if (event.surfaceOp !== 'append' || (event.type !== 'assistant/message' && event.type !== 'user/message')) continue
    const message = jsonRecord(jsonRecord(event.data).message)
    const content = Array.isArray(message.content) ? message.content : []
    const text = content.flatMap((part) => {
      const block = jsonRecord(part)
      return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    }).join('').trim()
    if (text) return Array.from(text).slice(0, 240).join('')
  }
  return ''
}

function requireSessionMessage(
  inspection: { events: readonly unknown[] },
  eventSeq: number,
  role: 'user' | 'assistant'
): { event: Record<string, unknown>; index: number } {
  if (!Number.isSafeInteger(eventSeq) || eventSeq < 0) throw new Error('DSH 消息事件序号不正确。')
  const expectedType = role === 'user' ? 'user/message' : 'assistant/message'
  const index = inspection.events.findIndex((candidate) => {
    const event = jsonRecord(candidate)
    if (event.seq !== eventSeq || event.type !== expectedType || event.surfaceOp !== 'append') return false
    if (role !== 'user') return true
    return jsonRecord(jsonRecord(event.data).source).kind === 'user'
  })
  if (index < 0) throw new Error('找不到要修改的 DSH 消息。')
  return { event: jsonRecord(inspection.events[index]), index }
}

function historicalInputId(events: readonly unknown[], index: number): string | undefined {
  const event = jsonRecord(events[index])
  if (event.type !== 'user/message') return undefined
  const id = jsonRecord(event.data).id
  return typeof id === 'string' ? id : undefined
}

function sessionMessageTurn(events: readonly unknown[], index: number): number {
  // DSH normally stamps the turn on assistant events.  The user event is
  // allowed to be queued either before `turn/start` or after it, and some
  // persisted assistant events can omit the redundant stamp.  Resolve both
  // forms from the official surrounding turn markers instead of assuming one
  // event order or relying on a product message index.
  const stampedTurn = jsonRecord(jsonRecord(events[index]).data).turn
  if (Number.isSafeInteger(stampedTurn) && Number(stampedTurn) > 0) return Number(stampedTurn)
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const event = jsonRecord(events[cursor])
    if (event.type === 'turn/end') break
    if (event.type === 'assistant/message') {
      const turn = jsonRecord(event.data).turn
      if (Number.isSafeInteger(turn) && Number(turn) > 0) return Number(turn)
    }
    if (event.type !== 'turn/start') continue
    const turn = jsonRecord(event.data).turn
    if (Number.isSafeInteger(turn) && Number(turn) > 0) return Number(turn)
  }
  for (let cursor = index + 1; cursor < events.length; cursor += 1) {
    const event = jsonRecord(events[cursor])
    if (event.type === 'turn/end') break
    if (event.type === 'assistant/message') {
      const turn = jsonRecord(event.data).turn
      if (Number.isSafeInteger(turn) && Number(turn) > 0) return Number(turn)
    }
    if (event.type !== 'turn/start') continue
    const turn = jsonRecord(event.data).turn
    if (Number.isSafeInteger(turn) && Number(turn) > 0) return Number(turn)
  }
  // The official Session accepts a direct user message before the next
  // turn/start is written. Its rewind contract names that queued input as the
  // next turn, so keep the product command aligned with the Session instead of
  // rejecting a message which is already visible and rewindable.
  const target = jsonRecord(events[index])
  if (target.type === 'user/message' && target.surfaceOp === 'append'
    && jsonRecord(jsonRecord(target.data).source).kind === 'user') {
    let lastStartedTurn = 0
    let lastEndedTurn = 0
    for (let cursor = 0; cursor < index; cursor += 1) {
      const event = jsonRecord(events[cursor])
      const turn = jsonRecord(event.data).turn
      if (!Number.isSafeInteger(turn) || Number(turn) <= 0) continue
      if (event.type === 'turn/start') lastStartedTurn = Math.max(lastStartedTurn, Number(turn))
      if (event.type === 'turn/end') lastEndedTurn = Math.max(lastEndedTurn, Number(turn))
    }
    if (lastStartedTurn === lastEndedTurn) return lastStartedTurn + 1
  }
  throw new Error('找不到这条消息所属的 DSH 轮次。')
}

function directUserMessageBeforeTurn(
  events: readonly unknown[],
  assistantIndex: number,
  turn: number
): Record<string, unknown> | undefined {
  const turnStart = events.findIndex((candidate, index) => index < assistantIndex
    && jsonRecord(candidate).type === 'turn/start'
    && jsonRecord(jsonRecord(candidate).data).turn === turn)
  if (turnStart < 0) return undefined
  for (let index = assistantIndex - 1; index > turnStart; index -= 1) {
    const event = jsonRecord(events[index])
    if (event.type !== 'user/message' || event.surfaceOp !== 'append') continue
    const data = jsonRecord(event.data)
    if (jsonRecord(data.source).kind === 'user') return data
  }
  for (let index = turnStart - 1; index >= 0; index -= 1) {
    const event = jsonRecord(events[index])
    if (event.type === 'turn/end') break
    if (event.type !== 'user/message' || event.surfaceOp !== 'append') continue
    const data = jsonRecord(event.data)
    if (jsonRecord(data.source).kind === 'user') return data
  }
  return undefined
}

function visibleSessionMessages(events: readonly unknown[]): Array<{ seq: number; role: 'user' | 'assistant' }> {
  const messages: Array<{ seq: number; role: 'user' | 'assistant' }> = []
  for (const candidate of events) {
    const event = jsonRecord(candidate)
    if (!Number.isSafeInteger(event.seq) || event.surfaceOp !== 'append') continue
    if (event.type === 'assistant/message') {
      messages.push({ seq: Number(event.seq), role: 'assistant' })
      continue
    }
    if (event.type === 'user/message' && jsonRecord(jsonRecord(event.data).source).kind === 'user') {
      messages.push({ seq: Number(event.seq), role: 'user' })
    }
  }
  return messages
}

function sessionAssistantMessages(
  conversationId: string,
  runtimeSessionId: string,
  events: readonly unknown[],
  variableStateByTurn: Record<string, string>
): Array<{
  id: string
  conversationId: string
  role: 'assistant'
  content: string
  variableStateJson: string
  status: 'complete'
  createdAt: string
  runtimeSessionId: string
  sessionEventSeq: number
  dshTurn: number
}> {
  // The Session contains several assistant/message events for one turn
  // (reasoning/tool steps plus the settled reply).  The official conversation
  // projection exposes only the settled reply after the current final-boundary
  // marker, so the variable viewer must use that same one-per-turn boundary.
  const finalByTurn = new Map<number, {
    event: Record<string, unknown>
    index: number
    content: string
    turn: number
  }>()
  for (const [index, candidate] of events.entries()) {
    const event = jsonRecord(candidate)
    if (event.type !== 'assistant/message' || event.surfaceOp !== 'append'
      || !Number.isSafeInteger(event.seq)) continue
    const content = sessionMessageText(event)
    if (!officialFinalReplyText(content).trim()) continue
    const turn = sessionMessageTurn(events, index)
    finalByTurn.set(turn, { event, index, content, turn })
  }
  return [...finalByTurn.values()].sort((left, right) => Number(left.event.seq) - Number(right.event.seq)).flatMap(({ event, content, turn }) => {
    const state = variableStateByTurn[String(turn)] || '{}'
    const rawTime = event.time ?? jsonRecord(event.data).time
    const time = Number(rawTime)
    const createdAt = Number.isFinite(time) && time > 0
      ? new Date(time).toISOString()
      : new Date().toISOString()
    return [{
      id: `dsh-${String(event.seq)}`,
      conversationId,
      role: 'assistant' as const,
      content,
      variableStateJson: state,
      status: 'complete' as const,
      createdAt,
      runtimeSessionId,
      sessionEventSeq: Number(event.seq),
      dshTurn: turn
    }]
  })
}

const FinalOpenTag = '<FINAL>'
const FinalCloseTag = '</FINAL>'

/** The current DSH assistant projection boundary; internal text before it is not a floor. */
function officialFinalReplyText(value: string): string {
  const markerIndex = value.indexOf(FinalOpenTag)
  if (markerIndex < 0) return ''
  const content = value.slice(markerIndex + FinalOpenTag.length).replace(/^(?:\r\n|\r|\n)/, '')
  const closingIndex = content.indexOf(FinalCloseTag)
  return (closingIndex < 0 ? content : content.slice(0, closingIndex))
    .replace(/(?:\r\n|\r|\n)$/, '')
}

function sessionMessageText(event: Record<string, unknown>): string {
  const message = event.type === 'assistant/message'
    ? jsonRecord(jsonRecord(event.data).message)
    : jsonRecord(event.data)
  const content = Array.isArray(message.content) ? message.content : []
  return content.flatMap((part) => {
    const block = jsonRecord(part)
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('')
}

function regeneratedUserMessage(
  event: Record<string, unknown>,
  requestId: string,
  replacementMessage?: string
) {
  const sourceMessage = jsonRecord(event.data)
  const originalContent = Array.isArray(sourceMessage.content) ? sourceMessage.content : []
  let content = originalContent.map(part => structuredClone(part))
  if (replacementMessage !== undefined) {
    const text = replacementMessage.trim()
    if (!text) throw new Error('重新生成的用户输入不能为空。')
    let replaced = false
    content = content.flatMap(part => {
      const block = jsonRecord(part)
      if (block.type !== 'text') return [part]
      if (replaced) return []
      replaced = true
      return [{ ...block, text }]
    })
    if (!replaced) content.unshift({ type: 'text', text })
  }
  const hasContent = content.some(part => {
    const block = jsonRecord(part)
    return block.type === 'image' || block.type === 'file'
      || (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0)
  })
  if (!hasContent) throw new Error('重新生成的用户输入不能为空。')
  return createUserMessage({
    content: content as ContentBlock[],
    source: { kind: 'user', rpcId: requestId } as never
  })
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function jsonObject(value: unknown): Record<string, DisplayPreferenceValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, DisplayPreferenceValue>
    : {}
}

export class ElecKoiModelsApi extends TypertRemoteService {
  static inject = ['typert', 'settings', 'credentials']
  private readonly ownerContext: Context
  constructor(ctx: Context) {
    super(ctx, 'eleckoiModelsApi', { namespace: 'eleckoiModels' })
    this.ownerContext = ctx
  }
  @Remote
  revealApiKey(configId: string): Promise<string> {
    return readModelApiKey(this.ownerContext, configId)
  }
  @Remote
  testConnection(input: ModelConnectionInput): Promise<{ supported: true }> {
    return testModelConnection(this.ownerContext, input)
  }
  @Remote
  discoverModels(input: ModelDiscoveryInput): Promise<ModelDiscoveryResult[]> {
    return discoverDraftModels(this.ownerContext, input)
  }
}

export class ElecKoiWebSearchApi extends TypertRemoteService {
  static inject = ['typert', 'configEditor', 'settings', 'credentials']

  private readonly ownerContext: Context

  constructor(ctx: Context) {
    super(ctx, 'eleckoiWebSearchApi', { namespace: 'eleckoiWebSearch' })
    this.ownerContext = ctx
  }

  @Remote
  selection(): WebSearchMode {
    const provider = this.webConfiguration().searchProvider
    if (provider === TAVILY_WEB_PROVIDER) return 'tavily'
    if (provider === DEEPSEEK_WEB_PROVIDER) return 'provider_native'
    throw new Error('当前搜索提供器未由 ElecKoi 设置页面管理。')
  }

  @Remote
  async select(mode: WebSearchMode): Promise<WebSearchMode> {
    if (mode !== 'provider_native' && mode !== 'tavily') throw new Error('不支持的联网搜索方式。')
    if (mode === 'tavily' && !this.ownerContext.settings.describe().some(item => item.ns === 'web-search-tavily')) {
      throw new Error('Tavily 搜索插件当前未启用。')
    }
    const row = this.webRow()
    const provider = mode === 'tavily' ? TAVILY_WEB_PROVIDER : DEEPSEEK_WEB_PROVIDER
    await this.ownerContext.configEditor.edit(row, current => ({ ...current, searchProvider: provider }))
    return mode
  }

  @Remote
  async testTavily(apiKey?: string, signal?: AbortSignal): Promise<TavilyConnection> {
    const tavily = this.ownerContext.settings.describe().find(item => item.ns === 'web-search-tavily')
    if (!tavily) throw new Error('Tavily 搜索插件当前未启用。')
    const config = tavily.value as Record<string, unknown> | undefined
    const ref = typeof config?.apiKeyEnv === 'string' ? config.apiKeyEnv : TAVILY_API_KEY_REF
    const candidate = apiKey?.trim() || (await this.ownerContext.credentials.resolve(
      credentialRef(ref)
    ))?.value?.trim() || ''
    return testTavilyConnection(candidate, signal)
  }

  private webRow(): ReturnType<Context['configEditor']['entries']>[number] {
    const row = this.ownerContext.configEditor.entries().find(entry => entry.options.id === WEB_ENTRY_ID)
    if (!row) throw new Error('DSH 联网搜索配置当前不可用。')
    return row
  }

  private webConfiguration(): Record<string, unknown> {
    return this.webRow().options.config ?? {}
  }
}

export class ElecKoiCharactersApi extends TypertRemoteService {
  static inject = [
    'typert',
    'eleckoiProductData',
    'eleckoiProductRecordChanges',
    'eleckoiConversationChanges',
    'eleckoiCharacterConfigurationChanges',
    'eleckoiRoleplaySessions',
    'eleckoiSessionEditor'
  ]

  private readonly ownerContext: Context
  private readonly productData: ElecKoiProductDataStore
  private readonly recordChanges: ProductRecordChangeFeed

  constructor(ctx: Context) {
    super(ctx, 'eleckoiCharactersApi', { namespace: 'eleckoiCharacters' })
    this.ownerContext = ctx
    this.productData = ctx.eleckoiProductData
    this.recordChanges = ctx.eleckoiProductRecordChanges
  }

  @Remote({ mode: 'stream' })
  changes(signal: AbortSignal): AsyncIterable<ProductRecordChange> {
    return productRecordChanges(this.recordChanges, signal, 'characters')
  }

  @Remote
  list(): CharacterCollection {
    return this.productData.readCharacters()
  }

  @Remote
  create(character: CharacterRecord): CharacterCollection {
    const collection = this.productData.createCharacter(character)
    this.publishChange([character.id])
    return collection
  }

  @Remote
  update(character: CharacterRecord): CharacterCollection {
    const collection = this.productData.updateCharacter(character)
    this.publishChange([character.id])
    this.ownerContext.eleckoiConversationChanges.publish({ kind: 'snapshot' })
    return collection
  }

  @Remote
  select(characterId: string): CharacterCollection {
    const collection = this.productData.selectCharacter(characterId)
    this.publishChange([characterId])
    return collection
  }

  @Remote
  saveGroups(groups: string[], assignments: CharacterGroupAssignment[]): CharacterCollection {
    const collection = this.productData.saveCharacterGroups(groups, assignments)
    this.publishChange(assignments.map(item => item.characterId))
    return collection
  }

  @Remote
  async delete(characterIds: string[]): Promise<CharacterCollection> {
    const deleting = new Set(characterIds)
    const conversations = this.productData.readConversationCatalog()
      .filter(item => deleting.has(item.metadata.characterId))
    for (const conversation of conversations) {
      await this.ownerContext.eleckoiSessionEditor.deleteSession(conversation.runtimeSessionId)
      this.ownerContext.eleckoiRoleplaySessions.removeArtifacts(conversation.id, conversation.runtimeSessionId)
    }
    const collection = this.productData.deleteCharacters(characterIds)
    this.publishChange(characterIds)
    this.ownerContext.eleckoiCharacterConfigurationChanges.publish({ kind: 'snapshot' })
    this.ownerContext.eleckoiConversationChanges.publish({ kind: 'snapshot' })
    return collection
  }

  @Remote
  export(characterId: string, format: CharacterExportFormat): CharacterExportResult {
    return this.productData.exportCharacter(characterId, format)
  }

  @Remote
  prepareImport(files: CharacterImportFile[], source: CharacterImportSource): CharacterImportPreview {
    return this.productData.prepareCharacterImports(files, source)
  }

  @Remote
  commitImport(token: string): CharacterImportResult {
    const result = this.productData.commitCharacterImports(token)
    this.publishChange(result.importedCharacterIds)
    this.ownerContext.eleckoiCharacterConfigurationChanges.publish({ kind: 'snapshot' })
    return result
  }

  @Remote
  discardImport(token: string): void {
    this.productData.discardCharacterImports(token)
  }

  private publishChange(ids?: string[]): void {
    this.recordChanges.publish({ kind: 'records', domain: 'characters', ...(ids?.length ? { ids } : {}) })
  }
}

export class ElecKoiSystemApi extends TypertRemoteService {
  static inject = ['typert']

  constructor(ctx: Context) {
    super(ctx, 'eleckoiSystemApi', { namespace: 'eleckoiSystem' })
  }

  @Remote
  status(): ElecKoiHostStatus {
    return { architecture: 'dsh-remote', protocolVersion: 1 }
  }
}

export class ElecKoiPersonaApi extends TypertRemoteService {
  static inject = ['typert', 'eleckoiProductData', 'eleckoiProductRecordChanges', 'eleckoiConversationChanges']

  private readonly ownerContext: Context
  private readonly productData: ElecKoiProductDataStore
  private readonly recordChanges: ProductRecordChangeFeed

  constructor(ctx: Context) {
    super(ctx, 'eleckoiPersonaApi', { namespace: 'eleckoiPersona' })
    this.ownerContext = ctx
    this.productData = ctx.eleckoiProductData
    this.recordChanges = ctx.eleckoiProductRecordChanges
  }

  @Remote({ mode: 'stream' })
  changes(signal: AbortSignal): AsyncIterable<ProductRecordChange> {
    return productRecordChanges(this.recordChanges, signal, 'persona')
  }

  @Remote
  read(): PersonaProfile {
    return this.productData.readPersona()
  }

  @Remote
  save(profile: PersonaProfile): PersonaProfile {
    const saved = this.productData.savePersona(profile)
    this.recordChanges.publish({ kind: 'records', domain: 'persona' })
    this.ownerContext.eleckoiConversationChanges.publish({ kind: 'snapshot' })
    return saved
  }
}

export class ElecKoiCharacterConfigurationApi extends TypertRemoteService {
  static inject = ['typert', 'eleckoiProductData', 'eleckoiCharacterConfigurationChanges']

  private readonly productData: ElecKoiProductDataStore
  private readonly changeFeed: CharacterConfigurationChangeFeed

  constructor(ctx: Context) {
    super(ctx, 'eleckoiCharacterConfigurationApi', { namespace: 'eleckoiCharacterConfiguration' })
    this.productData = ctx.eleckoiProductData
    this.changeFeed = ctx.eleckoiCharacterConfigurationChanges
  }

  @Remote({ mode: 'stream' })
  changes(signal: AbortSignal): AsyncIterable<CharacterConfigurationChange> {
    return this.changeFeed.stream(signal)
  }

  @Remote
  readSettingLibrary(characterId: string): SettingLibrary {
    return this.productData.readSettingLibrary(characterId)
  }

  @Remote
  saveSettingLibrary(characterId: string, library: SettingLibrary): SettingLibrary {
    const saved = this.productData.saveSettingLibrary(characterId, library)
    this.publish('settingLibraries', characterId)
    return saved
  }

  @Remote
  saveSettingLibraryViewState(characterId: string, expandedGroupIds: string[]): string[] {
    const saved = this.productData.saveSettingLibraryViewState(characterId, expandedGroupIds)
    this.publish('settingLibraries', characterId)
    return saved
  }

  @Remote
  readConversationSettingLibraries(characterId: string): SettingLibraryConversation[] {
    return this.productData.readConversationSettingLibraries(characterId)
  }

  @Remote
  saveConversationSettingLibrary(
    characterId: string,
    conversationId: string,
    library: SettingLibrary
  ): SettingLibrary {
    const saved = this.productData.saveConversationSettingLibrary(characterId, conversationId, library)
    this.publish('settingLibraries', characterId)
    return saved
  }

  @Remote
  resetConversationSettingLibrary(characterId: string, conversationId: string): void {
    this.productData.resetConversationSettingLibrary(characterId, conversationId)
    this.publish('settingLibraries', characterId)
  }

  @Remote
  saveConversationSettingLibraryVersion(
    characterId: string,
    conversationId: string,
    name: string
  ): SettingLibrary {
    const saved = this.productData.saveConversationSettingLibraryVersion(characterId, conversationId, name)
    this.publish('settingLibraries', characterId)
    return saved
  }

  @Remote
  readVariableConfig(characterId: string): VariableConfig {
    return this.productData.readVariableConfig(characterId)
  }

  @Remote
  saveVariableConfig(characterId: string, config: VariableConfig): VariableConfig {
    const saved = this.productData.saveVariableConfig(characterId, config)
    this.publish('variables', characterId)
    return saved
  }

  @Remote
  saveVariableConfigViewState(characterId: string, expandedObjectIds: string[]): string[] {
    const saved = this.productData.saveVariableConfigViewState(characterId, expandedObjectIds)
    this.publish('variables', characterId)
    return saved
  }

  @Remote
  readRegexRules(characterId: string): RegexRuleCollection {
    return this.productData.readRegexRules(characterId)
  }

  @Remote
  saveRegexRules(
    characterId: string,
    collection: RegexRuleCollection,
    expectedRevision: number
  ): RegexRuleCollection {
    const saved = this.productData.saveRegexRules(characterId, collection, expectedRevision)
    this.publish('regexRules', characterId)
    return saved
  }

  @Remote
  importRegexRules(
    characterId: string,
    fallbackScope: RegexRuleScope,
    documents: RegexRuleImportDocument[],
    expectedRevision: number
  ): RegexRuleImportResult {
    const imported = this.productData.importRegexRules(characterId, fallbackScope, documents, expectedRevision)
    this.publish('regexRules', characterId)
    return imported
  }

  @Remote
  exportRegexRules(characterId: string, ruleIds: string[]): { fileName: string; json: string } {
    return this.productData.exportRegexRules(characterId, ruleIds)
  }

  @Remote
  testRegexRule(text: string, rule: RegexRule, target: RegexRuleTarget): RegexRuleTestResult {
    return this.productData.testRegexRule(text, rule, target)
  }

  private publish(
    domain: Exclude<CharacterConfigurationChange, { kind: 'snapshot' }>['domain'],
    characterId?: string
  ): void {
    this.changeFeed.publish({ kind: 'configuration', domain, ...(characterId ? { characterId } : {}) })
  }
}

export class ElecKoiAgentPresetsApi extends TypertRemoteService {
  static inject = ['typert', 'eleckoiProductData', 'eleckoiCharacterConfigurationChanges']

  private readonly productData: ElecKoiProductDataStore
  private readonly configurationChanges: CharacterConfigurationChangeFeed

  constructor(ctx: Context) {
    super(ctx, 'eleckoiAgentPresetsApi', { namespace: 'eleckoiAgentPresets' })
    this.productData = ctx.eleckoiProductData
    this.configurationChanges = ctx.eleckoiCharacterConfigurationChanges
  }

  @Remote
  catalog(): AgentPresetCatalog {
    return this.productData.readAgentPresetCatalog()
  }

  @Remote
  read(presetId: string): AgentPreset {
    return this.productData.readAgentPreset(presetId)
  }

  @Remote
  save(preset: AgentPreset, expectedRegexRules: RegexRule[]): AgentPreset {
    const saved = this.productData.saveAgentPreset(preset, expectedRegexRules)
    this.publishChange()
    return saved
  }

  @Remote
  create(name: string, libraryGroupId: string): AgentPreset {
    const created = this.productData.createAgentPreset(name, libraryGroupId)
    this.publishChange()
    return created
  }

  @Remote
  import(source: AgentPresetImportSource, document: AgentPresetImportDocument): AgentPresetImportResult {
    const imported = this.productData.importAgentPreset(source, document)
    this.publishChange()
    return imported
  }

  @Remote
  export(presetId: string, format: AgentPresetExportFormat): AgentPresetExportResult {
    return this.productData.exportAgentPreset(presetId, format)
  }

  @Remote
  setActive(presetId: string): AgentPresetCatalog {
    const catalog = this.productData.setActiveAgentPreset(presetId)
    this.publishChange()
    return catalog
  }

  @Remote
  createGroup(name: string): AgentPresetCatalog {
    const catalog = this.productData.createAgentPresetGroup(name)
    this.publishChange()
    return catalog
  }

  @Remote
  renameGroup(groupId: string, name: string): AgentPresetCatalog {
    const catalog = this.productData.renameAgentPresetGroup(groupId, name)
    this.publishChange()
    return catalog
  }

  @Remote
  assignGroup(presetId: string, groupId: string): AgentPresetCatalog {
    const catalog = this.productData.assignAgentPresetGroup(presetId, groupId)
    this.publishChange()
    return catalog
  }

  @Remote
  deleteGroup(groupId: string): AgentPresetCatalog {
    const catalog = this.productData.deleteAgentPresetGroup(groupId)
    this.publishChange()
    return catalog
  }

  @Remote
  delete(presetId: string): AgentPresetCatalog {
    const catalog = this.productData.deleteAgentPreset(presetId)
    this.publishChange()
    return catalog
  }

  private publishChange(): void {
    this.configurationChanges.publish({ kind: 'configuration', domain: 'agentPresets' })
  }
}

export class ElecKoiCreatorStudioApi extends TypertRemoteService {
  static inject = ['typert', 'eleckoiProductData', 'eleckoiProductRecordChanges']

  private readonly productData: ElecKoiProductDataStore
  private readonly recordChanges: ProductRecordChangeFeed

  constructor(ctx: Context) {
    super(ctx, 'eleckoiCreatorStudioApi', { namespace: 'eleckoiCreatorStudio' })
    this.productData = ctx.eleckoiProductData
    this.recordChanges = ctx.eleckoiProductRecordChanges
  }

  @Remote({ mode: 'stream' })
  changes(signal: AbortSignal): AsyncIterable<ProductRecordChange> {
    return productRecordChanges(this.recordChanges, signal, 'creatorProjects')
  }

  @Remote
  list(): CreatorProjectCollection {
    return this.productData.readCreatorProjects()
  }

  @Remote
  create(input: CreateCreatorProjectInput): CreatorProjectCollection {
    const collection = this.productData.createCreatorProject(input)
    this.recordChanges.publish({ kind: 'records', domain: 'creatorProjects', ids: collection.items.map(item => item.id) })
    return collection
  }

  @Remote
  delete(projectId: string): CreatorProjectCollection {
    const collection = this.productData.deleteCreatorProject(projectId)
    this.recordChanges.publish({ kind: 'records', domain: 'creatorProjects', ids: [projectId] })
    return collection
  }
}

const eleckoiProductApiPlugin = {
  name: 'eleckoi-product-api',
  inject: ['typert', 'eleckoiProductData'],
  provide: ['eleckoiConversationChanges', 'eleckoiCharacterConfigurationChanges', 'eleckoiProductRecordChanges'],
  async apply(ctx: Context) {
    ctx.provide('eleckoiConversationChanges', new ConversationChangeFeed())
    ctx.provide('eleckoiCharacterConfigurationChanges', new CharacterConfigurationChangeFeed())
    ctx.provide('eleckoiProductRecordChanges', new ProductRecordChangeFeed())
    await ctx.plugin(ElecKoiSystemApi)
    await ctx.plugin(ElecKoiCharactersApi)
    await ctx.plugin(ElecKoiPersonaApi)
    await ctx.plugin(ElecKoiCharacterConfigurationApi)
    await ctx.plugin(ElecKoiAgentPresetsApi)
    await ctx.plugin(ElecKoiCreatorStudioApi)
    await ctx.plugin(ElecKoiWebSearchApi)
    await ctx.plugin(ElecKoiModelsApi)
    await ctx.plugin(ElecKoiDisplayPreferencesApi)
    await ctx.plugin(ElecKoiConversationModelsApi)
    await ctx.plugin(ElecKoiConversationsApi)
    return () => {
      ctx.eleckoiConversationChanges.close()
      ctx.eleckoiCharacterConfigurationChanges.close()
      ctx.eleckoiProductRecordChanges.close()
    }
  }
} satisfies Plugin.Object

export default eleckoiProductApiPlugin
