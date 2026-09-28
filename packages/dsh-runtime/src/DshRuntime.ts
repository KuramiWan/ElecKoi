import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { CHAT_IMAGE_LIMITS } from '../../../src/shared/contracts/agent/imageLimits'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  commitPreparedImageFile,
  DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
  DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
  DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
  prepareImageFile,
  readImageFile
} from '@deepseek-ai/dsh-attachment-local'
import { DshProcessProjector, DshReplyProjector, finalReplyText } from './notifications'
import {
  createDshProviderCatalog,
  resolveDshProviderBinding,
  type DshProviderCatalog
} from './modelProfiles'
import {
  DshGenerationStatsProjector,
  emptyStoredGenerationStats,
  generationStatsFromSessionEvents,
  parseStoredGenerationStats,
  regenerationGenerationStats,
  type DshGenerationStats,
  type DshGenerationStatsAccumulated
} from './generationStats'
import type {
  DshConversationContext,
  DshRuntimeOptions,
  DshModelSettings,
  DshStreamCallbacks,
  DshVariableRuntimeContext,
  DshToolPolicy,
  DshEncodedImageAttachment,
  DshImageAttachmentRef,
  DshInputFile,
  DshFileAttachmentRef,
  DshAgentPreset,
  DshWebSearchSettings
} from './types'

const resolveRuntimeModule = createRequire(import.meta.url).resolve
import {
  readDshSessionLog,
  readDshTrajectory,
  type DshSessionEventRecord,
  type DshTrajectoryReadOptions
} from './trajectory'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { DshSessionRuntimeIdentity } from './sessionSnapshot'
import { GenerationStatsPersistence } from './generationStatsPersistence'
import type { DshDesktopPluginHost } from './desktopPluginHost'
import type { HostPromptPart } from './hostSessionProtocol'

const imageLimits: ImageAttachmentLimits = {
  ...CHAT_IMAGE_LIMITS,
  maxImagePixels: 64_000_000,
  maxImageDimension: 8192,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
}
const imageNormalizationPolicy = {
  maxPixels: DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
  maxDimension: DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
  maxBytes: DEFAULT_NORMALIZED_IMAGE_MAX_BYTES
}

interface ActiveRun {
  cancelled: boolean
  runtimeThreadId: string
}

export class DshRuntime {
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly startingRuns = new Map<string, ActiveRun>()
  private readonly cancellationTasks = new Map<string, Promise<void>>()
  private readonly conversationSessions = new Map<string, string>()
  private readonly pendingRewinds = new Map<string, { path: string; backup: string }>()
  private readonly generationStatsProjectors = new Map<string, DshGenerationStatsProjector>()
  private readonly generationStatsPersistence = new GenerationStatsPersistence()
  private readonly trajectoryEvents = new Map<string, DshSessionEventRecord[]>()
  private sessionHost: DshDesktopPluginHost | undefined
  private closed = false

  constructor(private readonly options: DshRuntimeOptions) {
    mkdirSync(options.workspaceRoot, { recursive: true })
    mkdirSync(join(options.runtimeDataRoot, 'home'), { recursive: true })
    mkdirSync(join(options.runtimeDataRoot, 'sessions'), { recursive: true })
    recoverPendingRewinds(join(options.runtimeDataRoot, 'sessions'))
    mkdirSync(join(options.runtimeDataRoot, 'session-snapshots'), { recursive: true })
    discardAbandonedConversationBridges(join(options.runtimeDataRoot, 'sessions'))
    discardEmbeddedConversationSnapshots(join(options.runtimeDataRoot, 'session-snapshots'))
  }

  bindSessionHost(host: DshDesktopPluginHost): void {
    if (this.sessionHost !== undefined) throw new Error('DSH 会话宿主已经绑定。')
    this.sessionHost = host
  }

  hostConfiguration(
    selectedCatalog?: DshProviderCatalog,
    selectedWebSearch?: DshWebSearchSettings,
    selectedModel?: DshModelSettings
  ): { providerPatchPath?: string; credentials: Record<string, string> } {
    const settings = this.options.modelCatalog?.() ?? []
    const catalog = selectedCatalog ?? (settings.length === 0
      ? { providers: {}, credentials: {}, bindings: {} } satisfies DshProviderCatalog
      : createDshProviderCatalog(settings))
    const webSearch = selectedWebSearch ?? this.options.webSearchSettings?.() ?? defaultWebSearchSettings()
    const nativeKey = settings.map(officialDeepSeekWebSearchApiKey).find(Boolean)
      ?? (selectedModel === undefined ? '' : officialDeepSeekWebSearchApiKey(selectedModel))
    return {
      providerPatchPath: this.materializeRuntimePatch(catalog),
      credentials: {
        ...catalog?.credentials,
        DSH_WEB_SEARCH_PROVIDER: webSearch.mode === 'tavily' ? 'tavily' : 'deepseek-official',
        ELECKOI_NATIVE_WEB_SEARCH_API_KEY: nativeKey,
        ELECKOI_TAVILY_API_KEY: webSearch.tavilyApiKey,
        ELECKOI_WEB_SEARCH_MAX_RESULTS: String(webSearch.maxResults)
      }
    }
  }

  async prepareImages(images: DshEncodedImageAttachment[]): Promise<DshImageAttachmentRef[]> {
    if (images.length > imageLimits.maxImagesPerMessage) throw new Error(`每条消息最多添加 ${imageLimits.maxImagesPerMessage} 张图片。`)
    const decoded = images.map(decodeImage)
    const totalBytes = decoded.reduce((total, image) => total + image.data.byteLength, 0)
    if (totalBytes > imageLimits.maxMessageImageBytes) throw new Error('每条消息的图片总计不能超过 200 MB。')
    const prepared = await Promise.all(decoded.map((image) => (
      prepareImageFile(image, imageLimits, imageNormalizationPolicy)
    )))
    const root = join(this.options.runtimeDataRoot, 'home', 'attachments', 'v1')
    const committed: DshImageAttachmentRef[] = []
    for (const image of prepared) {
      committed.push(await commitPreparedImageFile(root, image) as unknown as DshImageAttachmentRef)
    }
    return committed
  }

  async readImage(image: DshImageAttachmentRef): Promise<{ mediaType: DshImageAttachmentRef['mediaType']; data: string }> {
    const stored = await readImageFile(
      join(this.options.runtimeDataRoot, 'home', 'attachments', 'v1'),
      image as unknown as ImageAttachmentRef
    )
    return { mediaType: image.mediaType, data: Buffer.from(stored.data).toString('base64') }
  }

