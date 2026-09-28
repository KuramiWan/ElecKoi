import { DshDesktopPluginHost, DshRuntime, describeDshModelCapabilities, exportDshSession, importDshSessions, readDshTranscript, resolveDshWebFrontendDirectory, type DshSessionArchive } from '@eleckoi/dsh-runtime'
import { app } from 'electron'
import { dirname, join } from 'node:path'
import type { AppPaths } from '@main/platform/filesystem/AppPaths'
import type { ModelRepository } from '@main/modules/models'
import type { WebSearchSettingsRepository } from '@main/modules/agentTools'
import type {
  AgentRunCallbacks,
  AgentRunInput,
  AgentRunResult,
  AgentRuntimePort
} from '@shared/contracts/agent/runtime'
import type { ChatImageMediaType, ChatUserImageAttachment, EncodedChatImageAttachment } from '@shared/contracts/entities/chat'

export class DshAgentRuntime implements AgentRuntimePort {
  private readonly runtime: DshRuntime
  private readonly pluginHost: DshDesktopPluginHost
  private readonly sessionLogRoot: string
  private readonly workspaceRoot: string

  constructor(
    paths: AppPaths,
    models: Pick<ModelRepository, 'runtimeCatalog'>,
    webSearch: Pick<WebSearchSettingsRepository, 'runtimeSettings'>,
    onPluginHostFailure?: (error: Error) => void
  ) {
    this.sessionLogRoot = join(paths.dshRuntime, 'sessions')
    this.workspaceRoot = paths.workspace
    this.runtime = new DshRuntime({
      configPath: paths.resolveResource('dsh', 'cordis.yml'),
      workspaceRoot: paths.workspace,
      runtimeDataRoot: paths.dshRuntime,
      executablePath: process.execPath,
      presetTemplatePath: paths.resolveResource('dsh', 'agent-preset-template', 'agent.cordis.yml'),
      modelCatalog: () => models.runtimeCatalog(),
      webSearchSettings: () => webSearch.runtimeSettings()
    })
    const packageManager = app.isPackaged
      ? {
          entryPath: join(process.resourcesPath, 'dsh', 'pnpm', 'bin', 'pnpm.mjs'),
          nodeBinPath: join(process.resourcesPath, 'dsh', 'node-bin')
        }
      : {
          entryPath: join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'),
          nodeBinPath: paths.resolveResource('dsh', 'node-bin')
        }
    this.pluginHost = new DshDesktopPluginHost({
      runtimeDataRoot: paths.dshRuntime,
      workspaceRoot: paths.workspace,
      agentPatchPath: paths.resolveResource('dsh', 'desktop-agent.patch.yml'),
      hostConfiguration: () => this.runtime.hostConfiguration(),
      executablePath: process.execPath,
      packageManager,
      ...(onPluginHostFailure === undefined ? {} : { onFailure: onPluginHostFailure })
    })
    this.runtime.bindSessionHost(this.pluginHost)
  }

  startPluginHost() {
    return this.pluginHost.start()
  }

  dshWebFrontendDirectory(): string {
    return resolveDshWebFrontendDirectory()
  }

  transcript(runtimeThreadId: string) {
    return readDshTranscript(this.sessionLogRoot, runtimeThreadId)
  }

  exportSession(runtimeThreadId: string): DshSessionArchive | null {
    return exportDshSession(this.sessionLogRoot, runtimeThreadId)
  }

  importSessions(archives: readonly DshSessionArchive[], ids: ReadonlyMap<string, string>): Promise<void> {
    return importDshSessions(this.sessionLogRoot, this.workspaceRoot, archives, ids)
  }

  run(input: AgentRunInput, callbacks: AgentRunCallbacks): Promise<AgentRunResult> {
    return this.runtime.stream(
      input.conversationId,
      input.text,
      input.settings,
      callbacks,
      input.variableContext,
      input.conversationContext,
      input.runtimeThreadId,
      input.toolPolicy,
      input.discardRuntimeThreadIds,
      input.inputImages,
      input.agentPreset,
      input.webSearch,
      input.subagentSettings,
      input.generationStatsSeed,
      input.inputFiles
    )
  }

  describeModelCapabilities(input: {
    provider: import('@shared/contracts/entities/model').ModelProviderId
    baseUrl: string
    model: string
    apiFormat: 'chat_completions' | 'responses' | 'anthropic_messages' | 'google_gemini'
    reasoningEfforts?: import('@shared/contracts/entities/model').ModelReasoningEfforts | false | undefined
  }) {
    return describeDshModelCapabilities({
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiFormat: runtimeApiFormat(input.apiFormat),
      reasoningEfforts: input.reasoningEfforts
    })
  }

  prepareImages(images: EncodedChatImageAttachment[]): Promise<ChatUserImageAttachment[]> {
    return this.runtime.prepareImages(images)
  }

  readImage(image: ChatUserImageAttachment): Promise<{ mediaType: ChatImageMediaType; data: string }> {
    return this.runtime.readImage(image)
  }

  removeImage(attachmentId: string): void {
    this.runtime.removeImage(attachmentId)
  }

  removeFile(reference: import('@shared/contracts/entities/chat').ChatUserFileAttachment, retainObject: boolean): void {
    this.runtime.removeFile(reference, retainObject)
  }

  filePath(reference: import('@shared/contracts/entities/chat').ChatUserFileAttachment): string {
    return this.runtime.filePath(reference)
  }

  generationStats(conversationId: string, runtimeThreadId: string) {
    return this.runtime.generationStats(conversationId, runtimeThreadId)
  }

  trajectory(
    conversationId: string,
    runtimeThreadId: string,
    options?: { beforeIndex?: number | undefined; limit?: number | undefined }
  ) {
    return { conversationId, ...this.runtime.trajectory(conversationId, runtimeThreadId, options) }
  }

  cancel(conversationId: string): Promise<boolean> {
    return this.runtime.stop(conversationId)
  }

  rewindConversation(conversationId: string, runtimeThreadId: string, fromTurn: number): Promise<'rewound' | 'unavailable'> {
    return this.runtime.rewindConversation(conversationId, runtimeThreadId, fromTurn)
  }

  confirmRewind(conversationId: string): void {
    this.runtime.confirmRewind(conversationId)
  }

  rollbackRewind(conversationId: string, runtimeThreadId: string): Promise<void> {
    return this.runtime.rollbackRewind(conversationId, runtimeThreadId)
  }

  disposeConversation(
    conversationId: string,
    runtimeThreadIds?: readonly string[],
    retainedRuntimeThreadIds?: readonly string[]
  ): Promise<void> {
    return this.runtime.disposeConversation(conversationId, runtimeThreadIds, retainedRuntimeThreadIds)
  }

  async close(): Promise<void> {
    await this.runtime.close()
  }
}

function runtimeApiFormat(value: 'chat_completions' | 'responses' | 'anthropic_messages' | 'google_gemini') {
  switch (value) {
    case 'chat_completions': return 'openai-completions' as const
    case 'responses': return 'openai-responses' as const
    case 'anthropic_messages': return 'anthropic-messages' as const
    case 'google_gemini': return 'google-generative-ai' as const
  }
}
