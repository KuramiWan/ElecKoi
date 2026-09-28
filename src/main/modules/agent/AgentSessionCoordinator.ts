import { randomUUID } from 'node:crypto'
import type { DesktopGateway } from '@main/gateway/DesktopGateway'
import type { Logger } from 'pino'
import type { ConversationRepository, MessageRepository } from '@main/modules/conversations'
import type { ModelRepository } from '@main/modules/models'
import type { PersonaRepository } from '@main/modules/personas'
import type { UserSettingsStore } from '@main/modules/settings'
import type { VariableStateRepository } from '@main/modules/variables'
import type { SqliteDatabase } from '@main/platform/sqlite/SqliteDatabase'
import type { AgentState } from '@shared/contracts/agent/events'
import type { AgentInputFile, AgentRunInput, AgentRuntimePort } from '@shared/contracts/agent/runtime'
import type { ChatUserFileAttachment, ChatUserImageAttachment, EncodedChatImageAttachment } from '@shared/contracts/entities/chat'
import { DESKTOP_ERROR_CODES } from '@shared/contracts/gateway/DesktopError'
import { errorMessage } from '@shared/foundation/errorMessage'
import type { GenerationRepository } from './GenerationRepository'
import type { SettingLibraryRepository } from '@main/modules/settingLibraries'
import type { RegexRuleRepository } from '@main/modules/regexRules'
import { rulesForSurface, transformCollectionSurface } from '@shared/foundation/regex/RegexRuleProcessor'
import type { AgentPresetRepository } from '@main/modules/agentPresets'
import type { WebSearchSettingsRepository } from '@main/modules/agentTools'
import { mergeAgentPresetAndCharacterLibraries } from '@main/modules/agentPresets'
import {
  characterCardMacroValues,
  resolveCharacterCardMacros
} from '@shared/foundation/characterCardMacros'
import {
  resolveSettingLibraryCharacterCardMacros,
  resolveVariableContextCharacterCardMacros
} from './CharacterCardMacroResolver'

interface ActiveRun {
  conversationId: string
  runId: string
  requestId: string
  messageId: string
  cancelled: boolean
  terminalCommitted: boolean
  accumulated: string
  sequence: number
  runtimeThreadId: string
  done: Promise<void>
  checkpointAt: number
  checkpointLength: number
  discardRuntimeThreadIds: string[]
  generationStatsSeed?: AgentRunInput['generationStatsSeed']
  agentPreset?: AgentRunInput['agentPreset']
  subagentSettings?: AgentRunInput['subagentSettings']
}

interface PreparingRun {
  runId: string
  requestId: string
  cancelled: boolean
  done: Promise<void>
}

interface ExpectedRunIdentity {
  requestId: string
  runId?: string | undefined
}

export interface AgentSessionDependencies {
  logger?: Pick<Logger, 'error'> | undefined
  runtime: AgentRuntimePort
  database: SqliteDatabase
  gateway: DesktopGateway
  conversations: ConversationRepository
  messages: MessageRepository
  personas: Pick<PersonaRepository, 'get'>
  models: ModelRepository
  userSettings: UserSettingsStore
  generations: GenerationRepository
  variableStates?: VariableStateRepository | undefined
  settingLibraries?: SettingLibraryRepository | undefined
  agentPresets?: AgentPresetRepository | undefined
  webSearchSettings?: WebSearchSettingsRepository | undefined
  regexRules?: RegexRuleRepository | undefined
  discardPreparedImages?: ((attachmentIds: readonly string[]) => void) | undefined
  resolveInputFiles?: ((ids: readonly string[]) => AgentInputFile[]) | undefined
  discardInputFiles?: ((ids: readonly string[]) => void) | undefined
  discardFileReferences?: ((refs: readonly ChatUserFileAttachment[]) => void) | undefined
  queueFileReferences?: ((refs: readonly ChatUserFileAttachment[]) => void) | undefined
  drainFileReferences?: (() => void) | undefined
  enqueueAttachmentsBeforeDelete?: ((conversationId: string) => void) | undefined
}

export class AgentSessionCoordinator {
  private readonly editingConversations = new Set<string>()
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly settlingRuns = new Map<string, Promise<void>>()
  private readonly preparingRuns = new Map<string, PreparingRun>()
  private readonly deletingConversations = new Set<string>()
  private readonly deletionRuntimeThreadIds = new Map<string, string[]>()

  constructor(private readonly dependencies: AgentSessionDependencies) {}