  removeImage(attachmentId: string): void {
    const match = /^sha256:([a-f0-9]{64})$/.exec(attachmentId)
    if (!match?.[1]) throw new Error('图片附件编号无效。')
    removeStoredAttachment(join(this.options.runtimeDataRoot, 'home', 'attachments', 'v1', 'objects', match[1].slice(0, 2), match[1]))
  }

  removeFile(reference: DshFileAttachmentRef, retainObject: boolean): void {
    const path = this.filePath(reference)
    const match = /^sha256:([a-f0-9]{64})$/.exec(reference.attachmentId)!
    const objectPath = join(this.options.runtimeDataRoot, 'home', 'attachments', 'v1', 'file-objects', match[1]!.slice(0, 2), match[1]!)
    removeStoredAttachment(path)
    if (retainObject) {
      if (existsSync(objectPath)) chmodSync(objectPath, 0o400)
    } else removeStoredAttachment(objectPath)
  }

  filePath(reference: DshFileAttachmentRef): string {
    const match = /^sha256:([a-f0-9]{64})$/.exec(reference.attachmentId)
    if (!match?.[1] || !reference.name || reference.name !== reference.name.trim()
      || reference.name === '.' || reference.name === '..'
      || /[/\\\u0000-\u001f\u007f<>:"|?*]/.test(reference.name)) {
      throw new Error('文件附件引用无效。')
    }
    const root = join(this.options.runtimeDataRoot, 'home', 'attachments', 'v1')
    return join(root, 'files', match[1].slice(0, 2), match[1], reference.name)
  }

  async stream(
    conversationId: string,
    text: string,
    settings: DshModelSettings,
    callbacks: DshStreamCallbacks,
    variableContext?: DshVariableRuntimeContext,
    conversationContext?: DshConversationContext,
    runtimeThreadId = conversationId,
    toolPolicy?: DshToolPolicy,
    discardRuntimeThreadIds: string[] = [],
    inputImages: DshImageAttachmentRef[] = [],
    agentPreset?: DshAgentPreset,
    webSearch?: DshWebSearchSettings,
    subagentSettings?: DshModelSettings,
    generationStatsSeed?: {
      previous?: DshGenerationStatsAccumulated | undefined
      previousRuntimeThreadId?: string | undefined
      retainedTurns: number
    },
    inputFiles: DshInputFile[] = []
  ): Promise<'complete' | 'cancelled'> {
    if (this.activeRuns.has(conversationId) || this.startingRuns.has(conversationId)) {
      throw new Error('这个对话仍有回复正在生成。')
    }
    const selectedAgentPreset = agentPreset ?? defaultAgentPreset()
    const selectedWebSearch = webSearch ?? defaultWebSearchSettings()
    const effectiveSubagentSettings = subagentSettings ?? settings
    const catalog = createDshProviderCatalog([
      ...(this.options.modelCatalog?.() ?? []),
      settings,
      effectiveSubagentSettings
    ])
    const mainBinding = resolveDshProviderBinding(catalog, settings)
    const subagentBinding = resolveDshProviderBinding(catalog, effectiveSubagentSettings)
    const run: ActiveRun = { cancelled: false, runtimeThreadId }
    let transientBridgeRoot: string | undefined
    this.startingRuns.set(conversationId, run)
    try {
      await this.waitForCancellationBarrier(conversationId)
      if (run.cancelled) return 'cancelled'
      const host = this.requireSessionHost()
      await host.start(this.hostConfiguration(catalog, selectedWebSearch, settings))
      if (run.cancelled) return 'cancelled'
      this.startingRuns.delete(conversationId)
      this.activeRuns.set(conversationId, run)
      const sessionRoot = join(this.options.runtimeDataRoot, 'sessions', safeConversationDirectory(conversationId))
      mkdirSync(sessionRoot, { recursive: true })
      transientBridgeRoot = sessionRoot
      if (generationStatsSeed) {
        const previousStepTotalsByTurn = generationStatsSeed.previousRuntimeThreadId
          ? this.generationStatsProjector(
            conversationId,
            generationStatsSeed.previousRuntimeThreadId,
            sessionRoot
          ).stored().stepTotalsByTurn
          : undefined
        const seeded = new DshGenerationStatsProjector(regenerationGenerationStats(
          generationStatsSeed.previous,
          generationStatsSeed.retainedTurns,
          previousStepTotalsByTurn
        ))
        this.generationStatsProjectors.set(generationStatsKey(conversationId, runtimeThreadId), seeded)
        this.generationStatsPersistence.schedule(generationStatsPath(sessionRoot, runtimeThreadId), JSON.stringify(seeded.stored()))
        callbacks.onGenerationStats?.(seeded.snapshot())
      }
      if (discardRuntimeThreadIds.length > 0) {
        await this.disposeRuntimeThreads(discardRuntimeThreadIds, runtimeThreadId)
        discardPersistedRuntimeThreads(
          join(this.options.runtimeDataRoot, 'sessions'),
          discardRuntimeThreadIds,
          runtimeThreadId
        )
        discardSessionSnapshots(
          join(this.options.runtimeDataRoot, 'session-snapshots'),
          discardRuntimeThreadIds,
          runtimeThreadId
        )
        await this.discardGenerationStats(conversationId, sessionRoot, discardRuntimeThreadIds, runtimeThreadId)
      }
      const variableStateFile = join(sessionRoot, 'eleckoi-variable-state.json')
      writeVariableBridge(variableStateFile, variableContext)
      const settingStateFile = join(sessionRoot, 'eleckoi-setting-library-state.json')
      writeSettingBridge(settingStateFile, conversationContext?.currentPromptText ?? text, conversationContext, variableContext)
      const contextFile = join(sessionRoot, 'eleckoi-conversation-context.json')
      writeContextBridge(contextFile, conversationContext?.currentPromptText ?? text, conversationContext)
      const effectiveToolPolicy = sessionToolPolicy(
        toolPolicy,
        variableContext !== undefined,
        conversationContext?.settingLibrary !== undefined,
        selectedAgentPreset.roleplayPlan.steps.length > 0
      )
      const requestedPresetId = this.materializeAgentPreset(
        selectedAgentPreset,
        effectiveToolPolicy,
        effectiveSubagentSettings,
        subagentBinding.provider,
        selectedWebSearch,
        settings
      )
      const snapshotRoot = join(this.options.runtimeDataRoot, 'session-snapshots')
      const storedSession = readDshSessionLog(join(this.options.runtimeDataRoot, 'sessions'), runtimeThreadId)
      const selectedPresetEvent = storedSession && [...storedSession.events].reverse()
        .find((event) => event.type === 'agent-preset/selected')
      const recordedPresetId = selectedPresetEvent && isRecord(selectedPresetEvent.data)
        ? selectedPresetEvent.data.agentPreset
        : storedSession?.header.agentPreset
      const mountedPresetId = typeof recordedPresetId === 'string' && recordedPresetId.length > 0
        ? recordedPresetId
        : requestedPresetId
      if (storedSession && mountedPresetId !== requestedPresetId
        && !existsSync(join(this.options.runtimeDataRoot, 'generated-presets', mountedPresetId, 'preset.json'))) {
        throw new Error(`DSH 会话原预设 ${mountedPresetId} 的组合文件不存在，不能安全切换配置。`)
      }
      const nextSessionSnapshot = {
        conversationId,
        runtimeThreadId,
        mountedPresetId,
        ...(mountedPresetId === requestedPresetId ? {} : { pendingPresetId: requestedPresetId }),
        model: requestSnapshot(settings, mainBinding),
        subagentModel: requestSnapshot(effectiveSubagentSettings, subagentBinding),
        variableStateFile,
        settingStateFile,
        contextFile,
        variablesEnabled: variableContext !== undefined,
        settingLibraryEnabled: conversationContext?.settingLibrary !== undefined,
        disabledToolGroupIds: effectiveToolPolicy.disabledGroupIds,
        roleplayPlanSteps: selectedAgentPreset.roleplayPlan.steps,
        historyCompactionInstructions: selectedAgentPreset.historyCompactionInstructions ?? '',
      }
      writeSessionSnapshot(
        snapshotRoot,
        runtimeThreadId,
        nextSessionSnapshot
      )
      this.conversationSessions.set(conversationId, runtimeThreadId)
      if (run.cancelled) return 'cancelled'
      const processProjector = new DshProcessProjector(runtimeThreadId, effectiveSubagentSettings.model)
      const replyProjector = new DshReplyProjector(runtimeThreadId)
      const generationStatsProjector = this.generationStatsProjector(conversationId, runtimeThreadId, sessionRoot)
      const content: HostPromptPart[] = [
        ...(text.trim() ? [{ type: 'text' as const, text }] : []),
        ...await Promise.all(inputImages.map(async attachment => ({
          type: 'image' as const,
          mediaType: attachment.mediaType,
          data: (await this.readImage(attachment)).data,
          ...(attachment.name === undefined ? {} : { name: attachment.name })
        })))
      ]
      const result = await host.run({
        sessionId: runtimeThreadId,
        cwd: this.options.workspaceRoot,
        selection: mainBinding,
        content,
        files: inputFiles,
        onNotification: (notification) => {
          if (notification.method === 'agent.file-uploaded' && isRecord(notification.params.file)) {
            const file = notification.params.file
            const draftId = notification.params.draftId
            if (typeof draftId === 'string' && typeof file.attachmentId === 'string'
              && typeof file.name === 'string' && typeof file.bytes === 'number') {
              callbacks.onFileUploaded?.(draftId, file as unknown as DshFileAttachmentRef)
            }
          }
          maintainSubagentSessionSnapshot(join(this.options.runtimeDataRoot, 'session-snapshots'), notification)
          this.captureTrajectoryEvent(conversationId, runtimeThreadId, notification)
          if (run.cancelled) return
          const sessionEvent = notification.method === 'session.event' && isRecord(notification.params.event)
            ? notification.params.event
            : undefined
          if (notification.method === 'session.event'
            && notification.params.sessionId === runtimeThreadId
            && sessionEvent?.type === 'turn/start') {
            const turn = isRecord(sessionEvent.data) ? sessionEvent.data.turn : undefined
            if (typeof turn === 'number' && Number.isSafeInteger(turn) && turn > 0) {
              callbacks.onTurnStarted?.(turn)
            }
          }
          const generationStats = generationStatsProjector.project(notification, runtimeThreadId)
          if (generationStats !== undefined) {
            this.generationStatsPersistence.schedule(generationStatsPath(sessionRoot, runtimeThreadId), JSON.stringify(generationStatsProjector.stored()))
            callbacks.onGenerationStats?.(generationStats)
          }
          const delta = replyProjector.project(notification)
          if (delta !== undefined) callbacks.onDelta(delta)
          const processItem = processProjector.project(notification)
          if (processItem !== undefined) callbacks.onProcessItem?.(processItem)
        }
      })
      await this.generationStatsPersistence.flush(generationStatsPath(sessionRoot, runtimeThreadId))
      if (run.cancelled) return 'cancelled'
      const turnEnd = [...result.events].reverse().find((event) => isRecord(event) && event.type === 'turn/end')
      if (turnEnd === undefined) throw new Error('DSH session ended without a turn/end event')
      const turnFailure = turnEndFailureMessage(turnEnd)
      if (turnFailure !== undefined) throw new Error(turnFailure)
      if (variableContext !== undefined) callbacks.onVariableState?.(readVariableBridgeState(variableStateFile))
      if (conversationContext?.settingLibrary !== undefined) callbacks.onSettingLibraryState?.(readSettingBridgeState(settingStateFile))
      callbacks.onFinal(finalReplyText(result.finalResponse))
      return 'complete'
    } catch (error) {
      if (run.cancelled) return 'cancelled'
      throw error
    } finally {
      if (this.startingRuns.get(conversationId) === run) this.startingRuns.delete(conversationId)
      if (this.activeRuns.get(conversationId) === run) this.activeRuns.delete(conversationId)
      if (transientBridgeRoot !== undefined) discardConversationBridges(transientBridgeRoot)
    }
  }

  async stop(conversationId: string): Promise<boolean> {
    const starting = this.startingRuns.get(conversationId)
    if (starting !== undefined) {
      starting.cancelled = true
      this.startingRuns.delete(conversationId)
      return true
    }
    const run = this.activeRuns.get(conversationId)
    if (run === undefined) return false
    run.cancelled = true
    if (this.activeRuns.get(conversationId) === run) this.activeRuns.delete(conversationId)
    const cancellation = (async () => {
      await this.sessionHost?.cancel(run.runtimeThreadId)
    })()
    this.cancellationTasks.set(conversationId, cancellation)
    try {
      await cancellation
      return true
    } finally {
      if (this.cancellationTasks.get(conversationId) === cancellation) {
        this.cancellationTasks.delete(conversationId)
      }
    }
  }

  private async waitForCancellationBarrier(conversationId: string): Promise<void> {
    const cancellation = this.cancellationTasks.get(conversationId)
    if (cancellation === undefined) return
    try {
      await cancellation
    } catch {
      // The previous cancellation is reported by its caller. A fresh runtime
      // thread can still start after the old cancellation has settled.
    }
  }

  async disposeConversation(
    conversationId: string,
    runtimeThreadIds: readonly string[] = [],
    retainedRuntimeThreadIds: readonly string[] = []
  ): Promise<void> {
    const run = this.activeRuns.get(conversationId)
    if (run !== undefined) {
      run.cancelled = true
      await this.stop(conversationId)
    }
    const runtimeThreadId = this.conversationSessions.get(conversationId)
    const discardedThreadIds = [...new Set([
      ...runtimeThreadIds,
      ...(runtimeThreadId ? [runtimeThreadId] : [])
    ])]
    if (discardedThreadIds.length > 0) {
      await this.disposeRuntimeThreads(discardedThreadIds, '')
      const retained = new Set(retainedRuntimeThreadIds)
      const obsolete = discardedThreadIds.filter((id) => !retained.has(id))
      discardPersistedRuntimeThreads(join(this.options.runtimeDataRoot, 'sessions'), obsolete, '')
      discardSessionSnapshots(join(this.options.runtimeDataRoot, 'session-snapshots'), obsolete, '')
    }
    const conversationRoot = join(this.options.runtimeDataRoot, 'sessions', safeConversationDirectory(conversationId))
    if (retainedRuntimeThreadIds.length === 0) {
      await this.generationStatsPersistence.discardDirectory(join(conversationRoot, 'eleckoi-generation-stats'))
      rmSync(conversationRoot, {
        recursive: true,
        force: true
      })
    } else {
      const retained = new Set(retainedRuntimeThreadIds)
      await this.discardGenerationStats(
        conversationId, conversationRoot, runtimeThreadIds.filter((id) => !retained.has(id)), ''
      )
    }
    this.conversationSessions.delete(conversationId)
    this.activeRuns.delete(conversationId)
    clearConversationEntries(this.trajectoryEvents, conversationId)
    clearConversationEntries(this.generationStatsProjectors, conversationId)
  }

  /** Close the DSH writer before physically removing one turn and its successors. */
  async rewindConversation(conversationId: string, runtimeThreadId: string, fromTurn: number): Promise<'rewound' | 'unavailable'> {
    if (this.activeRuns.has(conversationId) || this.startingRuns.has(conversationId)) {
      throw new Error('回复仍在生成，不能回退 DSH 会话。')
    }
    const conversationRoot = join(this.options.runtimeDataRoot, 'sessions', safeConversationDirectory(conversationId))
    if (this.pendingRewinds.has(conversationId)) throw new Error('上一次 DSH 回退尚未提交。')
    const stored = readDshSessionLog(join(this.options.runtimeDataRoot, 'sessions'), runtimeThreadId)
    if (!stored) return 'unavailable'
    const backup = `${stored.path}.eleckoi-pending-rewind-${randomUUID()}.bak`
    copyFileSync(stored.path, backup)
    let cut: number | undefined
    try {
      cut = await this.requireSessionHost().rewind(runtimeThreadId, fromTurn)
    } catch (error) {
      copyFileSync(backup, stored.path)
      rmSync(backup, { force: true })
      throw error
    }
    if (cut === undefined) {
      rmSync(backup, { force: true })
      return 'unavailable'
    }
    this.pendingRewinds.set(conversationId, { path: stored.path, backup })
    const statsPath = generationStatsPath(conversationRoot, runtimeThreadId)
    await this.generationStatsPersistence.discard(statsPath)
    this.generationStatsProjectors.delete(generationStatsKey(conversationId, runtimeThreadId))
    this.trajectoryEvents.delete(trajectoryKey(conversationId, runtimeThreadId))
    try {
      rmSync(statsPath, { force: true })
    } catch (error) {
      console.warn('DSH 生成统计缓存清理失败；后续统计仍以会话日志为准。', error)
    }
    return 'rewound'
  }

  confirmRewind(conversationId: string): void {
    const pending = this.pendingRewinds.get(conversationId)
    if (!pending) return
    const committed = `${pending.backup}.committed`
    try {
      renameSync(pending.backup, committed)
    } catch (renameError) {
      try { rmSync(pending.backup, { force: true }) } catch {
        throw renameError
      }
    }
    this.pendingRewinds.delete(conversationId)
    try { rmSync(committed, { force: true }) } catch (error) {
      console.warn('已提交的 DSH 回退备份清理失败。', error)
    }
  }

  async rollbackRewind(conversationId: string, runtimeThreadId: string): Promise<void> {
    const pending = this.pendingRewinds.get(conversationId)
    if (!pending) return
    await this.disposeRuntimeThreads([runtimeThreadId], '')
    copyFileSync(pending.backup, pending.path)
    if (!readDshSessionLog(join(this.options.runtimeDataRoot, 'sessions'), runtimeThreadId)) {
      throw new Error('DSH 回退恢复后的会话日志无法读取。')
    }
    rmSync(pending.backup, { force: true })
    this.pendingRewinds.delete(conversationId)
  }

  generationStats(conversationId: string, runtimeThreadId: string): DshGenerationStats | undefined {
    if (!runtimeThreadId) return undefined
    const sessionRoot = join(this.options.runtimeDataRoot, 'sessions', safeConversationDirectory(conversationId))
    return this.generationStatsProjector(conversationId, runtimeThreadId, sessionRoot).snapshot()
  }

  trajectory(conversationId: string, runtimeThreadId: string, options?: DshTrajectoryReadOptions) {
    const sessionLogRoot = join(this.options.runtimeDataRoot, 'sessions')
    const active = this.activeRuns.get(conversationId)
    const liveEvents = active?.runtimeThreadId === runtimeThreadId
      ? this.trajectoryEvents.get(trajectoryKey(conversationId, runtimeThreadId))
      : undefined
    return readDshTrajectory(
      sessionLogRoot,
      runtimeThreadId,
      options,
      liveEvents
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const run of this.startingRuns.values()) run.cancelled = true
    for (const run of this.activeRuns.values()) run.cancelled = true
    await this.sessionHost?.close()
    await Promise.allSettled([...this.cancellationTasks.values()])
    await this.generationStatsPersistence.close()
    discardInheritedSessionSnapshots(join(this.options.runtimeDataRoot, 'session-snapshots'))
    this.activeRuns.clear()
    this.startingRuns.clear()
    this.cancellationTasks.clear()
    this.conversationSessions.clear()
    this.trajectoryEvents.clear()
    this.generationStatsProjectors.clear()
  }

  async verify(): Promise<void> {
    const agentPreset = defaultAgentPreset()
    const settings: DshModelSettings = {
      configId: 'eleckoi-runtime-health-check',
      provider: 'deepseek',
      apiKey: 'eleckoi-runtime-health-check',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      systemPrompt: 'ElecKoi DSH runtime health check.',
      apiFormat: 'openai-completions',
      customHeaders: {},
      contextWindow: 128000,
      supportsImageInput: false
    }
    const catalog = createDshProviderCatalog([settings])
    this.materializeAgentPreset(agentPreset, undefined, settings, resolveDshProviderBinding(catalog, settings).provider)
    await this.requireSessionHost().start(this.hostConfiguration(catalog, defaultWebSearchSettings(), settings))
  }

  /**
   * DSH patch files are configuration documents, not JavaScript containers.
   * Materializing the provider dictionaries as literal JSON keeps the complete
   * route set on the official llm-pi-ai / llm-deepseek configuration path.
   */
  materializeRuntimePatch(catalog: DshProviderCatalog): string {
    const deepseek = catalog.deepseek ?? {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com',
      defaultContextWindow: 1_000_000,
      models: []
    }
    const document = [
      { id: 'llm-pi-ai', config: { providers: catalog.providers } },
      {
        id: 'llm-deepseek',
        config: {
          apiKeyEnv: deepseek.apiKeyEnv,
          baseURL: deepseek.baseURL,
          defaultContextWindow: deepseek.defaultContextWindow,
          models: deepseek.models
        }
      }
    ]
    const content = `${JSON.stringify(document, null, 2)}\n`
    const fingerprint = createHash('sha256').update(content).digest('hex').slice(0, 16)
    const directory = join(this.options.runtimeDataRoot, 'generated-config')
    const path = join(directory, `providers-${fingerprint}.patch.yml`)
    mkdirSync(directory, { recursive: true })
    writeAtomically(path, content)
    return path
  }

  private requireSessionHost(): DshDesktopPluginHost {
    if (this.closed) throw new Error('DSH 运行时已经关闭。')
    if (this.sessionHost === undefined) throw new Error('DSH 会话宿主尚未绑定。')
    return this.sessionHost
  }

  private async disposeRuntimeThreads(threadIds: readonly string[], selectedThreadId: string): Promise<void> {
    const host = this.sessionHost
    if (host === undefined) return
    for (const sessionId of new Set(threadIds)) {
      if (sessionId && sessionId !== selectedThreadId) await host.dispose(sessionId)
    }
  }

  private captureTrajectoryEvent(
    conversationId: string,
    runtimeThreadId: string,
    notification: HarnessNotification
  ): void {
    if (notification.method !== 'session.event' || notification.params.sessionId !== runtimeThreadId) return
    const event = notification.params.event
    if (!isRecord(event) || typeof event.type !== 'string') return
    const key = trajectoryKey(conversationId, runtimeThreadId)
    const events = this.trajectoryEvents.get(key) ?? []
    const seq = typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq >= 0
      ? event.seq
      : undefined
    const existingIndex = seq === undefined ? -1 : events.findIndex((item) => item.seq === seq)
    if (existingIndex >= 0) events[existingIndex] = event
    else events.push(event)
    if (events.length > 20_000) events.splice(0, events.length - 20_000)
    this.trajectoryEvents.set(key, events)
  }

  private materializeAgentPreset(
    preset: DshAgentPreset,
    toolPolicy?: DshToolPolicy,
    subagentSettings?: DshModelSettings,
    subagentProvider?: string,
    webSearch: DshWebSearchSettings = defaultWebSearchSettings(),
    mainSettings?: DshModelSettings
  ): string {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(preset.id)) throw new Error('预设编号不能用于 DSH Agent Preset。')
    const mountedPresetId = runtimePresetId(preset, toolPolicy, subagentSettings, subagentProvider, webSearch, mainSettings)
    const root = join(this.options.runtimeDataRoot, 'generated-presets')
    const directory = join(root, mountedPresetId)
    mkdirSync(directory, { recursive: true })
    const pluginRoot = join(dirname(this.options.presetTemplatePath), '..')
    const compaction = resolveCompactionPolicy(mainSettings)
    let composition = readFileSync(this.options.presetTemplatePath, 'utf8')
      .replace('__ELECKOI_SETTING_LIBRARY_TOOLS_PLUGIN__', JSON.stringify(pathToFileURL(join(pluginRoot, 'setting-library-tools.mjs')).href))
      .replace('__ELECKOI_UPLOADED_FILE_TOOLS_PLUGIN__', JSON.stringify(pathToFileURL(join(pluginRoot, 'uploaded-file-tools.mjs')).href))
      .replace('__ELECKOI_VARIABLE_TOOLS_PLUGIN__', JSON.stringify(pathToFileURL(join(pluginRoot, 'variable-tools.mjs')).href))
      .replace('__ELECKOI_ROLEPLAY_PLAN_TOOL_PLUGIN__', JSON.stringify(pathToFileURL(join(pluginRoot, 'roleplay-plan-tool.mjs')).href))
      .replace('__ELECKOI_ROLEPLAY_PLAN_STEPS__', JSON.stringify(preset.roleplayPlan.steps))
      .replace('__ELECKOI_WEB_SEARCH_MAX_RESULTS__', String(webSearch.maxResults))
      .replace('__ELECKOI_COMPACTION_THRESHOLD_RATIO__', compaction.thresholdRatio)
      .replace('__ELECKOI_COMPACTION_RETENTION__', compaction.retention)
      .replaceAll('__ELECKOI_SUBAGENT_OPTIONS__', subagentSettings ? [
        '    agentOptions:',
        `      provider: ${JSON.stringify(subagentProvider ?? 'custom')}`,
        `      model: ${JSON.stringify(resolveDshProviderBinding(
          createDshProviderCatalog([subagentSettings]),
          subagentSettings
        ).model)}`,
        ...(subagentSettings.maxTokens === undefined ? [] : [`      maxTokens: ${subagentSettings.maxTokens}`])
      ].join('\n') : '')
    composition = resolvePresetPluginSpecifiers(composition)
    const disabled = new Set(toolPolicy?.disabledGroupIds ?? [])
    composition = applyPresetToolPolicy(composition, disabled)
    const plugins: unknown = parseYaml(composition)
    if (!Array.isArray(plugins)) throw new Error('DSH Agent 预设组合必须是插件列表。')
    writeAtomically(join(directory, 'preset.json'), JSON.stringify({
      id: mountedPresetId,
      name: preset.name,
      description: `ElecKoi 预设版本 ${preset.versionId}`,
      plugins
    }, null, 2))
    return mountedPresetId
  }

