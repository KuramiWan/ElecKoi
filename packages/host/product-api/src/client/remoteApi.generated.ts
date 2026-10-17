/** 由 pnpm generate:plugin-docs 生成。Remote 调用声明直接使用官方 Host-for-Client 生成结果。 */
export const REMOTE_API = [
  {
    "namespace": "eleckoiAgentPresets",
    "hostService": "eleckoiAgentPresetsApi",
    "methods": [
      {
        "name": "assignGroup"
      },
      {
        "name": "catalog"
      },
      {
        "name": "create"
      },
      {
        "name": "createGroup"
      },
      {
        "name": "delete"
      },
      {
        "name": "deleteGroup"
      },
      {
        "name": "export"
      },
      {
        "name": "import"
      },
      {
        "name": "read"
      },
      {
        "name": "renameGroup"
      },
      {
        "name": "save"
      },
      {
        "name": "setActive"
      },
      {
        "name": "updateEntries"
      }
    ]
  },
  {
    "namespace": "eleckoiAuthorFrontends",
    "hostService": "eleckoiAuthorFrontendsApi",
    "methods": [
      {
        "name": "changes",
        "mode": "stream"
      },
      {
        "name": "delete"
      },
      {
        "name": "exportProject"
      },
      {
        "name": "importProject"
      },
      {
        "name": "readFile"
      },
      {
        "name": "replaceFiles"
      },
      {
        "name": "restoreDefault"
      },
      {
        "name": "select"
      },
      {
        "name": "setMessageRenderer"
      },
      {
        "name": "updateProject"
      },
      {
        "name": "workspace"
      },
      {
        "name": "writeFile"
      }
    ]
  },
  {
    "namespace": "eleckoiAuthorScripts",
    "hostService": "eleckoiAuthorScriptsApi",
    "methods": [
      {
        "name": "connect",
        "mode": "stream"
      },
      {
        "name": "getSettings"
      },
      {
        "name": "read"
      },
      {
        "name": "setSettings"
      }
    ]
  },
  {
    "namespace": "eleckoiAuthorVariables",
    "hostService": "eleckoiAuthorVariablesApi",
    "methods": [
      {
        "name": "applyPatch"
      },
      {
        "name": "getConfig"
      },
      {
        "name": "getState"
      },
      {
        "name": "merge"
      },
      {
        "name": "reset"
      },
      {
        "name": "setState"
      }
    ]
  },
  {
    "namespace": "eleckoiCharacterConfiguration",
    "hostService": "eleckoiCharacterConfigurationApi",
    "methods": [
      {
        "name": "changes",
        "mode": "stream"
      },
      {
        "name": "displayTemplatesForCharacter"
      },
      {
        "name": "exportRegexEditor"
      },
      {
        "name": "exportRegexRules"
      },
      {
        "name": "importRegexEditor"
      },
      {
        "name": "importRegexRules"
      },
      {
        "name": "readConversationSettingLibraries"
      },
      {
        "name": "readDisplayTemplates"
      },
      {
        "name": "readEditorLibraryVersions"
      },
      {
        "name": "readRegexEditor"
      },
      {
        "name": "readRegexRules"
      },
      {
        "name": "readScriptLibrary"
      },
      {
        "name": "readScriptWorkspace"
      },
      {
        "name": "readSettingLibrary"
      },
      {
        "name": "readVariableConfig"
      },
      {
        "name": "replaceSettingLibraryContent"
      },
      {
        "name": "resetConversationSettingLibrary"
      },
      {
        "name": "saveConversationSettingLibrary"
      },
      {
        "name": "saveConversationSettingLibraryVersion"
      },
      {
        "name": "saveDisplayTemplateLibraries"
      },
      {
        "name": "saveDisplayTemplates"
      },
      {
        "name": "saveEditorLibraries"
      },
      {
        "name": "saveRegexEditor"
      },
      {
        "name": "saveRegexRules"
      },
      {
        "name": "saveScriptLibraries"
      },
      {
        "name": "saveScriptLibrary"
      },
      {
        "name": "saveSettingLibrary"
      },
      {
        "name": "saveSettingLibraryViewState"
      },
      {
        "name": "saveVariableConfig"
      },
      {
        "name": "saveVariableConfigViewState"
      },
      {
        "name": "testRegexRule"
      },
      {
        "name": "updateSettingLibraryEntries"
      }
    ]
  },
  {
    "namespace": "eleckoiCharacters",
    "hostService": "eleckoiCharactersApi",
    "methods": [
      {
        "name": "changes",
        "mode": "stream"
      },
      {
        "name": "commitImport"
      },
      {
        "name": "create"
      },
      {
        "name": "delete"
      },
      {
        "name": "discardImport"
      },
      {
        "name": "export"
      },
      {
        "name": "list"
      },
      {
        "name": "prepareImport"
      },
      {
        "name": "saveGroups"
      },
      {
        "name": "select"
      },
      {
        "name": "update"
      }
    ]
  },
  {
    "namespace": "eleckoiConversationModels",
    "hostService": "eleckoiConversationModelsApi",
    "methods": [
      {
        "name": "current"
      },
      {
        "name": "select"
      }
    ]
  },
  {
    "namespace": "eleckoiConversations",
    "hostService": "eleckoiConversationsApi",
    "methods": [
      {
        "name": "authorState"
      },
      {
        "name": "changes",
        "mode": "stream"
      },
      {
        "name": "create"
      },
      {
        "name": "delete"
      },
      {
        "name": "deleteMessagesFrom"
      },
      {
        "name": "details"
      },
      {
        "name": "editMessage"
      },
      {
        "name": "exportArchive"
      },
      {
        "name": "fork"
      },
      {
        "name": "importArchive"
      },
      {
        "name": "list"
      },
      {
        "name": "preparePrompt"
      },
      {
        "name": "projectDisplay"
      },
      {
        "name": "readGeneratedImage"
      },
      {
        "name": "regenerateImage"
      },
      {
        "name": "regenerateMessage"
      },
      {
        "name": "rename"
      },
      {
        "name": "replaceVariableState"
      },
      {
        "name": "requestPreview"
      },
      {
        "name": "requestPreviews",
        "mode": "stream"
      },
      {
        "name": "revealFile"
      },
      {
        "name": "selectOpening"
      },
      {
        "name": "startRegeneration"
      },
      {
        "name": "updateOpening"
      },
      {
        "name": "variableTimeline"
      },
      {
        "name": "waitForGeneration"
      }
    ]
  },
  {
    "namespace": "eleckoiCreatorStudio",
    "hostService": "eleckoiCreatorStudioApi",
    "methods": [
      {
        "name": "changes",
        "mode": "stream"
      },
      {
        "name": "create"
      },
      {
        "name": "delete"
      },
      {
        "name": "list"
      }
    ]
  },
  {
    "namespace": "eleckoiCreatorStudioSessions",
    "hostService": "eleckoiCreatorStudioSessionsApi",
    "methods": [
      {
        "name": "create"
      },
      {
        "name": "delete"
      },
      {
        "name": "deleteMessagesFrom"
      },
      {
        "name": "list"
      },
      {
        "name": "messages"
      },
      {
        "name": "open"
      },
      {
        "name": "pin"
      },
      {
        "name": "regenerate"
      },
      {
        "name": "rename"
      },
      {
        "name": "selectCharacter"
      }
    ]
  },
  {
    "namespace": "eleckoiDisplayPreferences",
    "hostService": "eleckoiDisplayPreferencesApi",
    "methods": [
      {
        "name": "read"
      },
      {
        "name": "setChatDisplay"
      },
      {
        "name": "updateUi"
      }
    ]
  },
  {
    "namespace": "eleckoiModels",
    "hostService": "eleckoiModelsApi",
    "methods": [
      {
        "name": "discoverModels"
      },
      {
        "name": "revealApiKey"
      }
    ]
  },
  {
    "namespace": "eleckoiPersona",
    "hostService": "eleckoiPersonaApi",
    "methods": [
      {
        "name": "changes",
        "mode": "stream"
      },
      {
        "name": "read"
      },
      {
        "name": "save"
      }
    ]
  },
  {
    "namespace": "eleckoiSystem",
    "hostService": "eleckoiSystemApi",
    "methods": [
      {
        "name": "status"
      }
    ]
  },
  {
    "namespace": "eleckoiWebSearch",
    "hostService": "eleckoiWebSearchApi",
    "methods": [
      {
        "name": "fetchSelection"
      },
      {
        "name": "select"
      },
      {
        "name": "selectFetch"
      },
      {
        "name": "selection"
      },
      {
        "name": "testDeepSeek"
      },
      {
        "name": "testTavily"
      }
    ]
  }
] as const
export const REMOTE_DECLARATION = "/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */\nimport type {\n  RemoteResult,\n  RemoteStreamHandle,\n  TypertRemoteContribution,\n} from '@deepseek-ai/dsh-typert-protocol'\nimport type { FrontendExport, FrontendFile, FrontendFileInput, FrontendFileQuery, FrontendImport, FrontendJson, FrontendOwner, FrontendReplaceFiles, FrontendWorkspace, NativeFrontendChange } from '@eleckoi/dsh-product-api/frontends'\nimport type { AgentPreset, AgentPresetCatalog, AgentPresetExportFormat, AgentPresetExportResult, AgentPresetImportDocument, AgentPresetImportResult, AgentPresetImportSource, AgentPresetPurpose, AuthorConversationState, CharacterCollection, CharacterConfigurationChange, CharacterExportFormat, CharacterExportResult, CharacterGroupAssignment, CharacterImportFile, CharacterImportPreview, CharacterImportResult, CharacterImportSource, CharacterRecord, ConversationChange, ConversationCreateInput, ConversationDetailsMetadata, ConversationMessageDisplayInput, ConversationMessageDisplayResult, ConversationModelSelection, ConversationRequestPreview, ConversationRequestPreviewSummary, ConversationSummary, CreateCreatorProjectInput, CreatorProjectCollection, CreatorStudioMessage, CreatorStudioSession, CreatorStudioSessionSummary, DeepSeekWebConnection, DisplayPreferencesSnapshot, DisplayPreferenceValue, DisplayTemplateLibrary, DisplayTemplateScope, DisplayTemplateSelection, EditorLibraryAddress, EditorLibrarySaveRequest, EditorLibrarySaveResult, EditorLibraryVersions, ElecKoiHostStatus, ModelDiscoveryInput, ModelDiscoveryResult, NativeAuthorRuleReply, NativeAuthorRuleTask, NativeAuthorScriptCatalog, NativeAuthorScriptIdentity, NativeAuthorScriptSettings, PersonaProfile, ProductRecordChange, RegexEditorTarget, RegexRule, RegexRuleCollection, RegexRuleEditorCollection, RegexRuleEditorImportResult, RegexRuleImportDocument, RegexRuleImportResult, RegexRuleScope, RegexRuleTarget, RegexRuleTestResult, ScriptLibrary, ScriptLibraryScope, ScriptWorkspace, SettingLibrary, SettingLibraryContent, SettingLibraryConversation, SettingLibraryEntry, SettingLibraryEntryUpdate, TavilyConnection, VariableConfig, VariableViewerTimeline, WebFetchMode, WebSearchMode } from '@eleckoi/dsh-product-api/types'\n\ndeclare module '@deepseek-ai/dsh-typert-protocol' {\n  interface TypertRemoteNamespace$656c65636b6f694167656e7450726573657473 {\n    assignGroup: (presetId: string, groupId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    catalog: () => Promise<RemoteResult<AgentPresetCatalog>>\n    create: (name: string, libraryGroupId: string, purpose: AgentPresetPurpose) => Promise<RemoteResult<AgentPreset>>\n    createGroup: (name: string, purpose: AgentPresetPurpose) => Promise<RemoteResult<AgentPresetCatalog>>\n    delete: (presetId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    deleteGroup: (groupId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    export: (presetId: string, format: AgentPresetExportFormat) => Promise<RemoteResult<AgentPresetExportResult>>\n    import: (source: AgentPresetImportSource, document: AgentPresetImportDocument, purpose: AgentPresetPurpose) => Promise<RemoteResult<AgentPresetImportResult>>\n    read: (presetId: string) => Promise<RemoteResult<AgentPreset>>\n    renameGroup: (groupId: string, name: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    save: (preset: AgentPreset, expectedRegexRules: RegexRule[]) => Promise<RemoteResult<AgentPreset>>\n    setActive: (presetId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    updateEntries: (presetId: string, updates: SettingLibraryEntryUpdate[], signal?: AbortSignal) => Promise<RemoteResult<SettingLibraryEntry[]>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69417574686f7246726f6e74656e6473 {\n    changes: (owner: FrontendOwner, signal?: AbortSignal) => RemoteStreamHandle<NativeFrontendChange, never>\n    delete: (owner: FrontendOwner, projectId: string) => Promise<RemoteResult<FrontendWorkspace>>\n    exportProject: (owner: FrontendOwner, projectId: string) => Promise<RemoteResult<FrontendExport>>\n    importProject: (owner: FrontendOwner, input: FrontendImport) => Promise<RemoteResult<FrontendWorkspace>>\n    readFile: (owner: FrontendOwner, projectId: string, input: FrontendFileQuery) => Promise<RemoteResult<FrontendFile>>\n    replaceFiles: (owner: FrontendOwner, projectId: string, input: FrontendReplaceFiles) => Promise<RemoteResult<FrontendWorkspace>>\n    restoreDefault: (owner: FrontendOwner) => Promise<RemoteResult<FrontendWorkspace>>\n    select: (owner: FrontendOwner, projectId: string | null) => Promise<RemoteResult<FrontendWorkspace>>\n    setMessageRenderer: (owner: FrontendOwner, enabled: boolean) => Promise<RemoteResult<FrontendWorkspace>>\n    updateProject: (owner: FrontendOwner, projectId: string, patch: FrontendJson) => Promise<RemoteResult<FrontendWorkspace>>\n    workspace: (owner: FrontendOwner) => Promise<RemoteResult<FrontendWorkspace>>\n    writeFile: (owner: FrontendOwner, projectId: string, file: FrontendFileInput) => Promise<RemoteResult<FrontendWorkspace>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69417574686f7253637269707473 {\n    connect: (conversationId: string, version: string, signal?: AbortSignal) => RemoteStreamHandle<NativeAuthorRuleTask, NativeAuthorRuleReply>\n    getSettings: (conversationId: string, version: string, identity: NativeAuthorScriptIdentity, target: 'script' | 'library', signal?: AbortSignal) => Promise<RemoteResult<NativeAuthorScriptSettings>>\n    read: (conversationId: string) => Promise<RemoteResult<NativeAuthorScriptCatalog>>\n    setSettings: (conversationId: string, version: string, identity: NativeAuthorScriptIdentity, target: 'script' | 'library', settingsJson: string, expectedRevision: number, signal?: AbortSignal) => Promise<RemoteResult<NativeAuthorScriptSettings>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69417574686f725661726961626c6573 {\n    applyPatch: (conversationId: string, patchJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    getConfig: (conversationId: string) => Promise<RemoteResult<VariableConfig | null>>\n    getState: (conversationId: string) => Promise<RemoteResult<string>>\n    merge: (conversationId: string, stateJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    reset: (conversationId: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    setState: (conversationId: string, stateJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69436861726163746572436f6e66696775726174696f6e {\n    changes: (signal?: AbortSignal) => RemoteStreamHandle<CharacterConfigurationChange, never>\n    displayTemplatesForCharacter: (characterId: string) => Promise<RemoteResult<DisplayTemplateSelection>>\n    exportRegexEditor: (target: RegexEditorTarget, ruleIds: string[]) => Promise<RemoteResult<{ fileName: string; json: string; }>>\n    exportRegexRules: (characterId: string, ruleIds: string[]) => Promise<RemoteResult<{ fileName: string; json: string; }>>\n    importRegexEditor: (collection: RegexRuleEditorCollection, fallbackScope: RegexRuleScope, documents: RegexRuleImportDocument[]) => Promise<RemoteResult<RegexRuleEditorImportResult>>\n    importRegexRules: (characterId: string, fallbackScope: RegexRuleScope, documents: RegexRuleImportDocument[], expectedRevision: number) => Promise<RemoteResult<RegexRuleImportResult>>\n    readConversationSettingLibraries: (characterId: string) => Promise<RemoteResult<SettingLibraryConversation[]>>\n    readDisplayTemplates: (scope: DisplayTemplateScope, ownerId: string) => Promise<RemoteResult<DisplayTemplateLibrary>>\n    readEditorLibraryVersions: (address: EditorLibraryAddress) => Promise<RemoteResult<EditorLibraryVersions>>\n    readRegexEditor: (target: RegexEditorTarget) => Promise<RemoteResult<RegexRuleEditorCollection>>\n    readRegexRules: (characterId: string) => Promise<RemoteResult<RegexRuleCollection>>\n    readScriptLibrary: (scope: ScriptLibraryScope, ownerId: string) => Promise<RemoteResult<ScriptLibrary>>\n    readScriptWorkspace: (scope: ScriptLibraryScope, ownerId: string) => Promise<RemoteResult<ScriptWorkspace>>\n    readSettingLibrary: (characterId: string) => Promise<RemoteResult<SettingLibrary>>\n    readVariableConfig: (characterId: string) => Promise<RemoteResult<VariableConfig>>\n    replaceSettingLibraryContent: (characterId: string, library: SettingLibraryContent, signal?: AbortSignal) => Promise<RemoteResult<SettingLibrary>>\n    resetConversationSettingLibrary: (characterId: string, conversationId: string) => Promise<RemoteResult<void>>\n    saveConversationSettingLibrary: (characterId: string, conversationId: string, library: SettingLibrary) => Promise<RemoteResult<SettingLibrary>>\n    saveConversationSettingLibraryVersion: (characterId: string, conversationId: string, name: string) => Promise<RemoteResult<SettingLibrary>>\n    saveDisplayTemplateLibraries: (libraries: DisplayTemplateLibrary[]) => Promise<RemoteResult<DisplayTemplateLibrary[]>>\n    saveDisplayTemplates: (library: DisplayTemplateLibrary) => Promise<RemoteResult<DisplayTemplateLibrary>>\n    saveEditorLibraries: (request: EditorLibrarySaveRequest) => Promise<RemoteResult<EditorLibrarySaveResult>>\n    saveRegexEditor: (collection: RegexRuleEditorCollection) => Promise<RemoteResult<RegexRuleEditorCollection>>\n    saveRegexRules: (characterId: string, collection: RegexRuleCollection, expectedRevision: number) => Promise<RemoteResult<RegexRuleCollection>>\n    saveScriptLibraries: (libraries: ScriptLibrary[]) => Promise<RemoteResult<ScriptLibrary[]>>\n    saveScriptLibrary: (library: ScriptLibrary) => Promise<RemoteResult<ScriptLibrary>>\n    saveSettingLibrary: (characterId: string, library: SettingLibrary) => Promise<RemoteResult<SettingLibrary>>\n    saveSettingLibraryViewState: (characterId: string, expandedGroupIds: string[]) => Promise<RemoteResult<string[]>>\n    saveVariableConfig: (characterId: string, config: VariableConfig) => Promise<RemoteResult<VariableConfig>>\n    saveVariableConfigViewState: (characterId: string, expandedObjectIds: string[]) => Promise<RemoteResult<string[]>>\n    testRegexRule: (text: string, rule: RegexRule, target: RegexRuleTarget) => Promise<RemoteResult<RegexRuleTestResult>>\n    updateSettingLibraryEntries: (characterId: string, updates: SettingLibraryEntryUpdate[], signal?: AbortSignal) => Promise<RemoteResult<SettingLibraryEntry[]>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f6943686172616374657273 {\n    changes: (signal?: AbortSignal) => RemoteStreamHandle<ProductRecordChange, never>\n    commitImport: (token: string) => Promise<RemoteResult<CharacterImportResult>>\n    create: (character: CharacterRecord) => Promise<RemoteResult<CharacterCollection>>\n    delete: (characterIds: string[]) => Promise<RemoteResult<CharacterCollection>>\n    discardImport: (token: string) => Promise<RemoteResult<void>>\n    export: (characterId: string, format: CharacterExportFormat) => Promise<RemoteResult<CharacterExportResult>>\n    list: () => Promise<RemoteResult<CharacterCollection>>\n    prepareImport: (files: CharacterImportFile[], source: CharacterImportSource) => Promise<RemoteResult<CharacterImportPreview>>\n    saveGroups: (groups: string[], assignments: CharacterGroupAssignment[]) => Promise<RemoteResult<CharacterCollection>>\n    select: (characterId: string) => Promise<RemoteResult<CharacterCollection>>\n    update: (character: CharacterRecord) => Promise<RemoteResult<CharacterCollection>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69436f6e766572736174696f6e4d6f64656c73 {\n    current: (conversationId: string) => Promise<RemoteResult<ConversationModelSelection>>\n    select: (conversationId: string, selection: ConversationModelSelection) => Promise<RemoteResult<ConversationModelSelection>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69436f6e766572736174696f6e73 {\n    authorState: (conversationId: string) => Promise<RemoteResult<AuthorConversationState>>\n    changes: (signal?: AbortSignal) => RemoteStreamHandle<ConversationChange, never>\n    create: (input: ConversationCreateInput) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    delete: (conversationId: string) => Promise<RemoteResult<void>>\n    deleteMessagesFrom: (conversationId: string, eventSeq: number, role: 'user' | 'assistant') => Promise<RemoteResult<{ details: ConversationDetailsMetadata; deletedMessageCount: number; remainingMessageCount: number; }>>\n    details: (conversationId: string, beforeSequence?: number, limit?: number) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    editMessage: (conversationId: string, eventSeq: number, role: 'user' | 'assistant', content: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    exportArchive: (conversationId: string) => Promise<RemoteResult<string>>\n    fork: (conversationId: string, atSeq: number | undefined, retainedTurnIds: string[], title: string) => Promise<RemoteResult<string>>\n    importArchive: (characterId: string, json: string) => Promise<RemoteResult<string>>\n    list: (signal?: AbortSignal) => Promise<RemoteResult<ConversationSummary[]>>\n    preparePrompt: (conversationId: string, text: string, signal?: AbortSignal) => Promise<RemoteResult<{ runtimeSessionId: string; operationId: string; }>>\n    projectDisplay: (conversationId: string, messages: ConversationMessageDisplayInput[]) => Promise<RemoteResult<ConversationMessageDisplayResult[]>>\n    readGeneratedImage: (conversationId: string, batchId: string, frameId: number, attachmentId: string, signal?: AbortSignal) => Promise<RemoteResult<{ mediaType: string; data: string; }>>\n    regenerateImage: (conversationId: string, batchId: string, frameId: number, signal?: AbortSignal) => Promise<RemoteResult<void>>\n    regenerateMessage: (conversationId: string, eventSeq: number, requestId: string, replacementMessage?: string) => Promise<RemoteResult<{ runtimeSessionId: string; prepared: true; operationId: string; }>>\n    rename: (conversationId: string, title: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    replaceVariableState: (conversationId: string, stateJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    requestPreview: (conversationId: string, requestId: string, signal?: AbortSignal) => Promise<RemoteResult<ConversationRequestPreview>>\n    requestPreviews: (conversationId: string, signal?: AbortSignal) => RemoteStreamHandle<ConversationRequestPreviewSummary[], never>\n    revealFile: (conversationId: string, attachmentId: string, name: string, signal?: AbortSignal) => Promise<RemoteResult<void>>\n    selectOpening: (conversationId: string, openingId: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    startRegeneration: (conversationId: string, requestId: string, cancelled: boolean) => Promise<RemoteResult<{ accepted: boolean; turn?: number; }>>\n    updateOpening: (conversationId: string, content: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    variableTimeline: (conversationId: string) => Promise<RemoteResult<VariableViewerTimeline>>\n    waitForGeneration: (conversationId: string, operationId: string) => Promise<RemoteResult<void>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f6943726561746f7253747564696f {\n    changes: (signal?: AbortSignal) => RemoteStreamHandle<ProductRecordChange, never>\n    create: (input: CreateCreatorProjectInput) => Promise<RemoteResult<CreatorProjectCollection>>\n    delete: (projectId: string) => Promise<RemoteResult<CreatorProjectCollection>>\n    list: () => Promise<RemoteResult<CreatorProjectCollection>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f6943726561746f7253747564696f53657373696f6e73 {\n    create: (characterId: string) => Promise<RemoteResult<CreatorStudioSession>>\n    delete: (sessionId: string) => Promise<RemoteResult<void>>\n    deleteMessagesFrom: (sessionId: string, eventSeq: number, role: 'user' | 'assistant') => Promise<RemoteResult<void>>\n    list: () => Promise<RemoteResult<CreatorStudioSessionSummary[]>>\n    messages: (sessionId: string) => Promise<RemoteResult<CreatorStudioMessage[]>>\n    open: (sessionId: string) => Promise<RemoteResult<CreatorStudioSession>>\n    pin: (sessionId: string, pinned: boolean) => Promise<RemoteResult<void>>\n    regenerate: (sessionId: string) => Promise<RemoteResult<void>>\n    rename: (sessionId: string, title: string) => Promise<RemoteResult<void>>\n    selectCharacter: (sessionId: string, characterId: string) => Promise<RemoteResult<CreatorStudioSession>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69446973706c6179507265666572656e636573 {\n    read: () => Promise<RemoteResult<DisplayPreferencesSnapshot>>\n    setChatDisplay: (chatDisplay: Record<string, DisplayPreferenceValue>, expectedRevision?: number) => Promise<RemoteResult<DisplayPreferencesSnapshot>>\n    updateUi: (ui: Record<string, DisplayPreferenceValue>, expectedRevision?: number) => Promise<RemoteResult<DisplayPreferencesSnapshot>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f694d6f64656c73 {\n    discoverModels: (input: ModelDiscoveryInput) => Promise<RemoteResult<ModelDiscoveryResult[]>>\n    revealApiKey: (configId: string) => Promise<RemoteResult<string>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69506572736f6e61 {\n    changes: (signal?: AbortSignal) => RemoteStreamHandle<ProductRecordChange, never>\n    read: () => Promise<RemoteResult<PersonaProfile>>\n    save: (profile: PersonaProfile) => Promise<RemoteResult<PersonaProfile>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f6953797374656d {\n    status: () => Promise<RemoteResult<ElecKoiHostStatus>>\n  }\n  interface TypertRemoteNamespace$656c65636b6f69576562536561726368 {\n    fetchSelection: () => Promise<RemoteResult<WebFetchMode>>\n    select: (mode: WebSearchMode) => Promise<RemoteResult<WebSearchMode>>\n    selectFetch: (mode: WebFetchMode) => Promise<RemoteResult<WebFetchMode>>\n    selection: () => Promise<RemoteResult<WebSearchMode>>\n    testDeepSeek: (apiKey?: string, signal?: AbortSignal) => Promise<RemoteResult<DeepSeekWebConnection>>\n    testTavily: (apiKey?: string, signal?: AbortSignal) => Promise<RemoteResult<TavilyConnection>>\n  }\n  interface TypertRemoteMap {\n    'eleckoiAgentPresets/assignGroup': (presetId: string, groupId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    'eleckoiAgentPresets/catalog': () => Promise<RemoteResult<AgentPresetCatalog>>\n    'eleckoiAgentPresets/create': (name: string, libraryGroupId: string, purpose: AgentPresetPurpose) => Promise<RemoteResult<AgentPreset>>\n    'eleckoiAgentPresets/createGroup': (name: string, purpose: AgentPresetPurpose) => Promise<RemoteResult<AgentPresetCatalog>>\n    'eleckoiAgentPresets/delete': (presetId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    'eleckoiAgentPresets/deleteGroup': (groupId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    'eleckoiAgentPresets/export': (presetId: string, format: AgentPresetExportFormat) => Promise<RemoteResult<AgentPresetExportResult>>\n    'eleckoiAgentPresets/import': (source: AgentPresetImportSource, document: AgentPresetImportDocument, purpose: AgentPresetPurpose) => Promise<RemoteResult<AgentPresetImportResult>>\n    'eleckoiAgentPresets/read': (presetId: string) => Promise<RemoteResult<AgentPreset>>\n    'eleckoiAgentPresets/renameGroup': (groupId: string, name: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    'eleckoiAgentPresets/save': (preset: AgentPreset, expectedRegexRules: RegexRule[]) => Promise<RemoteResult<AgentPreset>>\n    'eleckoiAgentPresets/setActive': (presetId: string) => Promise<RemoteResult<AgentPresetCatalog>>\n    'eleckoiAgentPresets/updateEntries': (presetId: string, updates: SettingLibraryEntryUpdate[], signal?: AbortSignal) => Promise<RemoteResult<SettingLibraryEntry[]>>\n    'eleckoiAuthorFrontends/changes': (owner: FrontendOwner, signal?: AbortSignal) => RemoteStreamHandle<NativeFrontendChange, never>\n    'eleckoiAuthorFrontends/delete': (owner: FrontendOwner, projectId: string) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/exportProject': (owner: FrontendOwner, projectId: string) => Promise<RemoteResult<FrontendExport>>\n    'eleckoiAuthorFrontends/importProject': (owner: FrontendOwner, input: FrontendImport) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/readFile': (owner: FrontendOwner, projectId: string, input: FrontendFileQuery) => Promise<RemoteResult<FrontendFile>>\n    'eleckoiAuthorFrontends/replaceFiles': (owner: FrontendOwner, projectId: string, input: FrontendReplaceFiles) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/restoreDefault': (owner: FrontendOwner) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/select': (owner: FrontendOwner, projectId: string | null) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/setMessageRenderer': (owner: FrontendOwner, enabled: boolean) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/updateProject': (owner: FrontendOwner, projectId: string, patch: FrontendJson) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/workspace': (owner: FrontendOwner) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorFrontends/writeFile': (owner: FrontendOwner, projectId: string, file: FrontendFileInput) => Promise<RemoteResult<FrontendWorkspace>>\n    'eleckoiAuthorScripts/connect': (conversationId: string, version: string, signal?: AbortSignal) => RemoteStreamHandle<NativeAuthorRuleTask, NativeAuthorRuleReply>\n    'eleckoiAuthorScripts/getSettings': (conversationId: string, version: string, identity: NativeAuthorScriptIdentity, target: 'script' | 'library', signal?: AbortSignal) => Promise<RemoteResult<NativeAuthorScriptSettings>>\n    'eleckoiAuthorScripts/read': (conversationId: string) => Promise<RemoteResult<NativeAuthorScriptCatalog>>\n    'eleckoiAuthorScripts/setSettings': (conversationId: string, version: string, identity: NativeAuthorScriptIdentity, target: 'script' | 'library', settingsJson: string, expectedRevision: number, signal?: AbortSignal) => Promise<RemoteResult<NativeAuthorScriptSettings>>\n    'eleckoiAuthorVariables/applyPatch': (conversationId: string, patchJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    'eleckoiAuthorVariables/getConfig': (conversationId: string) => Promise<RemoteResult<VariableConfig | null>>\n    'eleckoiAuthorVariables/getState': (conversationId: string) => Promise<RemoteResult<string>>\n    'eleckoiAuthorVariables/merge': (conversationId: string, stateJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    'eleckoiAuthorVariables/reset': (conversationId: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    'eleckoiAuthorVariables/setState': (conversationId: string, stateJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    'eleckoiCharacterConfiguration/changes': (signal?: AbortSignal) => RemoteStreamHandle<CharacterConfigurationChange, never>\n    'eleckoiCharacterConfiguration/displayTemplatesForCharacter': (characterId: string) => Promise<RemoteResult<DisplayTemplateSelection>>\n    'eleckoiCharacterConfiguration/exportRegexEditor': (target: RegexEditorTarget, ruleIds: string[]) => Promise<RemoteResult<{ fileName: string; json: string; }>>\n    'eleckoiCharacterConfiguration/exportRegexRules': (characterId: string, ruleIds: string[]) => Promise<RemoteResult<{ fileName: string; json: string; }>>\n    'eleckoiCharacterConfiguration/importRegexEditor': (collection: RegexRuleEditorCollection, fallbackScope: RegexRuleScope, documents: RegexRuleImportDocument[]) => Promise<RemoteResult<RegexRuleEditorImportResult>>\n    'eleckoiCharacterConfiguration/importRegexRules': (characterId: string, fallbackScope: RegexRuleScope, documents: RegexRuleImportDocument[], expectedRevision: number) => Promise<RemoteResult<RegexRuleImportResult>>\n    'eleckoiCharacterConfiguration/readConversationSettingLibraries': (characterId: string) => Promise<RemoteResult<SettingLibraryConversation[]>>\n    'eleckoiCharacterConfiguration/readDisplayTemplates': (scope: DisplayTemplateScope, ownerId: string) => Promise<RemoteResult<DisplayTemplateLibrary>>\n    'eleckoiCharacterConfiguration/readEditorLibraryVersions': (address: EditorLibraryAddress) => Promise<RemoteResult<EditorLibraryVersions>>\n    'eleckoiCharacterConfiguration/readRegexEditor': (target: RegexEditorTarget) => Promise<RemoteResult<RegexRuleEditorCollection>>\n    'eleckoiCharacterConfiguration/readRegexRules': (characterId: string) => Promise<RemoteResult<RegexRuleCollection>>\n    'eleckoiCharacterConfiguration/readScriptLibrary': (scope: ScriptLibraryScope, ownerId: string) => Promise<RemoteResult<ScriptLibrary>>\n    'eleckoiCharacterConfiguration/readScriptWorkspace': (scope: ScriptLibraryScope, ownerId: string) => Promise<RemoteResult<ScriptWorkspace>>\n    'eleckoiCharacterConfiguration/readSettingLibrary': (characterId: string) => Promise<RemoteResult<SettingLibrary>>\n    'eleckoiCharacterConfiguration/readVariableConfig': (characterId: string) => Promise<RemoteResult<VariableConfig>>\n    'eleckoiCharacterConfiguration/replaceSettingLibraryContent': (characterId: string, library: SettingLibraryContent, signal?: AbortSignal) => Promise<RemoteResult<SettingLibrary>>\n    'eleckoiCharacterConfiguration/resetConversationSettingLibrary': (characterId: string, conversationId: string) => Promise<RemoteResult<void>>\n    'eleckoiCharacterConfiguration/saveConversationSettingLibrary': (characterId: string, conversationId: string, library: SettingLibrary) => Promise<RemoteResult<SettingLibrary>>\n    'eleckoiCharacterConfiguration/saveConversationSettingLibraryVersion': (characterId: string, conversationId: string, name: string) => Promise<RemoteResult<SettingLibrary>>\n    'eleckoiCharacterConfiguration/saveDisplayTemplateLibraries': (libraries: DisplayTemplateLibrary[]) => Promise<RemoteResult<DisplayTemplateLibrary[]>>\n    'eleckoiCharacterConfiguration/saveDisplayTemplates': (library: DisplayTemplateLibrary) => Promise<RemoteResult<DisplayTemplateLibrary>>\n    'eleckoiCharacterConfiguration/saveEditorLibraries': (request: EditorLibrarySaveRequest) => Promise<RemoteResult<EditorLibrarySaveResult>>\n    'eleckoiCharacterConfiguration/saveRegexEditor': (collection: RegexRuleEditorCollection) => Promise<RemoteResult<RegexRuleEditorCollection>>\n    'eleckoiCharacterConfiguration/saveRegexRules': (characterId: string, collection: RegexRuleCollection, expectedRevision: number) => Promise<RemoteResult<RegexRuleCollection>>\n    'eleckoiCharacterConfiguration/saveScriptLibraries': (libraries: ScriptLibrary[]) => Promise<RemoteResult<ScriptLibrary[]>>\n    'eleckoiCharacterConfiguration/saveScriptLibrary': (library: ScriptLibrary) => Promise<RemoteResult<ScriptLibrary>>\n    'eleckoiCharacterConfiguration/saveSettingLibrary': (characterId: string, library: SettingLibrary) => Promise<RemoteResult<SettingLibrary>>\n    'eleckoiCharacterConfiguration/saveSettingLibraryViewState': (characterId: string, expandedGroupIds: string[]) => Promise<RemoteResult<string[]>>\n    'eleckoiCharacterConfiguration/saveVariableConfig': (characterId: string, config: VariableConfig) => Promise<RemoteResult<VariableConfig>>\n    'eleckoiCharacterConfiguration/saveVariableConfigViewState': (characterId: string, expandedObjectIds: string[]) => Promise<RemoteResult<string[]>>\n    'eleckoiCharacterConfiguration/testRegexRule': (text: string, rule: RegexRule, target: RegexRuleTarget) => Promise<RemoteResult<RegexRuleTestResult>>\n    'eleckoiCharacterConfiguration/updateSettingLibraryEntries': (characterId: string, updates: SettingLibraryEntryUpdate[], signal?: AbortSignal) => Promise<RemoteResult<SettingLibraryEntry[]>>\n    'eleckoiCharacters/changes': (signal?: AbortSignal) => RemoteStreamHandle<ProductRecordChange, never>\n    'eleckoiCharacters/commitImport': (token: string) => Promise<RemoteResult<CharacterImportResult>>\n    'eleckoiCharacters/create': (character: CharacterRecord) => Promise<RemoteResult<CharacterCollection>>\n    'eleckoiCharacters/delete': (characterIds: string[]) => Promise<RemoteResult<CharacterCollection>>\n    'eleckoiCharacters/discardImport': (token: string) => Promise<RemoteResult<void>>\n    'eleckoiCharacters/export': (characterId: string, format: CharacterExportFormat) => Promise<RemoteResult<CharacterExportResult>>\n    'eleckoiCharacters/list': () => Promise<RemoteResult<CharacterCollection>>\n    'eleckoiCharacters/prepareImport': (files: CharacterImportFile[], source: CharacterImportSource) => Promise<RemoteResult<CharacterImportPreview>>\n    'eleckoiCharacters/saveGroups': (groups: string[], assignments: CharacterGroupAssignment[]) => Promise<RemoteResult<CharacterCollection>>\n    'eleckoiCharacters/select': (characterId: string) => Promise<RemoteResult<CharacterCollection>>\n    'eleckoiCharacters/update': (character: CharacterRecord) => Promise<RemoteResult<CharacterCollection>>\n    'eleckoiConversationModels/current': (conversationId: string) => Promise<RemoteResult<ConversationModelSelection>>\n    'eleckoiConversationModels/select': (conversationId: string, selection: ConversationModelSelection) => Promise<RemoteResult<ConversationModelSelection>>\n    'eleckoiConversations/authorState': (conversationId: string) => Promise<RemoteResult<AuthorConversationState>>\n    'eleckoiConversations/changes': (signal?: AbortSignal) => RemoteStreamHandle<ConversationChange, never>\n    'eleckoiConversations/create': (input: ConversationCreateInput) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    'eleckoiConversations/delete': (conversationId: string) => Promise<RemoteResult<void>>\n    'eleckoiConversations/deleteMessagesFrom': (conversationId: string, eventSeq: number, role: 'user' | 'assistant') => Promise<RemoteResult<{ details: ConversationDetailsMetadata; deletedMessageCount: number; remainingMessageCount: number; }>>\n    'eleckoiConversations/details': (conversationId: string, beforeSequence?: number, limit?: number) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    'eleckoiConversations/editMessage': (conversationId: string, eventSeq: number, role: 'user' | 'assistant', content: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    'eleckoiConversations/exportArchive': (conversationId: string) => Promise<RemoteResult<string>>\n    'eleckoiConversations/fork': (conversationId: string, atSeq: number | undefined, retainedTurnIds: string[], title: string) => Promise<RemoteResult<string>>\n    'eleckoiConversations/importArchive': (characterId: string, json: string) => Promise<RemoteResult<string>>\n    'eleckoiConversations/list': (signal?: AbortSignal) => Promise<RemoteResult<ConversationSummary[]>>\n    'eleckoiConversations/preparePrompt': (conversationId: string, text: string, signal?: AbortSignal) => Promise<RemoteResult<{ runtimeSessionId: string; operationId: string; }>>\n    'eleckoiConversations/projectDisplay': (conversationId: string, messages: ConversationMessageDisplayInput[]) => Promise<RemoteResult<ConversationMessageDisplayResult[]>>\n    'eleckoiConversations/readGeneratedImage': (conversationId: string, batchId: string, frameId: number, attachmentId: string, signal?: AbortSignal) => Promise<RemoteResult<{ mediaType: string; data: string; }>>\n    'eleckoiConversations/regenerateImage': (conversationId: string, batchId: string, frameId: number, signal?: AbortSignal) => Promise<RemoteResult<void>>\n    'eleckoiConversations/regenerateMessage': (conversationId: string, eventSeq: number, requestId: string, replacementMessage?: string) => Promise<RemoteResult<{ runtimeSessionId: string; prepared: true; operationId: string; }>>\n    'eleckoiConversations/rename': (conversationId: string, title: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    'eleckoiConversations/replaceVariableState': (conversationId: string, stateJson: string, signal?: AbortSignal) => Promise<RemoteResult<string>>\n    'eleckoiConversations/requestPreview': (conversationId: string, requestId: string, signal?: AbortSignal) => Promise<RemoteResult<ConversationRequestPreview>>\n    'eleckoiConversations/requestPreviews': (conversationId: string, signal?: AbortSignal) => RemoteStreamHandle<ConversationRequestPreviewSummary[], never>\n    'eleckoiConversations/revealFile': (conversationId: string, attachmentId: string, name: string, signal?: AbortSignal) => Promise<RemoteResult<void>>\n    'eleckoiConversations/selectOpening': (conversationId: string, openingId: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    'eleckoiConversations/startRegeneration': (conversationId: string, requestId: string, cancelled: boolean) => Promise<RemoteResult<{ accepted: boolean; turn?: number; }>>\n    'eleckoiConversations/updateOpening': (conversationId: string, content: string) => Promise<RemoteResult<ConversationDetailsMetadata>>\n    'eleckoiConversations/variableTimeline': (conversationId: string) => Promise<RemoteResult<VariableViewerTimeline>>\n    'eleckoiConversations/waitForGeneration': (conversationId: string, operationId: string) => Promise<RemoteResult<void>>\n    'eleckoiCreatorStudio/changes': (signal?: AbortSignal) => RemoteStreamHandle<ProductRecordChange, never>\n    'eleckoiCreatorStudio/create': (input: CreateCreatorProjectInput) => Promise<RemoteResult<CreatorProjectCollection>>\n    'eleckoiCreatorStudio/delete': (projectId: string) => Promise<RemoteResult<CreatorProjectCollection>>\n    'eleckoiCreatorStudio/list': () => Promise<RemoteResult<CreatorProjectCollection>>\n    'eleckoiCreatorStudioSessions/create': (characterId: string) => Promise<RemoteResult<CreatorStudioSession>>\n    'eleckoiCreatorStudioSessions/delete': (sessionId: string) => Promise<RemoteResult<void>>\n    'eleckoiCreatorStudioSessions/deleteMessagesFrom': (sessionId: string, eventSeq: number, role: 'user' | 'assistant') => Promise<RemoteResult<void>>\n    'eleckoiCreatorStudioSessions/list': () => Promise<RemoteResult<CreatorStudioSessionSummary[]>>\n    'eleckoiCreatorStudioSessions/messages': (sessionId: string) => Promise<RemoteResult<CreatorStudioMessage[]>>\n    'eleckoiCreatorStudioSessions/open': (sessionId: string) => Promise<RemoteResult<CreatorStudioSession>>\n    'eleckoiCreatorStudioSessions/pin': (sessionId: string, pinned: boolean) => Promise<RemoteResult<void>>\n    'eleckoiCreatorStudioSessions/regenerate': (sessionId: string) => Promise<RemoteResult<void>>\n    'eleckoiCreatorStudioSessions/rename': (sessionId: string, title: string) => Promise<RemoteResult<void>>\n    'eleckoiCreatorStudioSessions/selectCharacter': (sessionId: string, characterId: string) => Promise<RemoteResult<CreatorStudioSession>>\n    'eleckoiDisplayPreferences/read': () => Promise<RemoteResult<DisplayPreferencesSnapshot>>\n    'eleckoiDisplayPreferences/setChatDisplay': (chatDisplay: Record<string, DisplayPreferenceValue>, expectedRevision?: number) => Promise<RemoteResult<DisplayPreferencesSnapshot>>\n    'eleckoiDisplayPreferences/updateUi': (ui: Record<string, DisplayPreferenceValue>, expectedRevision?: number) => Promise<RemoteResult<DisplayPreferencesSnapshot>>\n    'eleckoiModels/discoverModels': (input: ModelDiscoveryInput) => Promise<RemoteResult<ModelDiscoveryResult[]>>\n    'eleckoiModels/revealApiKey': (configId: string) => Promise<RemoteResult<string>>\n    'eleckoiPersona/changes': (signal?: AbortSignal) => RemoteStreamHandle<ProductRecordChange, never>\n    'eleckoiPersona/read': () => Promise<RemoteResult<PersonaProfile>>\n    'eleckoiPersona/save': (profile: PersonaProfile) => Promise<RemoteResult<PersonaProfile>>\n    'eleckoiSystem/status': () => Promise<RemoteResult<ElecKoiHostStatus>>\n    'eleckoiWebSearch/fetchSelection': () => Promise<RemoteResult<WebFetchMode>>\n    'eleckoiWebSearch/select': (mode: WebSearchMode) => Promise<RemoteResult<WebSearchMode>>\n    'eleckoiWebSearch/selectFetch': (mode: WebFetchMode) => Promise<RemoteResult<WebFetchMode>>\n    'eleckoiWebSearch/selection': () => Promise<RemoteResult<WebSearchMode>>\n    'eleckoiWebSearch/testDeepSeek': (apiKey?: string, signal?: AbortSignal) => Promise<RemoteResult<DeepSeekWebConnection>>\n    'eleckoiWebSearch/testTavily': (apiKey?: string, signal?: AbortSignal) => Promise<RemoteResult<TavilyConnection>>\n  }\n  interface TypertRemoteNamespaceMap {\n    'eleckoiAgentPresets': TypertRemoteNamespace$656c65636b6f694167656e7450726573657473\n    'eleckoiAuthorFrontends': TypertRemoteNamespace$656c65636b6f69417574686f7246726f6e74656e6473\n    'eleckoiAuthorScripts': TypertRemoteNamespace$656c65636b6f69417574686f7253637269707473\n    'eleckoiAuthorVariables': TypertRemoteNamespace$656c65636b6f69417574686f725661726961626c6573\n    'eleckoiCharacterConfiguration': TypertRemoteNamespace$656c65636b6f69436861726163746572436f6e66696775726174696f6e\n    'eleckoiCharacters': TypertRemoteNamespace$656c65636b6f6943686172616374657273\n    'eleckoiConversationModels': TypertRemoteNamespace$656c65636b6f69436f6e766572736174696f6e4d6f64656c73\n    'eleckoiConversations': TypertRemoteNamespace$656c65636b6f69436f6e766572736174696f6e73\n    'eleckoiCreatorStudio': TypertRemoteNamespace$656c65636b6f6943726561746f7253747564696f\n    'eleckoiCreatorStudioSessions': TypertRemoteNamespace$656c65636b6f6943726561746f7253747564696f53657373696f6e73\n    'eleckoiDisplayPreferences': TypertRemoteNamespace$656c65636b6f69446973706c6179507265666572656e636573\n    'eleckoiModels': TypertRemoteNamespace$656c65636b6f694d6f64656c73\n    'eleckoiPersona': TypertRemoteNamespace$656c65636b6f69506572736f6e61\n    'eleckoiSystem': TypertRemoteNamespace$656c65636b6f6953797374656d\n    'eleckoiWebSearch': TypertRemoteNamespace$656c65636b6f69576562536561726368\n  }\n}\n\nexport declare const TYPERT_REMOTE: TypertRemoteContribution\nexport default TYPERT_REMOTE\n//# sourceMappingURL=typert.remote-client.d.ts.map\n"