  start(
    conversationId: string,
    text: string,
    images: EncodedChatImageAttachment[] = [],
    requestId: string = randomUUID(),
    fileIds: string[] = []
  ) {
    const trimmed = text.trim()
    if (trimmed.length === 0 && images.length === 0 && fileIds.length === 0) throw new Error('消息、图片和文件不能同时为空。')
    this.assertCanStart(conversationId)
    const inputFiles = this.dependencies.resolveInputFiles?.(fileIds) ?? []
    const runId = randomUUID()

    const settings = this.dependencies.models.resolve(this.dependencies.userSettings.read('models.active'), '')
    if (images.length > 0 && !settings.supportsImageInput) throw new Error('当前模型未声明图片输入能力。')
    const metadata = this.dependencies.conversations.getMetadata(conversationId)
    const storedText = metadata.characterId && this.dependencies.regexRules
      ? this.dependencies.regexRules.transform(metadata.characterId, trimmed, 'UserInput', 'Stored')
      : trimmed
    if (images.length === 0) {
      return this.startPrepared(conversationId, storedText, settings, [], inputFiles, runId, requestId)
    }
    if (!this.dependencies.runtime.prepareImages) throw new Error('图片运行时尚未就绪。')
    const preparing: PreparingRun = { runId, requestId, cancelled: false, done: Promise.resolve() }
    this.preparingRuns.set(conversationId, preparing)
    const operation = this.dependencies.runtime.prepareImages(images)
      .then((prepared) => {
        if (preparing.cancelled || this.preparingRuns.get(conversationId) !== preparing) {
          this.discardPreparedImages(prepared)
          throw generationCancelledError()
        }
        this.preparingRuns.delete(conversationId)
        try {
          return this.startPrepared(conversationId, storedText, settings, prepared, inputFiles, runId, requestId)
        } catch (error) {
          this.discardPreparedImages(prepared)
          throw error
        }
      })
      .catch((error) => {
        if (preparing.cancelled) {
          this.emitState(conversationId, 'idle')
          throw generationCancelledError()
        }
        throw error
      })
      .finally(() => {
        if (this.preparingRuns.get(conversationId) === preparing) this.preparingRuns.delete(conversationId)
      })
    preparing.done = operation.then(() => undefined, () => undefined)
    return operation
  }

  private startPrepared(
    conversationId: string,
    storedText: string,
    settings: ReturnType<ModelRepository['resolve']>,
    inputImages: ChatUserImageAttachment[],
    inputFiles: AgentInputFile[],
    runId: string,
    requestId: string
  ) {
    this.assertCanStart(conversationId)
    this.dependencies.messages.assertReadableHistory(conversationId)
    const agentPreset = this.dependencies.agentPresets?.runtimeSelection()
    const subagentSelection = this.dependencies.agentPresets?.subagentModelSelection()
    const subagentSettings = subagentSelection
      ? this.dependencies.models.resolveExact(subagentSelection.configId, subagentSelection.model, '')
      : undefined
    const runtimeThreadId = this.dependencies.messages.conversationRuntimeThreadId(conversationId)
    const createdMessages = this.dependencies.database.withWriteTx((database) => {
      const settingState = this.dependencies.settingLibraries?.snapshotConversationRuntimeState(conversationId, database)
      const user = this.dependencies.messages.create(conversationId, 'user', storedText, 'complete', database, '', inputImages,
        inputFiles.map((file) => ({ attachmentId: file.id, name: file.name, bytes: file.bytes })))
      if (settingState !== undefined) {
        this.dependencies.messages.writeSettingLibraryStateSnapshot(conversationId, user.id, settingState)
      }
      const assistant = this.dependencies.messages.create(conversationId, 'assistant', '', 'streaming', database, runtimeThreadId)
      this.dependencies.generations.start(runId, conversationId, assistant.id)
      const preview = storedText || (inputImages.length ? '图片' : '文件')
      this.dependencies.conversations.titleFromFirstMessage(conversationId, preview, database)
      this.dependencies.conversations.touch(conversationId, preview, database)
      return { user, assistant }
    })

    const active: ActiveRun = {
      conversationId,
      runId,
      requestId,
      messageId: createdMessages.assistant.id,
      cancelled: false,
      terminalCommitted: false,
      accumulated: '',
      sequence: 0,
      done: Promise.resolve(),
      checkpointAt: 0,
      checkpointLength: 0,
      runtimeThreadId,
      discardRuntimeThreadIds: [],
      agentPreset,
      subagentSettings
    }
    this.activeRuns.set(conversationId, active)
    this.emitMessagesChanged(conversationId, 'sent', [createdMessages.user.id, createdMessages.assistant.id])
    active.done = this.execute(active, storedText, settings, inputImages, inputFiles)
    void active.done
    return { accepted: true as const, conversationId, runId, messageId: createdMessages.assistant.id }
  }