  private generationStatsProjector(conversationId: string, runtimeThreadId: string, sessionRoot: string): DshGenerationStatsProjector {
    const key = generationStatsKey(conversationId, runtimeThreadId)
    const existing = this.generationStatsProjectors.get(key)
    if (existing) return existing
    let projector: DshGenerationStatsProjector | undefined
    try {
      const log = readDshSessionLog(join(this.options.runtimeDataRoot, 'sessions'), runtimeThreadId)
      if (log?.header.version === sessionFormatCatalog.currentVersion) {
        projector = generationStatsFromSessionEvents(
          log.events as unknown as Parameters<typeof generationStatsFromSessionEvents>[0], runtimeThreadId
        )
      }
    } catch (error) {
      console.warn('DSH 会话统计无法从日志重建，将使用上次保存的统计缓存。', error)
    }
    projector ??= new DshGenerationStatsProjector(readStoredGenerationStats(sessionRoot, runtimeThreadId))
    this.generationStatsProjectors.set(key, projector)
    return projector
  }

  private async discardGenerationStats(conversationId: string, sessionRoot: string, threadIds: string[], selectedThreadId: string): Promise<void> {
    for (const threadId of threadIds) {
      if (threadId === selectedThreadId) continue
      await this.generationStatsPersistence.discard(generationStatsPath(sessionRoot, threadId))
      this.generationStatsProjectors.delete(generationStatsKey(conversationId, threadId))
      rmSync(generationStatsPath(sessionRoot, threadId), { force: true })
    }
  }

}

