import type { Context, Plugin } from '@deepseek-ai/cordis'
import { AgentSessionCoordinator } from './AgentSessionCoordinator'
import { DshAgentRuntime } from './DshAgentRuntime'
import { GenerationRepository } from './GenerationRepository'
import { AgentAttachmentCleanupRepository } from './AgentAttachmentCleanupRepository'
import { DshSessionCleanupRepository } from './DshSessionCleanupRepository'
import { AgentFileDrafts } from './AgentFileDrafts'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConversationArchiveRepository } from '@main/modules/conversations'
type DshSessionArchive = NonNullable<ReturnType<DshAgentRuntime['exportSession']>>

export const agentPlugin = {
  name: 'eleckoi-agent',
  inject: [
    'appPaths',
    'fileDrafts',
    'fileOpener',
    'appLog',
    'database',
    'desktopGateway',
    'conversations',
    'messages',
    'models',
    'personas',
    'variableStates',
    'settingLibraries',
    'agentPresets',
    'webSearchSettings',
    'regexRules',
    'userSettings'
  ],
  provide: ['agentSessions', 'pluginHost'],
  apply(ctx: Context) {
    const appPaths = ctx.appPaths
    const fileDrafts = ctx.fileDrafts
    const fileOpener = ctx.fileOpener
    const appLog = ctx.appLog
    const database = ctx.database
    const desktopGateway = ctx.desktopGateway
    const conversations = ctx.conversations
    const messages = ctx.messages
    const models = ctx.models
    const personas = ctx.personas
    const variableStates = ctx.variableStates
    const settingLibraries = ctx.settingLibraries
    const agentPresets = ctx.agentPresets
    const webSearchSettings = ctx.webSearchSettings
    const regexRules = ctx.regexRules
    const userSettings = ctx.userSettings
    const pluginFailureListeners = new Set<(error: Error) => void>()
    const runtime = new DshAgentRuntime(appPaths, models, webSearchSettings, error => {
      appLog.error({ error }, 'DSH plugin Host exited unexpectedly')
      desktopGateway.broadcast('plugins.host.failed', { message: '插件服务意外退出，请重新打开插件中心。' })
      for (const listener of pluginFailureListeners) listener(error)
    })
    const detachTranscriptReader = messages.attachTranscriptReader((runtimeThreadId) => (
      runtime.transcript(runtimeThreadId)
    ))
    const checkedThreads = new Set<string>()
    for (const response of messages.unboundActiveResponses()) {
      if (checkedThreads.has(response.runtimeThreadId)) continue
      checkedThreads.add(response.runtimeThreadId)
      try {
        messages.reconcileUnboundActiveResponses(response.runtimeThreadId)
      } catch (error) {
        appLog.warn({ err: error, conversationId: response.conversationId }, '历史 DSH 回合绑定失败')
      }
    }
    const detachPreviewReader = conversations.attachPreviewReader((conversationId) => (
      messages.latestPreview(conversationId)
    ))
    ctx.provide('pluginHost', {
      start: () => runtime.startPluginHost(),
      frontendDirectory: () => runtime.dshWebFrontendDirectory(),
      onFailure: (listener: (error: Error) => void) => {
        pluginFailureListeners.add(listener)
        return () => { pluginFailureListeners.delete(listener) }
      }
    })
    const generations = new GenerationRepository(database, messages)
    const attachmentCleanup = new AgentAttachmentCleanupRepository(database, runtime, messages)
    attachmentCleanup.drain()
    const sessions = new AgentSessionCoordinator({
      logger: appLog,
      runtime,
      database,
      gateway: desktopGateway,
      conversations,
      messages,
      personas,
      models,
      userSettings,
      generations,
      variableStates,
      settingLibraries,
      agentPresets,
      webSearchSettings,
      regexRules,
      discardPreparedImages: (attachmentIds) => attachmentCleanup.discardPrepared(attachmentIds),
      resolveInputFiles: (ids) => fileDrafts.resolve(ids),
      discardInputFiles: (ids) => fileDrafts.discard(ids),
      discardFileReferences: (refs) => attachmentCleanup.discardFiles(refs),
      queueFileReferences: (refs) => attachmentCleanup.queueFiles(refs),
      drainFileReferences: () => attachmentCleanup.drain(),
      enqueueAttachmentsBeforeDelete: (conversationId) => attachmentCleanup.enqueue(conversationId)
    })
    ctx.provide('agentSessions', sessions)
    const archives = new ConversationArchiveRepository(database)
    const unregisterDeleteCleanup = conversations.registerDeleteCleanup(attachmentCleanup)
    const sessionCleanup = new DshSessionCleanupRepository(database, messages, runtime)
    const unregisterSessionCleanup = conversations.registerDeleteCleanup(sessionCleanup)
    sessionCleanup.drain()
    const unregisterDeleteGuard = conversations.registerDeleteGuard(generations)
    const unregisterDeleteParticipant = conversations.registerDeleteParticipant(sessions)
    const detachSessionCreator = conversations.attachSessionCreator(id => sessions.createSession(id))

    const unregister = [
      desktopGateway.register('command.conversations.archive.export', ({ conversationId }) => {
        if (sessions.inspect(conversationId).active) throw new Error('请先等待当前回复结束，再导出聊天记录。')
        messages.assertReadableHistory(conversationId)
        const snapshot = archives.export(conversationId)
        const sessionLogs = messages.runtimeThreadIdsForArchive(conversationId)
          .map((id) => runtime.exportSession(id))
          .filter((item): item is DshSessionArchive => item !== null)
        const archivedIds = new Set<string>(sessionLogs.map((item) => item.header.id))
        if (archives.requiredRuntimeThreadIds(snapshot).some((id) => !archivedIds.has(id))) {
          throw new Error('聊天记录缺少对应的 DSH 会话日志，无法完整导出。')
        }
        return { json: JSON.stringify({
          format: 'eleckoi.desktop-chat-history', version: 1,
          exportedAt: new Date().toISOString(), snapshot, sessionLogs
        }, null, 2) }
      }),
      desktopGateway.register('command.conversations.archive.import', async ({ characterId, json }) => {
        let value: unknown
        try { value = JSON.parse(json) } catch { throw new Error('聊天记录不是有效的 JSON 文件。') }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('聊天记录文件格式不正确。')
        const archive = value as Record<string, unknown>
        if (archive.format !== 'eleckoi.desktop-chat-history' || archive.version !== 1
          || !Array.isArray(archive.sessionLogs)) throw new Error('不支持此聊天记录文件。')
        const snapshot = archives.parse(archive.snapshot)
        if (snapshot.characterId !== characterId) throw new Error('聊天记录与当前角色不匹配。')
        const logs = archive.sessionLogs as DshSessionArchive[]
        const expectedIds = new Set(archives.runtimeThreadIds(snapshot))
        const archivedIds = new Set<string>()
        for (const log of logs) {
          if (!log || typeof log !== 'object' || !log.header || typeof log.header.id !== 'string'
            || !expectedIds.has(log.header.id) || archivedIds.has(log.header.id)
            || !Array.isArray(log.events) || !Number.isSafeInteger(log.inheritedEventCount)) {
            throw new Error('聊天记录中的 DSH 会话数据无效。')
          }
          archivedIds.add(log.header.id)
        }
        if (archives.requiredRuntimeThreadIds(snapshot).some((id) => !archivedIds.has(id))) {
          throw new Error('聊天记录缺少对应的 DSH 会话日志。')
        }
        const conversationId = randomUUID()
        const ids = new Map([...expectedIds].map((id) => [id, id === snapshot.conversationId ? conversationId : randomUUID()]))
        try {
          await runtime.importSessions(logs, ids)
          const importedId = archives.import(snapshot, characterId, ids, conversationId)
          desktopGateway.broadcast('records.changed', { module: 'conversations' })
          return { conversationId: importedId }
        } catch (error) {
          await runtime.disposeConversation(conversationId, [...ids.values()]).catch(() => {})
          throw error
        }
      }),
      desktopGateway.register('command.agent.start', ({ conversationId, requestId, text, images, files }) => (
        sessions.start(conversationId, text, images, requestId, files)
      )),
      desktopGateway.register('command.agent.files.begin', ({ name, bytes }) => fileDrafts.begin(name, bytes)),
      desktopGateway.register('command.agent.files.chunk', ({ id, offset, data }) => fileDrafts.chunk(id, offset, data)),
      desktopGateway.register('command.agent.files.finish', ({ id }) => fileDrafts.finish(id)),
      desktopGateway.register('command.agent.files.discard', ({ ids }) => {
        fileDrafts.discard(ids)
        return { ok: true as const }
      }),
      desktopGateway.register('command.agent.cancel', ({ conversationId, requestId, runId }) => (
        sessions.cancel(conversationId, { requestId, runId })
      )),
      desktopGateway.register('command.agent.regenerate', ({ conversationId, requestId, targetMessageId, replacementMessage }) => (
        sessions.regenerate(
          conversationId,
          targetMessageId,
          replacementMessage === null ? undefined : replacementMessage,
          requestId
        )
      )),
      desktopGateway.register('command.conversations.messages.edit', ({ conversationId, messageId, content }) => (
        sessions.editMessage(conversationId, messageId, content)
      )),
      desktopGateway.register('command.conversations.messages.delete_from', ({ conversationId, messageId }) => (
        sessions.deleteMessagesFrom(conversationId, messageId)
      )),
      desktopGateway.register('query.agent.inspect', ({ conversationId }) => (
        sessions.inspect(conversationId)
      )),
      desktopGateway.register('query.agent.generation_stats', ({ conversationId }) => (
        sessions.generationStats(conversationId)
      )),
      desktopGateway.register('query.agent.trajectory', ({ conversationId, beforeIndex, limit }) => (
        sessions.trajectory(conversationId, { beforeIndex, limit })
      )),
      desktopGateway.register('query.agent.model_capabilities', (input) => (
        runtime.describeModelCapabilities(input)
      )),
      desktopGateway.register('query.agent.image', async ({ conversationId, attachmentId }) => {
        return runtime.readImage(messages.findInputImage(conversationId, attachmentId))
      }),
      desktopGateway.register('command.agent.file.reveal', ({ conversationId, attachmentId, name }) => {
        const reference = messages.findInputFile(conversationId, attachmentId, name)
        fileOpener.reveal(runtime.filePath(reference))
        return { ok: true as const }
      })
    ]

    return async () => {
      for (const dispose of unregister.reverse()) dispose()
      unregisterDeleteParticipant()
      detachSessionCreator()
      unregisterDeleteGuard()
      unregisterDeleteCleanup()
      unregisterSessionCleanup()
      await sessions.close()
      detachPreviewReader()
      detachTranscriptReader()
      await runtime.close()
    }
  }
} satisfies Plugin.Object

export const agentFileDraftsPlugin = {
  name: 'eleckoi-agent-file-drafts',
  inject: ['appPaths'],
  provide: 'fileDrafts',
  apply(ctx: Context) {
    const drafts = new AgentFileDrafts(join(ctx.appPaths.dshRuntime, 'file-drafts'))
    ctx.provide('fileDrafts', drafts)
    return () => drafts.close()
  }
} satisfies Plugin.Object