  async regenerate(
    conversationId: string,
    targetMessageId: string,
    replacementMessage?: string,
    requestId: string = randomUUID()
  ) {
    this.assertCanStart(conversationId)
    const settings = this.dependencies.models.resolve(this.dependencies.userSettings.read('models.active'), '')
    const metadata = this.dependencies.conversations.getMetadata(conversationId)
    const storedReplacement = replacementMessage && metadata.characterId && this.dependencies.regexRules
      ? this.dependencies.regexRules.transform(metadata.characterId, replacementMessage, 'UserInput', 'Stored')
      : replacementMessage
    if (storedReplacement !== undefined && !storedReplacement.trim()) throw new Error('用户输入不能为空。')
    const runtimeThreadId = this.dependencies.messages.conversationRuntimeThreadId(conversationId)
    this.dependencies.messages.reconcileUnboundActiveResponses(runtimeThreadId)
    const targetMessage = this.dependencies.messages.get(conversationId, targetMessageId)
    if (replacementMessage !== undefined && targetMessage.role !== 'user') {
      throw new Error('只能替换用户输入；编辑 AI 回复请使用消息编辑。')
    }
    const sourceInput = targetMessage.role === 'user'
      ? targetMessage
      : this.dependencies.messages.get(conversationId, targetMessage.turnId ?? '')
    const visibleMessages = this.dependencies.messages.list(conversationId)
    if (!settings.supportsImageInput && (sourceInput.inputImageAttachments?.length ?? 0) > 0) {
      throw new Error('当前模型未声明图片输入能力。')
    }
    const agentPreset = this.dependencies.agentPresets?.runtimeSelection()
    const subagentSelection = this.dependencies.agentPresets?.subagentModelSelection()
    const subagentSettings = subagentSelection
      ? this.dependencies.models.resolveExact(subagentSelection.configId, subagentSelection.model, '')
      : undefined
    const persistedBoundary = this.dependencies.messages.regenerationDshBoundary(conversationId, targetMessageId)
    const sourceIndex = visibleMessages.findIndex((message) => message.id === sourceInput.id)
    const discardedFiles = visibleMessages.slice(sourceIndex + 1)
      .flatMap((message) => message.inputFileAttachments ?? [])
    const removedResponses = visibleMessages.slice(sourceIndex)
      .filter((message) => message.role === 'assistant')
    if (sourceIndex < 0) throw new Error('找不到需要重新生成的用户输入。')
    const responseBindings = removedResponses.map((message) =>
      this.dependencies.messages.deletionDshBoundary(conversationId, message.id))
    const hasUnboundResponse = responseBindings.some((binding) => !binding)
    const unstartedTurn = hasUnboundResponse
      ? this.dependencies.messages.unstartedDeletionTurn(runtimeThreadId, removedResponses.map((message) => message.id))
      : undefined
    const boundary = persistedBoundary ?? (typeof unstartedTurn === 'number'
      ? { runtimeThreadId, turn: unstartedTurn } : undefined)
    if (removedResponses.length > 0 && ((hasUnboundResponse && unstartedTurn === undefined)
      || (!boundary && unstartedTurn !== null)
      || (boundary !== undefined && (boundary.runtimeThreadId !== runtimeThreadId
        || !this.dependencies.runtime.rewindConversation
        || !this.dependencies.messages.canRewindRuntimeThread(
          runtimeThreadId, boundary.turn, removedResponses.map((message) => message.id)
        )))
      || responseBindings.some((binding) => binding !== undefined
        && (binding.runtimeThreadId !== runtimeThreadId || (boundary !== undefined && binding.turn < boundary.turn))))) {
      throw new Error('无法安全回退当前 DSH 会话；原聊天记录未修改。')
    }
    this.deletingConversations.add(conversationId)
    let rewound = false
    let prepared: ReturnType<MessageRepository['prepareRegeneration']>
    let assistantMessage: ReturnType<MessageRepository['create']>
    let createdResponseId: string | undefined
    const drafts = this.dependencies.messages.captureDrafts(visibleMessages.slice(sourceIndex).map((message) => message.id))
    const runId = randomUUID()
    try {
      if (boundary) {
        if (await this.dependencies.runtime.rewindConversation!(conversationId, runtimeThreadId, boundary.turn) !== 'rewound') {
          throw new Error('无法安全回退当前 DSH 会话；原聊天记录未修改。')
        }
        rewound = true
      }
      const committed = this.dependencies.database.withWriteTx(() => {
        const next = this.dependencies.messages.prepareRegeneration(
          conversationId, targetMessageId, storedReplacement, sourceInput
        )
        const response = this.dependencies.messages.create(conversationId, 'assistant', '', 'streaming', undefined, runtimeThreadId)
        createdResponseId = response.id
        this.dependencies.generations.start(runId, conversationId, response.id)
        return { next, response }
      })
      prepared = committed.next
      assistantMessage = committed.response
    } catch (error) {
      this.dependencies.messages.restoreDrafts(drafts, createdResponseId)
      if (rewound) await this.dependencies.runtime.rollbackRewind?.(conversationId, runtimeThreadId)
      throw error
    } finally {
      this.deletingConversations.delete(conversationId)
    }
    if (rewound) this.dependencies.runtime.confirmRewind?.(conversationId)
    this.dependencies.discardFileReferences?.(discardedFiles)
    const active: ActiveRun = {
      conversationId, runId, requestId, messageId: assistantMessage.id, cancelled: false, terminalCommitted: false, accumulated: '', sequence: 0,
      done: Promise.resolve(), checkpointAt: 0, checkpointLength: 0, runtimeThreadId,
      discardRuntimeThreadIds: prepared.obsoleteRuntimeThreadIds,
      agentPreset,
      subagentSettings
    }
    this.activeRuns.set(conversationId, active)
    this.emitMessagesChanged(
      conversationId,
      replacementMessage === undefined ? 'regenerated' : 'edited',
      [prepared.turnId, assistantMessage.id]
    )
    active.done = this.execute(active, prepared.text, settings, prepared.inputImages,
      prepared.inputFiles.map((reference) => ({ id: reference.attachmentId, path: '', name: reference.name, bytes: reference.bytes, reference })))
    void active.done
    return { accepted: true as const, conversationId, runId, messageId: assistantMessage.id }
  }