function resolvePresetPluginSpecifiers(source: string): string {
  return source.replace(
    /(^\s*name:\s*)(['"])(@deepseek-ai\/[^'"\r\n]+)\2\s*$/gm,
    (_match, prefix: string, _quote: string, specifier: string) => (
      `${prefix}${JSON.stringify(pathToFileURL(resolveRuntimeModule(specifier)).href)}`
    )
  )
}

function defaultAgentPreset(): DshAgentPreset {
  return {
    id: 'agent-preset-standard',
    versionId: 'agent-preset-standard-v1',
    name: '默认 Agent 预设',
    roleplayPlan: {
      steps: [
        '必须先并行调用工具调研阅读设定，这里不扮演回复，禁止未阅读设定直接回复',
        '等前置任务都完成，直接输出 <FINAL> 正文，不要再次调用 update_roleplay_plan；应用检测到正文后会自动完成最终项的标记。'
      ]
    }
  }
}

function defaultWebSearchSettings(): DshWebSearchSettings {
  return { mode: 'provider_native', maxResults: 5, tavilyApiKey: '' }
}

function sessionToolPolicy(
  policy: DshToolPolicy | undefined,
  variablesEnabled: boolean,
  settingLibraryEnabled: boolean,
  roleplayWorkflowEnabled: boolean
): DshToolPolicy {
  const disabled = new Set(policy?.disabledGroupIds ?? [])
  if (!variablesEnabled) disabled.add('builtin:variables')
  if (!settingLibraryEnabled) disabled.add('builtin:setting-library')
  if (!roleplayWorkflowEnabled) disabled.add('builtin:roleplay-workflow')
  return { disabledGroupIds: [...disabled] }
}

function requestSnapshot(settings: DshModelSettings, binding: { provider: string; model: string; reasoningEffort?: string }) {
  return {
    configId: settings.configId,
    provider: binding.provider,
    model: binding.model,
    systemPrompt: settings.systemPrompt,
    ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    ...(settings.maxTokens === undefined ? {} : { maxTokens: settings.maxTokens }),
    ...(binding.reasoningEffort === undefined ? {} : { reasoningEffort: binding.reasoningEffort })
  }
}

function runtimePresetId(
  preset: DshAgentPreset,
  toolPolicy: DshToolPolicy | undefined,
  subagentSettings: DshModelSettings | undefined,
  subagentProvider: string | undefined,
  webSearch: DshWebSearchSettings,
  mainSettings: DshModelSettings | undefined
): string {
  const compaction = resolveCompactionPolicy(mainSettings)
  const fingerprint = createHash('sha256').update(JSON.stringify({
    preset,
    disabledToolGroupIds: [...(toolPolicy?.disabledGroupIds ?? [])].sort(),
    subagent: subagentSettings === undefined ? null : {
      provider: subagentProvider,
      model: subagentSettings.model,
      maxTokens: subagentSettings.maxTokens
    },
    webSearchMaxResults: webSearch.maxResults,
    compaction
  })).digest('hex').slice(0, 16)
  const prefix = preset.id.replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'preset'
  return `${prefix}-${fingerprint}`
}

function resolveCompactionPolicy(mainSettings: DshModelSettings | undefined): {
  thresholdRatio: string
  retention: string
} {
  if (mainSettings?.autoCompactTokenLimit === undefined) {
    return { thresholdRatio: '0.8', retention: 'retainTokens: 0' }
  }
  const { autoCompactTokenLimit, contextWindow } = mainSettings
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    throw new Error('自动压缩阈值缺少有效的模型上下文窗口。')
  }
  if (!Number.isInteger(autoCompactTokenLimit) || autoCompactTokenLimit <= 0 || autoCompactTokenLimit > contextWindow) {
    throw new Error('自动压缩阈值必须大于 0 且不能超过模型上下文窗口。')
  }
  return {
    thresholdRatio: String(autoCompactTokenLimit / contextWindow),
    // 触发阈值不推导另一套固定保留比例，交给 DSH 选择平衡切点。
    retention: 'retainTokens: 0'
  }
}

function writeSessionSnapshot(root: string, runtimeThreadId: string, value: Record<string, unknown>): void {
  mkdirSync(root, { recursive: true })
  writeAtomically(join(root, `${safeRuntimeThreadFile(runtimeThreadId)}.json`), JSON.stringify(value, null, 2))
}

function readSessionSnapshot(
  root: string,
  runtimeThreadId: string
): (DshSessionRuntimeIdentity & Record<string, unknown>) | undefined {
  const path = join(root, `${safeRuntimeThreadFile(runtimeThreadId)}.json`)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function discardSessionSnapshots(root: string, threadIds: readonly string[], selectedThreadId: string): void {
  const discarded = new Set(threadIds.filter((threadId) => threadId && threadId !== selectedThreadId))
  for (const threadId of discarded) {
    rmSync(join(root, `${safeRuntimeThreadFile(threadId)}.json`), { force: true })
  }
  if (discarded.size === 0 || !existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    const path = join(root, entry.name)
    const snapshot = readSnapshotRecord(path)
    const inheritedRoot = typeof snapshot?.rootRuntimeThreadId === 'string'
      ? snapshot.rootRuntimeThreadId
      : typeof snapshot?.runtimeThreadId === 'string'
        ? snapshot.runtimeThreadId
        : undefined
    if (inheritedRoot !== undefined && discarded.has(inheritedRoot)) rmSync(path, { force: true })
  }
}

function maintainSubagentSessionSnapshot(root: string, notification: HarnessNotification): void {
  if (notification.method !== 'subagent.started' && notification.method !== 'subagent.finished') return
  const childSessionId = typeof notification.params.childSessionId === 'string'
    ? notification.params.childSessionId
    : ''
  if (!childSessionId) return
  const childPath = join(root, `${safeRuntimeThreadFile(childSessionId)}.json`)
  if (notification.method === 'subagent.finished') {
    rmSync(childPath, { force: true })
    return
  }
  if (existsSync(childPath)) return
  const parentSessionId = typeof notification.params.parentSessionId === 'string'
    ? notification.params.parentSessionId
    : ''
  if (!parentSessionId) return
  const parentSnapshot = readSessionSnapshot(root, parentSessionId)
  if (parentSnapshot === undefined) return
  writeSessionSnapshot(root, childSessionId, {
    ...parentSnapshot,
    inheritedFromSessionId: parentSessionId,
    rootRuntimeThreadId: typeof parentSnapshot.rootRuntimeThreadId === 'string'
      ? parentSnapshot.rootRuntimeThreadId
      : typeof parentSnapshot.runtimeThreadId === 'string'
        ? parentSnapshot.runtimeThreadId
        : parentSessionId
  })
}

function discardInheritedSessionSnapshots(root: string): void {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    const path = join(root, entry.name)
    const snapshot = readSnapshotRecord(path)
    if (typeof snapshot?.inheritedFromSessionId === 'string') rmSync(path, { force: true })
  }
}

function readSnapshotRecord(path: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function officialDeepSeekWebSearchApiKey(settings: DshModelSettings): string {
  try {
    return new URL(settings.baseUrl).hostname.toLowerCase() === 'api.deepseek.com' ? settings.apiKey : ''
  } catch {
    return ''
  }
}

function writeAtomically(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function applyPresetToolPolicy(source: string, disabled: ReadonlySet<string>): string {
  const sections: ReadonlyArray<[string, string]> = [
    ['variables', 'builtin:variables'],
    ['setting-library', 'builtin:setting-library'],
    ['web', 'builtin:web'],
    ['workspace', 'builtin:workspace'],
    ['collaboration', 'builtin:collaboration'],
    ['roleplay-workflow', 'builtin:roleplay-workflow'],
    ['workflow', 'builtin:workflow']
  ]
  return sections.reduce((content, [section, groupId]) => (
    disabled.has(groupId) ? removePresetSection(content, section) : content
  ), source)
}

function removePresetSection(source: string, section: string): string {
  const begin = `# ELECKOI:${section}:BEGIN`
  const end = `# ELECKOI:${section}:END`
  const start = source.indexOf(begin)
  const finish = source.indexOf(end)
  if (start < 0 || finish < start) throw new Error(`DSH 预设模板缺少工具段：${section}`)
  return `${source.slice(0, start)}${source.slice(finish + end.length).replace(/^\r?\n/, '')}`
}

function decodeImage(image: DshEncodedImageAttachment): SaveImageAttachment {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) {
    throw new Error('图片数据损坏，请重新添加。')
  }
  const data = Buffer.from(image.data, 'base64')
  if (data.byteLength === 0 || data.toString('base64') !== image.data) {
    throw new Error('图片数据损坏，请重新添加。')
  }
  return { data, mediaType: image.mediaType, ...(image.name ? { name: image.name } : {}) }
}

function safeConversationDirectory(conversationId: string): string {
  return conversationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'default'
}

function removeStoredAttachment(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if ((code !== 'EPERM' && code !== 'EACCES') || !existsSync(path)) throw error
    chmodSync(path, 0o600)
    try {
      rmSync(path, { force: true })
    } catch (retryError) {
      if (existsSync(path)) chmodSync(path, 0o400)
      throw retryError
    }
  }
}

function safeRuntimeThreadFile(runtimeThreadId: string): string {
  return runtimeThreadId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160) || 'default'
}

