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
    const pluginFailureListeners = new Set<(error: Error) => void>()
    const runtime = new DshAgentRuntime(ctx.appPaths, ctx.models, ctx.webSearchSettings, error => {
      ctx.appLog.error({ error }, 'DSH plugin Host exited unexpectedly')
      ctx.desktopGateway.broadcast('plugins.host.failed', { message: '插件服务意外退出，请重新打开插件中心。' })
      for (const listener of pluginFailureListeners) listener(error)
    })
    const detachTranscriptReader = ctx.messages.attachTranscriptReader((runtimeThreadId) => (
      runtime.transcript(runtimeThreadId)
    ))
    const checkedThreads = new Set<string>()
    for (const response of ctx.messages.unboundActiveResponses()) {
      if (checkedThreads.has(response.runtimeThreadId)) continue
      checkedThreads.add(response.runtimeThreadId)
      try {
        ctx.messages.reconcileUnboundActiveResponses(response.runtimeThreadId)
      } catch (error) {
        ctx.appLog.warn({ err: error, conversationId: response.conversationId }, '历史 DSH 回合绑定失败')
      }
    }
    const detachPreviewReader = ctx.conversations.attachPreviewReader((conversationId) => (
      ctx.messages.latestPreview(conversationId)
    ))
    ctx.provide('pluginHost', {
      start: () => runtime.startPluginHost(),
      frontendDirectory: () => runtime.dshWebFrontendDirectory(),
      onFailure: (listener: (error: Error) => void) => {
        pluginFailureListeners.add(listener)
        return () => { pluginFailureListeners.delete(listener) }
      }
    })
    const generations = new GenerationRepository(ctx.database, ctx.messages)
    const attachmentCleanup = new AgentAttachmentCleanupRepository(ctx.database, runtime, ctx.messages)
    attachmentCleanup.drain()
    const sessions = new AgentSessionCoordinator({
      logger: ctx.appLog,
      runtime,
      database: ctx.database,
      gateway: ctx.desktopGateway,
      conversations: ctx.conversations,
      messages: ctx.messages,
      personas: ctx.personas,
      models: ctx.models,
      userSettings: ctx.userSettings,
      generations,
      variableStates: ctx.variableStates,
      settingLibraries: ctx.settingLibraries,
      agentPresets: ctx.agentPresets,
      webSearchSettings: ctx.webSearchSettings,
      regexRules: ctx.regexRules,
      discardPreparedImages: (attachmentIds) => attachmentCleanup.discardPrepared(attachmentIds),
      resolveInputFiles: (ids) => ctx.fileDrafts.resolve(ids),
      discardInputFiles: (ids) => ctx.fileDrafts.discard(ids),
      discardFileReferences: (refs) => attachmentCleanup.discardFiles(refs),
      queueFileReferences: (refs) => attachmentCleanup.queueFiles(refs),
      drainFileReferences: () => attachmentCleanup.drain(),
      enqueueAttachmentsBeforeDelete: (conversationId) => attachmentCleanup.enqueue(conversationId)
    })
    ctx.provide('agentSessions', sessions)
    const archives = new ConversationArchiveRepository(ctx.database)
    const unregisterDeleteCleanup = ctx.conversations.registerDeleteCleanup(attachmentCleanup)
    const sessionCleanup = new DshSessionCleanupRepository(ctx.database, ctx.messages, runtime)
    const unregisterSessionCleanup = ctx.conversations.registerDeleteCleanup(sessionCleanup)
    sessionCleanup.drain()
    const unregisterDeleteGuard = ctx.conversations.registerDeleteGuard(generations)
    const unregisterDeleteParticipant = ctx.conversations.registerDeleteParticipant(sessions)
    const detachSessionCreator = ctx.conversations.attachSessionCreator(id => sessions.createSession(id))

    const unregister = [
      ctx.desktopGateway.register('command.conversations.archive.export', ({ conversationId }) => {
        if (sessions.inspect(conversationId).active) throw new Error('请先等待当前回复结束，再导出聊天记录。')
        ctx.messages.assertReadableHistory(conversationId)
        const snapshot = archives.export(conversationId)
        const sessionLogs = ctx.messages.runtimeThreadIdsForArchive(conversationId)
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
      ctx.desktopGateway.register('command.conversations.archive.import', async ({ characterId, json }) => {
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
          ctx.desktopGateway.broadcast('records.changed', { module: 'conversations' })
          return { conversationId: importedId }
        } catch (error) {
          await runtime.disposeConversation(conversationId, [...ids.values()]).catch(() => {})
          throw error
        }
      }),
      ctx.desktopGateway.register('command.agent.start', ({ conversationId, requestId, text, images, files }) => (
        sessions.start(conversationId, text, images, requestId, files)
      )),
      ctx.desktopGateway.register('command.agent.files.begin', ({ name, bytes }) => ctx.fileDrafts.begin(name, bytes)),
      ctx.desktopGateway.register('command.agent.files.chunk', ({ id, offset, data }) => ctx.fileDrafts.chunk(id, offset, data)),
      ctx.desktopGateway.register('command.agent.files.finish', ({ id }) => ctx.fileDrafts.finish(id)),
      ctx.desktopGateway.register('command.agent.files.discard', ({ ids }) => {
        ctx.fileDrafts.discard(ids)
        return { ok: true as const }
      }),
      ctx.desktopGateway.register('command.agent.cancel', ({ conversationId, requestId, runId }) => (
        sessions.cancel(conversationId, { requestId, runId })
      )),
      ctx.desktopGateway.register('command.agent.regenerate', ({ conversationId, requestId, targetMessageId, replacementMessage }) => (
        sessions.regenerate(
          conversationId,
          targetMessageId,
          replacementMessage === null ? undefined : replacementMessage,
          requestId
        )
      )),
      ctx.desktopGateway.register('command.conversations.messages.edit', ({ conversationId, messageId, content }) => (
        sessions.editMessage(conversationId, messageId, content)
      )),
      ctx.desktopGateway.register('command.conversations.messages.delete_from', ({ conversationId, messageId }) => (
        sessions.deleteMessagesFrom(conversationId, messageId)
      )),
      ctx.desktopGateway.register('query.agent.inspect', ({ conversationId }) => (
        sessions.inspect(conversationId)
      )),
      ctx.desktopGateway.register('query.agent.generation_stats', ({ conversationId }) => (
        sessions.generationStats(conversationId)
      )),
      ctx.desktopGateway.register('query.agent.trajectory', ({ conversationId, beforeIndex, limit }) => (
        sessions.trajectory(conversationId, { beforeIndex, limit })
      )),
      ctx.desktopGateway.register('query.agent.model_capabilities', (input) => (
        runtime.describeModelCapabilities(input)
      )),
      ctx.desktopGateway.register('query.agent.image', async ({ conversationId, attachmentId }) => {
        return runtime.readImage(ctx.messages.findInputImage(conversationId, attachmentId))
      }),
      ctx.desktopGateway.register('command.agent.file.reveal', ({ conversationId, attachmentId, name }) => {
        const reference = ctx.messages.findInputFile(conversationId, attachmentId, name)
        ctx.fileOpener.reveal(runtime.filePath(reference))
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