  async editMessage(conversationId: string, messageId: string, content: string) {
    this.assertCanStart(conversationId)
    const next = content.trim()
    if (!next) throw new Error('消息内容不能为空。')
    const message = this.dependencies.messages.get(conversationId, messageId)
    if (message.id === 'opening') throw new Error('开场白请使用开场白编辑。')
    if (message.status !== 'complete' || !message.runtimeSessionId || !message.dshMessageId
      || !this.dependencies.runtime.editMessage) {
      throw new Error('这条消息尚未写入 DSH 会话，不能安全编辑。')
    }
    if (message.content === next) return { ok: true as const }
    this.editingConversations.add(conversationId)
    try {
      await this.dependencies.runtime.editMessage(
        conversationId, message.runtimeSessionId, message.dshMessageId, message.role, next
      )
      this.emitMessagesChanged(conversationId, 'edited', [messageId])
      return { ok: true as const }
    } finally {
      this.editingConversations.delete(conversationId)
    }
  }

  async cancel(
    conversationId: string,
    expected?: ExpectedRunIdentity
  ): Promise<{ cancelled: boolean }> {
    const preparing = this.preparingRuns.get(conversationId)
    if (preparing !== undefined) {
      if (!matchesExpectedRun(preparing, expected)) return { cancelled: false }
      preparing.cancelled = true
      this.emitState(conversationId, 'stopping')
      return { cancelled: true }
    }
    const active = this.activeRuns.get(conversationId)
    if (active === undefined) return { cancelled: false }
    if (!matchesExpectedRun(active, expected)) return { cancelled: false }
    active.cancelled = true
    this.emitState(conversationId, 'stopping')
    const runtimeCancellation = this.dependencies.runtime.cancel(conversationId)
    this.settlingRuns.set(conversationId, active.done)
    void active.done.finally(() => {
      if (this.settlingRuns.get(conversationId) === active.done) this.settlingRuns.delete(conversationId)
    }).catch(() => undefined)
    this.finishCancelled(active)
    void runtimeCancellation.catch((error) => {
      this.dependencies.logger?.error({ err: error, conversationId }, 'Agent 后台取消失败')
    })
    return { cancelled: true }
  }

  async prepareForDelete(conversationId: string): Promise<void> {
    this.deletingConversations.add(conversationId)
    const preparing = this.preparingRuns.get(conversationId)
    if (preparing !== undefined) {
      await this.cancel(conversationId)
      await preparing.done
    }
    if (this.activeRuns.has(conversationId)) await this.cancel(conversationId)
    await this.settlingRuns.get(conversationId)
    this.deletionRuntimeThreadIds.set(conversationId, this.dependencies.messages.runtimeThreadIdsForDeletion(conversationId))
    this.dependencies.enqueueAttachmentsBeforeDelete?.(conversationId)
  }

  async commitDelete(conversationId: string): Promise<void> {
    await this.dependencies.runtime.disposeConversation(conversationId, this.deletionRuntimeThreadIds.get(conversationId) ?? [])
  }