function generationStatsKey(conversationId: string, runtimeThreadId: string): string {
  return `${conversationId}\u0000${runtimeThreadId}`
}

function generationStatsPath(sessionRoot: string, runtimeThreadId: string): string {
  return join(sessionRoot, 'eleckoi-generation-stats', `${safeRuntimeThreadFile(runtimeThreadId)}.json`)
}

function readStoredGenerationStats(sessionRoot: string, runtimeThreadId: string) {
  const path = generationStatsPath(sessionRoot, runtimeThreadId)
  if (!existsSync(path)) return emptyStoredGenerationStats()
  try {
    return parseStoredGenerationStats(JSON.parse(readFileSync(path, 'utf8'))) ?? emptyStoredGenerationStats()
  } catch {
    return emptyStoredGenerationStats()
  }
}

/** Removes obsolete DSH session artifacts after regeneration. */
function discardPersistedRuntimeThreads(sessionRoot: string, threadIds: string[], selectedThreadId: string): void {
  const discarded = new Set(threadIds.filter((id) => id.length > 0 && id !== selectedThreadId))
  if (discarded.size === 0 || !existsSync(sessionRoot)) return
  const root = realpathSync(sessionRoot)
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue
    const projectPath = join(root, project.name)
    for (const session of readdirSync(projectPath, { withFileTypes: true })) {
      if (!session.isDirectory() || session.isSymbolicLink()) continue
      const candidate = join(projectPath, session.name)
      const resolved = realpathSync(candidate)
      if (!isDescendant(root, resolved)) continue
      const storedId = latestStoredSessionId(resolved)
      if (storedId === undefined || !discarded.has(storedId)) continue
      rmSync(resolved, { recursive: true, force: true })
    }
  }
}

