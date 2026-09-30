import type { Context } from '@deepseek-ai/cordis'
import type { Logger } from 'pino'
import type { DesktopGateway } from '@main/gateway/DesktopGateway'
import type { AgentSessionCoordinator } from '@main/modules/agent'
import type { ConversationRepository, MessageDisplayCompatibility, MessageRepository } from '@main/modules/conversations'
import type { ModelRepository } from '@main/modules/models'
import type { CharacterRepository, PersonaRepository } from '@main/modules/personas'
import type { UserSettingsStore } from '@main/modules/settings'
import type { SettingLibraryRepository } from '@main/modules/settingLibraries'
import type { VariableConfigRepository, VariableStateRepository } from '@main/modules/variables'
import type { RegexRuleRepository } from '@main/modules/regexRules'
import type { ElectronWindowHost } from '@main/platform/electron/ElectronWindowHost'
import type { AppPaths } from '@main/platform/filesystem/AppPaths'
import type { SqliteDatabase } from '@main/platform/sqlite/SqliteDatabase'
import type { CredentialCipher } from '@main/platform/electron/CredentialCipher'
import type { ElectronDirectoryPicker } from '@main/platform/electron/ElectronDirectoryPicker'
import type { ElectronFileOpener } from '@main/platform/electron/ElectronFileOpener'
import type { AgentFileDrafts } from '@main/modules/agent/AgentFileDrafts'
import type { ConversationFiles } from '@main/platform/filesystem/ConversationFiles'
import type { LocalMediaStore } from '@main/platform/filesystem/LocalMediaStore'
import type { AuthorSdkService } from '@main/modules/authorSdk'
import type { AgentPresetRepository } from '@main/modules/agentPresets'
import type { WebSearchSettingsRepository } from '@main/modules/agentTools'
import type { UpdateService } from '@main/modules/updates'
import type { CreatorProjectRepository } from '@main/modules/creatorStudio'

declare module '@deepseek-ai/cordis' {
  interface Context {
    appPaths: AppPaths
    appLog: Logger
    database: SqliteDatabase
    credentialCipher: CredentialCipher
    directoryPicker: ElectronDirectoryPicker
    fileOpener: ElectronFileOpener
    fileDrafts: AgentFileDrafts
    conversationFiles: ConversationFiles
    mediaAssets: LocalMediaStore
    desktopGateway: DesktopGateway
    messageDisplayCompatibility: MessageDisplayCompatibility
    conversations: ConversationRepository
    messages: MessageRepository
    characters: CharacterRepository
    personas: PersonaRepository
    settingLibraries: SettingLibraryRepository
    variables: VariableConfigRepository
    variableStates: VariableStateRepository
    regexRules: RegexRuleRepository
    models: ModelRepository
    userSettings: UserSettingsStore
    agentSessions: AgentSessionCoordinator
    pluginHost: {
      start(): Promise<{ url: string; injections: readonly unknown[] }>
      frontendDirectory(): string
      onFailure(listener: (error: Error) => void): () => void
    }
    authorSdk: AuthorSdkService
    agentPresets: AgentPresetRepository
    webSearchSettings: WebSearchSettingsRepository
    electronWindows: ElectronWindowHost
    updates: UpdateService
    creatorProjects: CreatorProjectRepository
  }
}

export type DesktopContext = Context