  async deleteMessagesFrom(conversationId: string, targetMessageId: string) {
    this.deletingConversations.add(conversationId)
    try {
      const preparing = this.preparingRuns.get(conversationId)
      if (preparing !== undefined) {
        await this.cancel(conversationId)
        await preparing.done
      }
      const active = this.activeRuns.get(conversationId)
      if (active) {
        await this.cancel(conversationId)
        await active.done
      }
      await this.settlingRuns.get(conversationId)
      if (targetMessageId === 'opening') {
        const visibleMessages = this.dependencies.messages.list(conversationId)
        if (!visibleMessages.some((message) => message.id === 'opening')) {
          this.dependencies.messages.get(conversationId, targetMessageId)
        }
        const firstConversationMessage = visibleMessages
          .find((message) => message.id !== 'opening')
        if (!firstConversationMessage) {
          return { ok: true as const, deletedMessageCount: 0, remainingMessageCount: visibleMessages.length }
        }
        targetMessageId = firstConversationMessage.id
      }
      this.dependencies.messages.get(conversationId, targetMessageId)
      const runtimeThreadId = this.dependencies.messages.conversationRuntimeThreadId(conversationId)
      this.dependencies.messages.reconcileUnboundActiveResponses(runtimeThreadId)
      const visibleMessages = this.dependencies.messages.list(conversationId)
      const targetIndex = visibleMessages.findIndex((message) => message.id === targetMessageId)
      const deletedAttachmentIds = targetIndex < 0 ? [] : visibleMessages.slice(targetIndex)
        .flatMap((message) => message.inputImageAttachments?.map((image) => image.attachmentId) ?? [])
      const deletedFiles = targetIndex < 0 ? [] : visibleMessages.slice(targetIndex)
        .flatMap((message) => message.inputFileAttachments ?? [])
      const removedResponses = visibleMessages.slice(targetIndex)
        .filter((message) => message.role === 'assistant')
      const responseBindings = removedResponses.map((message) =>
        this.dependencies.messages.deletionDshBoundary(conversationId, message.id))
      const hasUnboundResponse = responseBindings.some((binding) => !binding)
      const unstartedTurn = hasUnboundResponse
        ? this.dependencies.messages.unstartedDeletionTurn(runtimeThreadId, removedResponses.map((message) => message.id))
        : undefined
      const persistedBoundary = this.dependencies.messages.deletionDshBoundary(conversationId, targetMessageId)
        ?? (removedResponses[0]
          ? this.dependencies.messages.deletionDshBoundary(conversationId, removedResponses[0].id)
          : undefined)
      const boundary = hasUnboundResponse && typeof unstartedTurn === 'number'
        ? { runtimeThreadId, turn: unstartedTurn }
        : persistedBoundary
      if (targetIndex < 0) throw new Error('找不到要删除的聊天消息。')
      if (removedResponses.length > 0 && ((hasUnboundResponse && unstartedTurn === undefined)
        || (!boundary && unstartedTurn !== null)
        || (boundary !== undefined && (boundary.runtimeThreadId !== runtimeThreadId
          || !this.dependencies.runtime.rewindConversation
          || !this.dependencies.messages.canRewindRuntimeThread(
            runtimeThreadId, boundary.turn, removedResponses.map((message) => message.id)
          )))
        || responseBindings.some((binding) => binding !== undefined
          && (binding.runtimeThreadId !== runtimeThreadId || (boundary !== undefined && binding.turn < boundary.turn))))) {
        throw new Error('无法安全回退当前 DSH 会话；原聊天记录未修改。')
      }
      let rewound = false
      let deleted: ReturnType<MessageRepository['deleteFrom']>
      const drafts = this.dependencies.messages.captureDrafts(visibleMessages.slice(targetIndex).map((message) => message.id))
      try {
        if (boundary) {
          if (await this.dependencies.runtime.rewindConversation!(conversationId, runtimeThreadId, boundary.turn) !== 'rewound') {
            throw new Error('无法安全回退当前 DSH 会话；原聊天记录未修改。')
          }
          rewound = true
        }
        deleted = this.dependencies.database.withWriteTx((database) => {
          const result = this.dependencies.messages.deleteFrom(conversationId, targetMessageId, deletedAttachmentIds)
          this.dependencies.generations.deleteForMessages(conversationId, result.deletedResponseIds)
          if (result.rollbackSettingLibraryStateJson !== undefined) {
            this.dependencies.settingLibraries?.restoreConversationRuntimeState(
              conversationId,
              result.rollbackSettingLibraryStateJson,
              database
            )
          }
          return result
        })
      } catch (error) {
        this.dependencies.messages.restoreDrafts(drafts)
        if (rewound) await this.dependencies.runtime.rollbackRewind?.(conversationId, runtimeThreadId)
        throw error
      }
      if (rewound) this.dependencies.runtime.confirmRewind?.(conversationId)
      await this.dependencies.runtime.disposeConversation(
        conversationId, deleted.obsoleteRuntimeThreadIds, deleted.retainedRuntimeThreadIds
      )
      this.dependencies.discardPreparedImages?.(deleted.deletedAttachmentIds)
      this.dependencies.discardFileReferences?.(deletedFiles)
      this.dependencies.gateway.broadcast('records.changed', { module: 'conversations' })
      this.emitMessagesChanged(conversationId, 'deleted', deleted.deletedMessageIds)
      this.emitState(conversationId, 'idle')
      return {
        ok: true as const,
        deletedMessageCount: deleted.deletedMessageCount,
        remainingMessageCount: deleted.remainingMessageCount
      }
    } finally {
      this.deletingConversations.delete(conversationId)
    }
  }

  finishDelete(conversationId: string): void {
    this.deletingConversations.delete(conversationId)
    this.deletionRuntimeThreadIds.delete(conversationId)
  }

  inspect(conversationId: string) {
    const active = this.activeRuns.get(conversationId)
    if (active === undefined) return { active: false as const, conversationId }
    return {
      active: true as const,
      conversationId,
      runId: active.runId,
      requestId: active.requestId,
      messageId: active.messageId,
      accumulated: active.accumulated,
      sequence: active.sequence
    }
  }

  readImage(conversationId: string, attachmentId: string) {
    if (!this.dependencies.runtime.readImage) throw new Error('图片运行时尚未就绪。')
    return this.dependencies.runtime.readImage(this.dependencies.messages.findInputImage(conversationId, attachmentId))
  }

  hasActiveRun(): boolean {
    return this.activeRuns.size > 0 || this.preparingRuns.size > 0
  }

  generationStats(conversationId: string) {
    const runtimeThreadId = this.dependencies.messages.conversationRuntimeThreadId(conversationId)
    return {
      conversationId,
      stats: runtimeThreadId && this.dependencies.runtime.generationStats
        ? this.dependencies.runtime.generationStats(conversationId, runtimeThreadId) ?? null
        : null
    }
  }