function recoverPendingRewinds(sessionRoot: string): void {
  for (const project of readdirSync(sessionRoot, { withFileTypes: true })) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue
    const projectPath = join(sessionRoot, project.name)
    for (const session of readdirSync(projectPath, { withFileTypes: true })) {
      if (!session.isDirectory() || session.isSymbolicLink()) continue
      const sessionPath = join(projectPath, session.name)
      for (const file of readdirSync(sessionPath, { withFileTypes: true })) {
        if (!file.isFile() || file.isSymbolicLink()) continue
        const match = /^(session(?:\.v\d+)?\.jsonl)\.eleckoi-pending-rewind-[0-9a-f-]{36}\.bak$/.exec(file.name)
        if (!match) continue
        const backup = join(sessionPath, file.name)
        const original = join(sessionPath, match[1]!)
        copyFileSync(backup, original)
        rmSync(backup, { force: true })
      }
    }
  }
}

function latestStoredSessionId(sessionDirectory: string): string | undefined {
  const logs = readdirSync(sessionDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, version: sessionLogVersion(entry.name) }))
    .filter((entry): entry is { name: string; version: number } => entry.version !== undefined)
    .sort((left, right) => right.version - left.version)
  for (const log of logs) {
    const id = storedSessionId(join(sessionDirectory, log.name))
    if (id !== undefined) return id
  }
  return undefined
}