  trajectory(conversationId: string, options?: { beforeIndex?: number | undefined; limit?: number | undefined }) {
    this.dependencies.conversations.get(conversationId)
    const runtimeThreadId = this.activeRuns.get(conversationId)?.runtimeThreadId
      ?? this.dependencies.messages.conversationRuntimeThreadId(conversationId)
    if (!runtimeThreadId || !this.dependencies.runtime.trajectory) {
      return {
        conversationId,
        runtimeThreadId: null,
        records: [],
        totalRecords: 0,
        hasMore: false,
        beforeIndex: null,
        startedAtMillis: null,
        completedAtMillis: null
      }
    }
    return this.dependencies.runtime.trajectory(conversationId, runtimeThreadId, options)
  }

  async close(): Promise<void> {
    for (const preparing of this.preparingRuns.values()) preparing.cancelled = true
    for (const active of this.activeRuns.values()) active.cancelled = true
    const conversationIds = [...this.activeRuns.keys()]
    await Promise.all(conversationIds.map((id) => this.dependencies.runtime.cancel(id)))
    await Promise.all([...this.activeRuns.values()].map((active) => active.done))
    this.deletingConversations.clear()
  }

  private assertCanStart(conversationId: string): void {
    if (this.deletingConversations.has(conversationId)) throw new Error('这个对话正在删除。')
    if (this.editingConversations.has(conversationId)) throw new Error('这个对话正在编辑消息。')
    if (this.activeRuns.has(conversationId) || this.preparingRuns.has(conversationId)) {
      throw new Error('这个对话仍有回复正在生成。')
    }
  }

  private discardPreparedImages(images: readonly ChatUserImageAttachment[]): void {
    this.dependencies.discardPreparedImages?.(images.map((image) => image.attachmentId))
  }

  async createSession(conversationId: string): Promise<void> {
    if (!this.dependencies.runtime.createSession) throw new Error('DSH 会话创建服务未装载。')
    const settings = this.dependencies.models.resolve(this.dependencies.userSettings.read('models.active'), '')
    const subagentSelection = this.dependencies.agentPresets?.subagentModelSelection()
    const subagentSettings = subagentSelection
      ? this.dependencies.models.resolveExact(subagentSelection.configId, subagentSelection.model, '')
      : undefined
    const runtimeThreadId = this.dependencies.messages.conversationRuntimeThreadId(conversationId)
    const { variableContext, conversationContext, disabledGroupIds } = this.runtimeContext(conversationId, '')
    await this.dependencies.runtime.createSession({
      conversationId, runtimeThreadId, settings, subagentSettings, variableContext, conversationContext,
      toolPolicy: { disabledGroupIds },
      webSearch: this.dependencies.webSearchSettings?.runtimeSettings(),
      agentPreset: this.dependencies.agentPresets?.runtimeSelection()
    })
  }

  private runtimeContext(conversationId: string, text: string) {
    const metadata = this.dependencies.conversations.getMetadata(conversationId)
    const characterBinding = this.dependencies.conversations.getCharacterBinding(conversationId)
    const macroValues = characterCardMacroValues(metadata, this.dependencies.personas.get().user_name)
    const variableContext = resolveVariableContextCharacterCardMacros(
      this.dependencies.variableStates?.runtimeContext(conversationId, characterBinding),
      macroValues
    )
    const regexRules = metadata.characterId && this.dependencies.regexRules
      ? this.dependencies.regexRules.get(metadata.characterId)
      : undefined
    const disabledGroupIds = this.dependencies.agentPresets?.disabledToolGroupIds() ?? []
    const rawSettingLibrary = mergeAgentPresetAndCharacterLibraries(
      this.dependencies.agentPresets?.runtimeContext(),
      this.dependencies.settingLibraries?.runtimeContext(conversationId, characterBinding)
    )
    const settingLibrarySource = resolveSettingLibraryCharacterCardMacros(rawSettingLibrary, macroValues)
    const settingLibrary = settingLibrarySource && regexRules
      ? {
        ...settingLibrarySource,
        entries: settingLibrarySource.entries.map((entry) => ({
          ...entry,
          content: transformCollectionSurface(entry.content, regexRules, 'SettingContent', 'Prompt')
        }))
      }
      : settingLibrarySource
    const history = this.dependencies.messages.runtimeHistory(conversationId).map((item) => {
      const macroContent = macroValues ? resolveCharacterCardMacros(item.content, macroValues) : item.content
      return {
        ...item,
        content: regexRules
          ? transformCollectionSurface(macroContent, regexRules,
            item.role === 'user' ? 'UserInput' : 'AiOutput', 'Prompt')
          : macroContent
      }
    })
    const macroPromptText = macroValues ? resolveCharacterCardMacros(text, macroValues) : text
    const promptText = regexRules
      ? transformCollectionSurface(macroPromptText, regexRules, 'UserInput', 'Prompt')
      : macroPromptText
    const conversationContext = {
      characterId: metadata.characterId,
      characterName: metadata.characterName,
      persona: {}, history, currentPromptText: promptText,
      ...(settingLibrary ? { settingLibrary } : {})
    }
    return { variableContext, conversationContext, disabledGroupIds, regexRules, rawSettingLibrary, settingLibrary }
  }

  private async execute(
    active: ActiveRun,
    text: string,
    settings: ReturnType<ModelRepository['resolve']>,
    inputImages: ChatUserImageAttachment[] = [],
    inputFiles: AgentInputFile[] = []
  ): Promise<void> {
    this.emitState(active.conversationId, 'starting', '正在启动 DSH')
    const { variableContext, conversationContext, disabledGroupIds, regexRules, rawSettingLibrary, settingLibrary } =
      this.runtimeContext(active.conversationId, text)
    let finalContent = ''
    let finalVariableState = ''
    let finalSettingLibraryState = ''
    const uploadedFiles: ChatUserFileAttachment[] = []
    try {
      const result = await this.dependencies.runtime.run({
        conversationId: active.conversationId,
        runId: active.runId,
        text,
        inputImages,
        inputFiles,
        settings,
        subagentSettings: active.subagentSettings,
        variableContext,
        conversationContext,
        runtimeThreadId: active.runtimeThreadId,
        discardRuntimeThreadIds: active.discardRuntimeThreadIds,
        generationStatsSeed: active.generationStatsSeed,
        toolPolicy: { disabledGroupIds },
        webSearch: this.dependencies.webSearchSettings?.runtimeSettings(),
        agentPreset: active.agentPreset
      }, {
        onFileUploaded: (draftId, file) => {
          uploadedFiles.push(file)
          if (this.isCurrent(active)) this.dependencies.messages.recordUploadedFile(active.messageId, draftId, file)
          this.dependencies.queueFileReferences?.([file])
        },
        onTurnStarted: (turn) => {
          if (!this.isCurrent(active)) return
          this.dependencies.messages.bindDshTurn(
            active.conversationId, active.messageId, active.runtimeThreadId, turn
          )
        },
        onDelta: (delta) => {
          if (!this.isCurrent(active)) return
          active.accumulated += delta
          active.sequence += 1
          if (Date.now() - active.checkpointAt >= 250 || active.accumulated.length - active.checkpointLength >= 64 * 1024) {
            const checkpointEnd = trailingCompleteCharacterIndex(active.accumulated)
            const checkpointDelta = active.accumulated.slice(active.checkpointLength, checkpointEnd)
            if (checkpointDelta.length > 0) {
              this.dependencies.messages.appendCheckpoint(active.messageId, checkpointDelta)
              active.checkpointAt = Date.now()
              active.checkpointLength = checkpointEnd
            }
          }
          if (active.sequence === 1) this.emitState(active.conversationId, 'streaming', settings.model)
          this.dependencies.gateway.broadcast('agent.output.delta', {
            conversationId: active.conversationId,
            runId: active.runId,
            messageId: active.messageId,
            sequence: active.sequence,
            delta
          })
        },
        onFinal: (content) => {
          if (this.isCurrent(active)) finalContent = content
        },
        onGenerationStats: (stats) => {
          if (!this.isCurrent(active)) return
          this.dependencies.gateway.broadcast('agent.generation.stats', {
            conversationId: active.conversationId,
            runId: active.runId,
            stats
          })
        },
        onVariableState: (stateJson) => {
          if (this.isCurrent(active)) finalVariableState = stateJson
        },
        onSettingLibraryState: (stateJson) => {
          if (this.isCurrent(active)) finalSettingLibraryState = stateJson
        },
        onProcessItem: (item) => {
          if (!this.isCurrent(active)) return
          this.dependencies.messages.upsertProcessItem(active.messageId, item)
          this.dependencies.gateway.broadcast('agent.process.updated', {
            conversationId: active.conversationId,
            runId: active.runId,
            messageId: active.messageId,
            item
          })
        }
      })

      if (active.terminalCommitted) return
      const status = active.cancelled || result === 'cancelled' ? 'cancelled' : 'complete'
      const rawContent = finalContent || active.accumulated
      if (status === 'complete' && rawContent.trim().length === 0) {
        throw new Error('DSH completed the turn without assistant text')
      }
      const content = regexRules
        ? transformCollectionSurface(rawContent, regexRules, 'AiOutput', 'Stored')
        : rawContent
      active.terminalCommitted = true
      const message = this.dependencies.database.withWriteTx((database) => {
        const committedVariableState = status === 'complete' && finalVariableState && this.dependencies.variableStates
          ? this.dependencies.variableStates.replaceCurrent(active.conversationId, finalVariableState, database)
          : undefined
        if (
          status === 'complete'
          && finalSettingLibraryState
          && this.dependencies.settingLibraries
          && rawSettingLibrary
          && settingLibrary
        ) {
          this.dependencies.settingLibraries.replaceConversationRuntimeState(
            active.conversationId,
            finalSettingLibraryState,
            this.dependencies.conversations.getCharacterBinding(active.conversationId, database),
            { source: rawSettingLibrary, projected: settingLibrary },
            database
          )
        }
        const finished = this.dependencies.messages.finish(
          active.messageId, content, status, database, committedVariableState,
          regexRules ? rulesForSurface(regexRules, 'AiOutput', 'Stored') : []
        )
        if (this.dependencies.settingLibraries) {
          this.dependencies.messages.writeSettingLibraryStateSnapshot(
            active.conversationId,
            active.messageId,
            this.dependencies.settingLibraries.snapshotConversationRuntimeState(active.conversationId, database)
          )
        }
        this.dependencies.generations.finish(active.runId, status)
        this.dependencies.conversations.touch(active.conversationId, content, database)
        return finished
      })
      this.dependencies.gateway.broadcast('agent.run.finished', {
        conversationId: active.conversationId,
        runId: active.runId,
        message
      })
      this.emitState(active.conversationId, 'idle')
    } catch (error) {
      if (active.terminalCommitted) return
      if (active.cancelled) {
        this.finishCancelled(active)
        return
      }
      const diagnosticMessage = errorMessage(error)
      this.dependencies.logger?.error({
        err: error,
        conversationId: active.conversationId,
        runId: active.runId,
        messageId: active.messageId,
        runtimeThreadId: active.runtimeThreadId
      }, 'Agent 运行失败')
      const messageText = diagnosticMessage || 'Unknown agent runtime error'
      active.terminalCommitted = true
      const message = this.dependencies.database.withWriteTx((database) => {
        const errorContent = regexRules
          ? transformCollectionSurface(active.accumulated, regexRules, 'AiOutput', 'Stored')
          : active.accumulated
        const finished = this.dependencies.messages.finish(
          active.messageId,
          errorContent,
          'error',
          database,
          undefined,
          regexRules ? rulesForSurface(regexRules, 'AiOutput', 'Stored') : []
        )
        this.dependencies.conversations.touch(active.conversationId, errorContent, database)
        this.dependencies.generations.finish(active.runId, 'error')
        return finished
      })
      this.dependencies.gateway.broadcast('agent.run.failed', {
        conversationId: active.conversationId,
        runId: active.runId,
        messageId: message.id,
        code: DESKTOP_ERROR_CODES.RUNTIME_UNAVAILABLE,
        message: messageText
      })
      this.emitState(active.conversationId, 'error', messageText)
    } finally {
      if (uploadedFiles.length) this.dependencies.drainFileReferences?.()
      this.dependencies.discardInputFiles?.(inputFiles.filter((file) => !file.reference).map((file) => file.id))
      if (this.activeRuns.get(active.conversationId) === active) {
        this.activeRuns.delete(active.conversationId)
      }
    }
  }