function sessionLogVersion(filename: string): number | undefined {
  if (filename === 'session.jsonl') return 0
  const match = /^session\.v([1-9]\d*)\.jsonl$/.exec(filename)
  if (match === null) return undefined
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : undefined
}

function storedSessionId(logPath: string): string | undefined {
  const descriptor = openSync(logPath, 'r')
  try {
    const buffer = Buffer.alloc(8192)
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0)
    const lineEnd = buffer.subarray(0, bytes).indexOf(10)
    if (lineEnd < 0) return undefined
    const header = JSON.parse(buffer.subarray(0, lineEnd).toString('utf8')) as { type?: unknown; id?: unknown }
    return header.type === 'session' && typeof header.id === 'string' ? header.id : undefined
  } catch {
    return undefined
  } finally {
    closeSync(descriptor)
  }
}

function isDescendant(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path)
}

function trajectoryKey(conversationId: string, runtimeThreadId: string): string {
  return `${conversationId}\u0000${runtimeThreadId}`
}

function clearConversationEntries<T>(entries: Map<string, T>, conversationId: string): void {
  const prefix = `${conversationId}\u0000`
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function turnEndFailureMessage(event: unknown): string | undefined {
  const data = isRecord(event) ? isRecord(event.data) ? event.data : undefined : undefined
  const reason = isRecord(data?.reason) ? data.reason : undefined
  if (reason?.kind !== 'error') return undefined
  const failure = isRecord(reason.error) ? reason.error : undefined
  if (typeof failure?.message === 'string' && failure.message.trim()) return failure.message
  return JSON.stringify(failure ?? reason)
}

function parsedObject(raw: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw || '{}')
  } catch (error) {
    throw new Error(`${label}不是合法 JSON。`, { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON object。`)
  return value as Record<string, unknown>
}

function writeVariableBridge(path: string, context?: DshVariableRuntimeContext): void {
  const value = context === undefined
    ? { enabled: false, config: null, state: {} }
    : {
        enabled: true,
        config: {
          initialState: parsedObject(context.initialStateJson, '变量初始状态'),
          schemaCode: context.schemaCode,
          objects: context.objects,
          variables: context.variables
        },
        state: parsedObject(context.stateJson, '当前变量状态')
      }
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

function readVariableBridgeState(path: string): string {
  const bridge = parsedObject(readFileSync(path, 'utf8'), '变量运行时桥接文件')
  const state = bridge.state
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('变量运行时返回的状态必须是 JSON object。')
  return JSON.stringify(state, null, 2)
}

function writeContextBridge(path: string, currentUserInput: string, context?: DshConversationContext): void {
  writeFileSync(path, JSON.stringify({
    ...(context ?? { characterId: '', characterName: '', persona: {}, history: [] }),
    currentUserInput
  }, null, 2), 'utf8')
}

function writeSettingBridge(
  path: string,
  currentUserInput: string,
  context?: DshConversationContext,
  variableContext?: DshVariableRuntimeContext
): void {
  writeFileSync(path, JSON.stringify({
    enabled: context?.settingLibrary !== undefined,
    library: context?.settingLibrary ?? null,
    frozenLibrary: context?.settingLibrary ?? null,
    history: [...(context?.history ?? []), { role: 'user', content: currentUserInput }],
    variableState: variableContext === undefined
      ? {}
      : parsedObject(variableContext.stateJson, '当前变量状态')
  }, null, 2), 'utf8')
}

function readSettingBridgeState(path: string): string {
  const bridge = parsedObject(readFileSync(path, 'utf8'), '设定库运行时桥接文件')
  return JSON.stringify(bridge.library ?? {}, null, 2)
}

function discardConversationBridges(sessionRoot: string): void {
  for (const name of ['eleckoi-conversation-context.json', 'eleckoi-setting-library-state.json']) {
    try { rmSync(join(sessionRoot, name), { force: true }) }
    catch (error) { console.warn(`临时会话桥接文件清理失败：${name}`, error) }
  }
}

function discardAbandonedConversationBridges(sessionsRoot: string): void {
  for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sessionRoot = join(sessionsRoot, entry.name)
    discardConversationBridges(sessionRoot)
    try { rmSync(join(sessionRoot, 'eleckoi-request-context'), { recursive: true, force: true }) }
    catch (error) { console.warn('旧请求上下文缓存清理失败。', error) }
  }
}

function discardEmbeddedConversationSnapshots(snapshotRoot: string): void {
  for (const entry of readdirSync(snapshotRoot, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    const path = join(snapshotRoot, entry.name)
    const snapshot = readSnapshotRecord(path)
    if (!snapshot || !Object.hasOwn(snapshot, 'conversationContext')) continue
    const { conversationContext: _discarded, ...metadata } = snapshot
    try { writeAtomically(path, JSON.stringify(metadata, null, 2)) }
    catch (error) { console.warn('旧会话快照正文清理失败。', error) }
  }
}