  private emitState(conversationId: string, state: AgentState, detail?: string): void {
    const payload = detail === undefined ? { conversationId, state } : { conversationId, state, detail }
    this.dependencies.gateway.broadcast('agent.state.changed', payload)
  }

  private finishCancelled(active: ActiveRun): void {
    if (active.terminalCommitted) return
    active.terminalCommitted = true
    const metadata = this.dependencies.conversations.getMetadata(active.conversationId)
    const regexRules = metadata.characterId && this.dependencies.regexRules
      ? this.dependencies.regexRules.get(metadata.characterId)
      : undefined
    const content = regexRules
      ? transformCollectionSurface(active.accumulated, regexRules, 'AiOutput', 'Stored')
      : active.accumulated
    const message = this.dependencies.database.withWriteTx((database) => {
      const finished = this.dependencies.messages.finish(
        active.messageId, content, 'cancelled', database, undefined,
        regexRules ? rulesForSurface(regexRules, 'AiOutput', 'Stored') : []
      )
      this.dependencies.generations.finish(active.runId, 'cancelled')
      this.dependencies.conversations.touch(active.conversationId, content, database)
      return finished
    })
    if (this.activeRuns.get(active.conversationId) === active) {
      this.activeRuns.delete(active.conversationId)
    }
    this.dependencies.gateway.broadcast('agent.run.finished', {
      conversationId: active.conversationId,
      runId: active.runId,
      message
    })
    this.emitState(active.conversationId, 'idle')
  }

  private emitMessagesChanged(
    conversationId: string,
    reason: 'sent' | 'edited' | 'deleted' | 'regenerated',
    messageIds: string[]
  ): void {
    this.dependencies.gateway.broadcast('messages.changed', { conversationId, reason, messageIds })
  }

  private isCurrent(active: ActiveRun): boolean {
    return !active.cancelled && this.activeRuns.get(active.conversationId) === active
  }
}

function matchesExpectedRun(
  run: Pick<ActiveRun, 'runId' | 'requestId'> | Pick<PreparingRun, 'runId' | 'requestId'>,
  expected?: ExpectedRunIdentity
): boolean {
  if (!expected) return true
  if (run.requestId !== expected.requestId) return false
  return expected.runId === undefined || run.runId === expected.runId
}

function trailingCompleteCharacterIndex(content: string): number {
  return /[\uD800-\uDBFF]/.test(content.at(-1) ?? '') ? content.length - 1 : content.length
}

function generationCancelledError(): Error {
  const error = new Error('生成已停止')
  error.name = 'AbortError'
  return error
}
