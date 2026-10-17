<!-- 由 pnpm generate:plugin-docs 使用锁定的 DSH 官方生成器生成，请勿手工修改。 -->

# Host 接口引用的数据类型

以下声明由官方 TypeGraphRenderer 从公开方法引用的类型生成。类型应从对应公开包入口导入，完整设定字段保留在原有结构中。

## AgentPreset

```ts
export interface AgentPreset {
    id: string;
    purpose: AgentPresetPurpose;
    name: string;
    modelFamily: AgentPresetModelFamily;
    modelTags: AgentPresetModelTag[];
    libraryGroupId: string;
    activeVersionId: string;
    activeVersionNumber: number;
    profile: AgentPresetProfile;
    entries: SettingLibraryEntry[];
    groups: SettingLibraryGroup[];
    promptPositions: SettingLibraryPromptPosition[];
    toolGroups: AgentToolGroup[];
    subagentModelSelection?: { configId: string; model: string; };
    toolModelConfigIds?: Record<string, string>;
    roleplayPlan: { steps: string[]; };
    regexRules: RegexRule[];
    expandedGroupIds: string[];
}
```

源码：[packages/host/product-api/src/types.ts:807](../../packages/host/product-api/src/types.ts#L807)

## AgentPresetCatalog

```ts
export interface AgentPresetCatalog {
    activePresetIds: { roleplay: string; creator: string; };
    groups: AgentPresetLibraryGroup[];
    presets: AgentPresetSummary[];
}
```

源码：[packages/host/product-api/src/types.ts:786](../../packages/host/product-api/src/types.ts#L786)

## AgentPresetExportFormat

```ts
export type AgentPresetExportFormat = 'json' | 'png';
```

源码：[packages/host/product-api/src/types.ts:744](../../packages/host/product-api/src/types.ts#L744)

## AgentPresetExportResult

```ts
export interface AgentPresetExportResult {
    fileName: string;
    mimeType: string;
    base64: string;
}
```

源码：[packages/host/product-api/src/types.ts:841](../../packages/host/product-api/src/types.ts#L841)

## AgentPresetImportDocument

```ts
export interface AgentPresetImportDocument {
    displayName: string;
    mimeType: string;
    base64: string;
}
```

源码：[packages/host/product-api/src/types.ts:828](../../packages/host/product-api/src/types.ts#L828)

## AgentPresetImportResult

```ts
export interface AgentPresetImportResult {
    preset: AgentPreset;
    source: AgentPresetImportSource;
    skippedUnsupportedEntries: number;
    skippedDepthRegexCount: number;
}
```

源码：[packages/host/product-api/src/types.ts:834](../../packages/host/product-api/src/types.ts#L834)

## AgentPresetImportSource

```ts
export type AgentPresetImportSource = 'eleckoi' | 'sillytavern';
```

源码：[packages/host/product-api/src/types.ts:743](../../packages/host/product-api/src/types.ts#L743)

## AgentPresetLibraryGroup

```ts
export interface AgentPresetLibraryGroup {
    id: string;
    purpose: AgentPresetPurpose;
    name: string;
    sortIndex: number;
}
```

源码：[packages/host/product-api/src/types.ts:766](../../packages/host/product-api/src/types.ts#L766)

## AgentPresetModelFamily

```ts
export type AgentPresetModelFamily = 'general' | 'claude' | 'openai' | 'gemini' | 'deepseek' | 'other';
```

源码：[packages/host/product-api/src/types.ts:742](../../packages/host/product-api/src/types.ts#L742)

## AgentPresetModelTag

```ts
export interface AgentPresetModelTag {
    id: string;
    label: string;
    providerId: string;
}
```

源码：[packages/host/product-api/src/types.ts:746](../../packages/host/product-api/src/types.ts#L746)

## AgentPresetProfile

```ts
export interface AgentPresetProfile {
    authorName: string;
    authorAvatarPath: string;
    usageInstructions: string;
    timeline: AgentPresetTimelineItem[];
}
```

源码：[packages/host/product-api/src/types.ts:759](../../packages/host/product-api/src/types.ts#L759)

## AgentPresetPurpose

```ts
export type AgentPresetPurpose = 'roleplay' | 'creator';
```

源码：[packages/host/product-api/src/types.ts:741](../../packages/host/product-api/src/types.ts#L741)

## AgentPresetSummary

```ts
export interface AgentPresetSummary {
    id: string;
    purpose: AgentPresetPurpose;
    name: string;
    modelFamily: AgentPresetModelFamily;
    modelTags: AgentPresetModelTag[];
    libraryGroupId: string;
    activeVersionId: string;
    activeVersionNumber: number;
    entryCount: number;
    profile: AgentPresetProfile;
}
```

源码：[packages/host/product-api/src/types.ts:773](../../packages/host/product-api/src/types.ts#L773)

## AgentPresetTimelineItem

```ts
export interface AgentPresetTimelineItem {
    id: string;
    title: string;
    dateLabel: string;
    note: string;
}
```

源码：[packages/host/product-api/src/types.ts:752](../../packages/host/product-api/src/types.ts#L752)

## AgentToolGroup

```ts
export interface AgentToolGroup {
    id: string;
    name: string;
    description: string;
    source: 'built_in' | 'mcp' | 'extension';
    members: AgentToolMember[];
    enabled: boolean;
    included: boolean;
}
```

源码：[packages/host/product-api/src/types.ts:797](../../packages/host/product-api/src/types.ts#L797)

## AgentToolMember

```ts
export interface AgentToolMember {
    name: string;
    description: string;
}
```

源码：[packages/host/product-api/src/types.ts:792](../../packages/host/product-api/src/types.ts#L792)

## AuthorConversationState

```ts
export interface AuthorConversationState {
    initialVariableStateJson: string;
    currentVariableStateJson: string;
    variableConfig: VariableConfig | null;
    settingLibrarySummary: { characterId: string; name: string; activeVersionId: string; entryCount: number; groupCount: number; } | null;
    settingLibrary: ConversationRuntimeSettingLibrary | null;
}
```

源码：[packages/host/product-api/src/types.ts:338](../../packages/host/product-api/src/types.ts#L338)

## AuthorScriptJson

```ts
export type AuthorScriptJson = null | boolean | number | string | AuthorScriptJson[] | { [key: string]: AuthorScriptJson; };
```

源码：[packages/host/product-api/src/types.ts:70](../../packages/host/product-api/src/types.ts#L70)

## CharacterCollection

```ts
export interface CharacterCollection {
    active_character_id: string;
    groups: string[];
    items: CharacterRecord[];
}
```

源码：[packages/host/product-api/src/types.ts:419](../../packages/host/product-api/src/types.ts#L419)

## CharacterConfigurationChange

```ts
export type CharacterConfigurationChange = { kind: 'snapshot'; } | { kind: 'configuration'; domain: 'settingLibraries' | 'variables' | 'regexRules' | 'agentPresets' | 'scripts' | 'displayTemplates'; characterId?: string; };
```

源码：[packages/host/product-api/src/types.ts:205](../../packages/host/product-api/src/types.ts#L205)

## CharacterExportFormat

```ts
export type CharacterExportFormat = 'png' | 'json';
```

源码：[packages/host/product-api/src/types.ts:431](../../packages/host/product-api/src/types.ts#L431)

## CharacterExportResult

```ts
export interface CharacterExportResult {
    fileName: string;
    mimeType: 'image/png' | 'application/json';
    base64: string;
}
```

源码：[packages/host/product-api/src/types.ts:460](../../packages/host/product-api/src/types.ts#L460)

## CharacterGroupAssignment

```ts
export interface CharacterGroupAssignment {
    characterId: string;
    group: string;
}
```

源码：[packages/host/product-api/src/types.ts:425](../../packages/host/product-api/src/types.ts#L425)

## CharacterImportFile

```ts
export interface CharacterImportFile {
    displayName: string;
    mimeType: string;
    base64: string;
}
```

源码：[packages/host/product-api/src/types.ts:433](../../packages/host/product-api/src/types.ts#L433)

## CharacterImportPreview

```ts
export interface CharacterImportPreview {
    token: string;
    items: CharacterImportPreviewItem[];
}
```

源码：[packages/host/product-api/src/types.ts:449](../../packages/host/product-api/src/types.ts#L449)

## CharacterImportPreviewItem

```ts
export interface CharacterImportPreviewItem {
    id: string;
    name: string;
    summary: string;
    warnings: string[];
    imageAvailable: boolean;
    errorMessage: string;
    importable: boolean;
}
```

源码：[packages/host/product-api/src/types.ts:439](../../packages/host/product-api/src/types.ts#L439)

## CharacterImportResult

```ts
export interface CharacterImportResult {
    collection: CharacterCollection;
    importedCharacterIds: string[];
    failedMessages: string[];
}
```

源码：[packages/host/product-api/src/types.ts:454](../../packages/host/product-api/src/types.ts#L454)

## CharacterImportSource

```ts
export type CharacterImportSource = 'eleckoi' | 'sillytavern';
```

源码：[packages/host/product-api/src/types.ts:430](../../packages/host/product-api/src/types.ts#L430)

## CharacterPersona

```ts
export interface CharacterPersona {
    assistant_name: string;
    assistant_avatar: string;
    assistant_square: string;
    assistant_cover: string;
    image_prompt?: string;
    opening?: string;
    show_opening?: boolean;
    user_name?: string;
    user_avatar?: string;
    user_square?: string;
    user_portrait?: string;
}
```

源码：[packages/host/product-api/src/types.ts:382](../../packages/host/product-api/src/types.ts#L382)

## CharacterRecord

```ts
export interface CharacterRecord {
    id: string;
    name?: string;
    avatar?: string;
    group?: string;
    groupName?: string;
    groupViewOrder?: number;
    folder?: string;
    frontendBeautyEnabled?: boolean | number;
    profileAge?: string;
    profileSex?: string;
    profileHeight?: string;
    profileBirthday?: string;
    profileLike?: string;
    showOpening?: boolean | number;
    chatBackground?: string;
    chatBackgroundOpacity?: number;
    chatBackgroundBlur?: number;
    chatBackgroundScrim?: number;
    primaryOpening?: string;
    persona?: CharacterPersona;
}
```

源码：[packages/host/product-api/src/types.ts:396](../../packages/host/product-api/src/types.ts#L396)

## ConversationChange

```ts
export type ConversationChange = { kind: 'snapshot'; } | { kind: 'generation'; conversationId: string; error: string; } | { kind: 'catalog'; conversationId: string; reason: 'created' | 'deleted' | 'updated'; } | { kind: 'messages'; conversationId: string; reason: 'edited' | 'deleted' | 'regenerated'; messageIds: string[]; sessionRewritten?: boolean; };
```

源码：[packages/host/product-api/src/types.ts:193](../../packages/host/product-api/src/types.ts#L193)

## ConversationCreateInput

```ts
export interface ConversationCreateInput {
    title?: string;
    metadata?: Partial<ConversationMetadata>;
}
```

源码：[packages/host/product-api/src/types.ts:149](../../packages/host/product-api/src/types.ts#L149)

## ConversationDetailsMetadata

```ts
export interface ConversationDetailsMetadata {
    conversation: ConversationRecord;
    metadata: ConversationMetadata;
    runtimeSessionId: string;
    messages: ConversationMessageMetadata[];
    hasMore: boolean;
    beforeSequence: number | null;
    runtimeVariableStateByTurn?: Record<string, string>;
}
```

源码：[packages/host/product-api/src/types.ts:267](../../packages/host/product-api/src/types.ts#L267)

## ConversationMessageDisplayInput

```ts
export interface ConversationMessageDisplayInput {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    variableStateJson: string;
    status: 'complete' | 'streaming' | 'error' | 'cancelled';
    createdAt: string;
    reasoning?: ConversationReasoningDisplayInput[];
}
```

源码：[packages/host/product-api/src/types.ts:279](../../packages/host/product-api/src/types.ts#L279)

## ConversationMessageDisplayResult

```ts
export interface ConversationMessageDisplayResult {
    id: string;
    sourceContent: string;
    displayContent: string;
    variableStateJson: string;
    reasoning?: ConversationReasoningDisplayResult[];
}
```

源码：[packages/host/product-api/src/types.ts:294](../../packages/host/product-api/src/types.ts#L294)

## ConversationMessageMetadata

```ts
export interface ConversationMessageMetadata {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    variableStateJson: string;
    status: 'complete' | 'streaming' | 'error' | 'cancelled';
    createdAt: string;
    content?: string;
    displayContent?: string;
    turnId?: string;
    speakerId?: string;
    speakerName?: string;
    speakerAvatar?: string;
    sequence?: number;
    messageIndex?: number;
    responseIndex?: number;
    runtimeSessionId?: string;
    dshMessageId?: string;
    sessionEventSeq?: number;
    dshTurn?: number;
    openingOptions?: ConversationOpeningOption[];
    selectedOpeningId?: string;
    canChangeOpening?: boolean;
}
```

源码：[packages/host/product-api/src/types.ts:233](../../packages/host/product-api/src/types.ts#L233)

## ConversationMetadata

```ts
export interface ConversationMetadata {
    characterId: string;
    characterName: string;
    characterAvatar: string;
    characterPersona: CharacterPersona;
}
```

源码：[packages/host/product-api/src/types.ts:142](../../packages/host/product-api/src/types.ts#L142)

## ConversationModelSelection

```ts
export interface ConversationModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
```

源码：[packages/host/product-api/src/types.ts:128](../../packages/host/product-api/src/types.ts#L128)

## ConversationOpeningOption

```ts
export interface ConversationOpeningOption {
    id: string;
    title: string;
    content: string;
    variableVersionId?: string;
    displayContent?: string;
    initialVariableStateJson: string;
}
```

源码：[packages/host/product-api/src/types.ts:223](../../packages/host/product-api/src/types.ts#L223)

## ConversationReasoningDisplayInput

```ts
export interface ConversationReasoningDisplayInput {
    id: string;
    text: string;
}
```

源码：[packages/host/product-api/src/types.ts:290](../../packages/host/product-api/src/types.ts#L290)

## ConversationReasoningDisplayResult

```ts
export interface ConversationReasoningDisplayResult {
    id: string;
    sourceText: string;
    displayText: string;
}
```

源码：[packages/host/product-api/src/types.ts:291](../../packages/host/product-api/src/types.ts#L291)

## ConversationRecord

```ts
export interface ConversationRecord {
    id: string;
    title: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:134](../../packages/host/product-api/src/types.ts#L134)

## ConversationRequestPreview

```ts
export interface ConversationRequestPreview {
    id: string;
    items: Array<{ order: number; messageId: string; role: 'system' | 'user' | 'assistant'; kind: 'system' | 'prompt' | 'history' | 'user' | 'assistant' | 'tool' | 'context'; title: string; source: string; anchor: string; content: string; }>;
}
```

源码：[packages/host/product-api/src/types.ts:172](../../packages/host/product-api/src/types.ts#L172)

## ConversationRequestPreviewSummary

```ts
export interface ConversationRequestPreviewSummary {
    id: string;
    round: number | null;
    request: number;
    turn: number;
    step: number;
    provider: string;
    model: string;
}
```

源码：[packages/host/product-api/src/types.ts:161](../../packages/host/product-api/src/types.ts#L161)

## ConversationRuntimeSettingLibrary

```ts
export interface ConversationRuntimeSettingLibrary {
    characterId: string;
    name: string;
    entries: SettingLibraryEntry[];
    groups: SettingLibraryGroup[];
    promptPositions: SettingLibraryPromptPosition[];
}
```

源码：[packages/host/product-api/src/types.ts:847](../../packages/host/product-api/src/types.ts#L847)

## ConversationSummary

```ts
export interface ConversationSummary extends ConversationRecord {
    metadata: ConversationMetadata;
    runtimeSessionId: string;
}
```

源码：[packages/host/product-api/src/types.ts:154](../../packages/host/product-api/src/types.ts#L154)

## CreateCreatorProjectInput

```ts
export interface CreateCreatorProjectInput {
    name: string;
    mode: CreatorProjectMode;
    parentDirectory: string;
    sourceCharacterId?: string;
}
```

源码：[packages/host/product-api/src/types.ts:483](../../packages/host/product-api/src/types.ts#L483)

## CreatorProject

```ts
export interface CreatorProject {
    id: string;
    name: string;
    mode: CreatorProjectMode;
    rootPath: string;
    sourceCharacterId: string;
    coverImage: string;
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:468](../../packages/host/product-api/src/types.ts#L468)

## CreatorProjectCollection

```ts
export interface CreatorProjectCollection {
    items: CreatorProject[];
}
```

源码：[packages/host/product-api/src/types.ts:479](../../packages/host/product-api/src/types.ts#L479)

## CreatorProjectMode

```ts
export type CreatorProjectMode = 'blank' | 'existing';
```

源码：[packages/host/product-api/src/types.ts:466](../../packages/host/product-api/src/types.ts#L466)

## CreatorStudioMessage

```ts
export interface CreatorStudioMessage {
    eventSeq: number;
    role: 'user' | 'assistant';
    text: string;
    turn: number;
}
```

源码：[packages/host/product-api/src/types.ts:1036](../../packages/host/product-api/src/types.ts#L1036)

## CreatorStudioSession

```ts
export interface CreatorStudioSession {
    sessionId: string;
    presetId: string;
    characterId: string;
}
```

源码：[packages/host/product-api/src/types.ts:1035](../../packages/host/product-api/src/types.ts#L1035)

## CreatorStudioSessionSummary

```ts
export interface CreatorStudioSessionSummary extends CreatorStudioSession {
    title: string;
    updatedAt: number;
    pinned: boolean;
    pinIndex: number;
}
```

源码：[packages/host/product-api/src/types.ts:1037](../../packages/host/product-api/src/types.ts#L1037)

## DeepSeekWebConnection

```ts
export interface DeepSeekWebConnection {
    ok: true;
    provider: 'deepseek_api';
    search: true;
    fetch: true;
}
```

源码：[packages/host/product-api/src/types.ts:355](../../packages/host/product-api/src/types.ts#L355)

## DisplayPreferencesSnapshot

```ts
export interface DisplayPreferencesSnapshot {
    ui: Record<string, DisplayPreferenceValue>;
    chatDisplay: Record<string, DisplayPreferenceValue>;
    writable: boolean;
    revision: number;
}
```

源码：[packages/host/product-api/src/types.ts:1029](../../packages/host/product-api/src/types.ts#L1029)

## DisplayPreferenceValue

```ts
export type DisplayPreferenceValue = null | boolean | number | string | DisplayPreferenceValue[] | { [key: string]: DisplayPreferenceValue; };
```

源码：[packages/host/product-api/src/types.ts:1026](../../packages/host/product-api/src/types.ts#L1026)

## DisplayTemplate

```ts
export interface DisplayTemplate {
    id: string;
    name: string;
    enabled: boolean;
    position: 'before' | 'after' | 'replace';
    pattern: string;
    flags: string;
    source: string;
}
```

源码：[packages/host/product-api/src/types.ts:18](../../packages/host/product-api/src/types.ts#L18)

## DisplayTemplateLibrary

```ts
export interface DisplayTemplateLibrary {
    scope: DisplayTemplateScope;
    ownerId: string;
    enabled: boolean;
    revision: number;
    templates: DisplayTemplate[];
}
```

源码：[packages/host/product-api/src/types.ts:27](../../packages/host/product-api/src/types.ts#L27)

## DisplayTemplateScope

```ts
export type DisplayTemplateScope = 'global' | 'character' | 'preset';
```

源码：[packages/host/product-api/src/types.ts:17](../../packages/host/product-api/src/types.ts#L17)

## DisplayTemplateSelection

```ts
export interface DisplayTemplateSelection {
    characterId: string;
    libraries: DisplayTemplateLibrary[];
}
```

源码：[packages/host/product-api/src/types.ts:34](../../packages/host/product-api/src/types.ts#L34)

## EditorLibraryAddress

```ts
export interface EditorLibraryAddress {
    kind: EditorLibraryKind;
    scope: 'global' | 'character' | 'preset';
    ownerId: string;
}
```

源码：[packages/host/product-api/src/types.ts:7](../../packages/host/product-api/src/types.ts#L7)

## EditorLibraryKind

```ts
export type EditorLibraryKind = 'scripts' | 'displayTemplates' | 'regex';
```

源码：[packages/host/product-api/src/types.ts:6](../../packages/host/product-api/src/types.ts#L6)

## EditorLibrarySaveRequest

```ts
export interface EditorLibrarySaveRequest {
    kind: EditorLibraryKind;
    documents: string[];
    versions: EditorLibraryVersions[];
}
```

源码：[packages/host/product-api/src/types.ts:14](../../packages/host/product-api/src/types.ts#L14)

## EditorLibrarySaveResult

```ts
export interface EditorLibrarySaveResult {
    documents: string[];
    versions: EditorLibraryVersions[];
}
```

源码：[packages/host/product-api/src/types.ts:15](../../packages/host/product-api/src/types.ts#L15)

## EditorLibraryVersions

```ts
export interface EditorLibraryVersions extends EditorLibraryAddress {
    revision: number;
    resourceRevision: string;
    activeVersionId: string;
    versions: Array<{ id: string; name: string; content: string; }>;
}
```

源码：[packages/host/product-api/src/types.ts:8](../../packages/host/product-api/src/types.ts#L8)

## ElecKoiHostStatus

```ts
export interface ElecKoiHostStatus {
    architecture: 'dsh-remote';
    protocolVersion: 1;
}
```

源码：[packages/host/product-api/src/types.ts:1](../../packages/host/product-api/src/types.ts#L1)

## FrontendExport

```ts
export type FrontendExport = Omit<Native.FrontendExport, 'project'> & { project: FrontendProject; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:18](../../packages/host/product-api/src/frontend-project-types.ts#L18)

## FrontendFile

```ts
export type FrontendFile = Native.FrontendFile;
```

源码：[packages/host/product-api/src/frontend-project-types.ts:17](../../packages/host/product-api/src/frontend-project-types.ts#L17)

## FrontendFileInput

```ts
export type FrontendFileInput = Native.FrontendFileInput;
```

源码：[packages/host/product-api/src/frontend-project-types.ts:15](../../packages/host/product-api/src/frontend-project-types.ts#L15)

## FrontendFileQuery

```ts
export type FrontendFileQuery = Native.FrontendFileQuery;
```

源码：[packages/host/product-api/src/frontend-project-types.ts:16](../../packages/host/product-api/src/frontend-project-types.ts#L16)

## FrontendImport

```ts
export type FrontendImport = Omit<Native.FrontendImport, 'manifest' | 'project'> & { manifest?: FrontendJson; project?: FrontendJson; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:13](../../packages/host/product-api/src/frontend-project-types.ts#L13)

## FrontendJson

```ts
export type FrontendJson = Record<string, FrontendValue>;
```

源码：[packages/host/product-api/src/frontend-project-types.ts:6](../../packages/host/product-api/src/frontend-project-types.ts#L6)

## FrontendManifest

```ts
export type FrontendManifest = Omit<Native.FrontendManifest, 'config' | 'project'> & { config?: FrontendJson; project?: FrontendJson; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:10](../../packages/host/product-api/src/frontend-project-types.ts#L10)

## FrontendOwner

```ts
export type FrontendOwner = Native.FrontendOwner;
```

源码：[packages/host/product-api/src/frontend-project-types.ts:8](../../packages/host/product-api/src/frontend-project-types.ts#L8)

## FrontendProject

```ts
export type FrontendProject = Omit<Native.FrontendProject, 'manifest'> & { manifest?: FrontendManifest; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:11](../../packages/host/product-api/src/frontend-project-types.ts#L11)

## FrontendReplaceFiles

```ts
export type FrontendReplaceFiles = Omit<Native.FrontendReplaceFiles, 'manifest'> & { manifest?: FrontendJson; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:14](../../packages/host/product-api/src/frontend-project-types.ts#L14)

## FrontendValue

```ts
export type FrontendValue = null | boolean | number | string | FrontendValue[] | { [key: string]: FrontendValue; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:5](../../packages/host/product-api/src/frontend-project-types.ts#L5)

## FrontendWorkspace

```ts
export type FrontendWorkspace = Omit<Native.FrontendWorkspace, 'projects'> & { projects: FrontendProject[]; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:12](../../packages/host/product-api/src/frontend-project-types.ts#L12)

## ModelDiscoveryInput

```ts
export interface ModelDiscoveryInput {
    builtinProvider?: string;
    configId: string;
    baseURL: string;
    api: string;
    apiKey?: string;
    headers?: Record<string, string>;
}
```

源码：[packages/host/product-api/src/types.ts:109](../../packages/host/product-api/src/types.ts#L109)

## ModelDiscoveryResult

```ts
export interface ModelDiscoveryResult {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    inputModalities?: readonly ('text' | 'image')[];
    reasoningEfforts?: Record<string, string | null>;
    reasoningEffort?: string;
}
```

源码：[packages/host/product-api/src/types.ts:118](../../packages/host/product-api/src/types.ts#L118)

## NativeAuthorRuleReply

```ts
export type NativeAuthorRuleReply = { id: string; ok: true; stateJson: string; } | { id: string; ok: false; message: string; };
```

源码：[packages/host/product-api/src/types.ts:106](../../packages/host/product-api/src/types.ts#L106)

## NativeAuthorRuleTask

```ts
export type NativeAuthorRuleTask = { kind: 'ready'; version: string; } | { kind: 'process'; id: string; runId: string; conversationId: string; stage: 'before' | 'after' | 'afterSchema'; stateJson: string; beforeJson: string; scriptSettings: NativeAuthorScriptSettingsUpdate[] | null; } | { kind: 'cancel'; runId: string; };
```

源码：[packages/host/product-api/src/types.ts:102](../../packages/host/product-api/src/types.ts#L102)

## NativeAuthorScript

```ts
export interface NativeAuthorScript {
    buttonsVisible: boolean;
    key: string;
    id: string;
    name: string;
    scope: ScriptLibraryScope;
    ownerId: string;
    source: string;
    entryUrl: string;
    settings: { [key: string]: AuthorScriptJson; };
    librarySettings: { [key: string]: AuthorScriptJson; };
}
```

源码：[packages/host/product-api/src/types.ts:71](../../packages/host/product-api/src/types.ts#L71)

## NativeAuthorScriptCatalog

```ts
export interface NativeAuthorScriptCatalog {
    conversationId: string;
    characterId: string;
    presetId: string;
    version: string;
    scripts: NativeAuthorScript[];
}
```

源码：[packages/host/product-api/src/types.ts:88](../../packages/host/product-api/src/types.ts#L88)

## NativeAuthorScriptIdentity

```ts
export interface NativeAuthorScriptIdentity {
    scope: ScriptLibraryScope;
    ownerId: string;
    scriptId: string;
}
```

源码：[packages/host/product-api/src/types.ts:95](../../packages/host/product-api/src/types.ts#L95)

## NativeAuthorScriptSettings

```ts
export interface NativeAuthorScriptSettings {
    revision: number;
    values: { [key: string]: AuthorScriptJson; };
}
```

源码：[packages/host/product-api/src/types.ts:96](../../packages/host/product-api/src/types.ts#L96)

## NativeAuthorScriptSettingsUpdate

```ts
export interface NativeAuthorScriptSettingsUpdate {
    key: string;
    settings: { [key: string]: AuthorScriptJson; };
    librarySettings: { [key: string]: AuthorScriptJson; };
}
```

源码：[packages/host/product-api/src/types.ts:97](../../packages/host/product-api/src/types.ts#L97)

## NativeFrontendChange

```ts
export type NativeFrontendChange = { kind: 'snapshot' | 'changed'; revision: number; };
```

源码：[packages/host/product-api/src/frontend-project-types.ts:20](../../packages/host/product-api/src/frontend-project-types.ts#L20)

## PersonaProfile

```ts
export interface PersonaProfile {
    assistant_name: string;
    assistant_avatar: string;
    assistant_square: string;
    assistant_cover: string;
    opening: string;
    show_opening: boolean;
    user_name: string;
    user_avatar: string;
    user_square: string;
    user_portrait: string;
}
```

源码：[packages/host/product-api/src/types.ts:369](../../packages/host/product-api/src/types.ts#L369)

## ProductRecordChange

```ts
export type ProductRecordChange = { kind: 'snapshot'; } | { kind: 'records'; domain: 'characters' | 'persona' | 'creatorProjects'; ids?: string[]; };
```

源码：[packages/host/product-api/src/types.ts:213](../../packages/host/product-api/src/types.ts#L213)

## RegexEditorTarget

```ts
export interface RegexEditorTarget {
    scope: 'character' | 'preset';
    ownerId: string;
}
```

源码：[packages/host/product-api/src/types.ts:710](../../packages/host/product-api/src/types.ts#L710)

## RegexRule

```ts
export interface RegexRule {
    id: string;
    name: string;
    pattern: string;
    replacement: string;
    targets: RegexRuleTarget[];
    enabled: boolean;
    displayOnly: boolean;
    promptOnly: boolean;
    runOnEdit: boolean;
    order: number;
    trimStrings?: string[];
    minDepth?: number | null;
    maxDepth?: number | null;
    substituteRegex?: 0 | 1 | 2;
}
```

源码：[packages/host/product-api/src/types.ts:657](../../packages/host/product-api/src/types.ts#L657)

## RegexRuleCollection

```ts
export interface RegexRuleCollection {
    characterId: string;
    agentPresetId: string;
    agentPresetName: string;
    agentPresetRegexRevision: string;
    globalEnabled?: boolean;
    agentPresetEnabled?: boolean;
    characterEnabled?: boolean;
    globalRules: RegexRule[];
    agentPresetRules: RegexRule[];
    characterRules: RegexRule[];
    versions: RegexRuleVersion[];
    activeVersionId: string;
    revision: number;
}
```

源码：[packages/host/product-api/src/types.ts:682](../../packages/host/product-api/src/types.ts#L682)

## RegexRuleEditorCollection

```ts
export interface RegexRuleEditorCollection {
    target: RegexEditorTarget;
    ownerRevision: string;
    globalEnabled?: boolean;
    agentPresetEnabled?: boolean;
    characterEnabled?: boolean;
    globalRules: RegexRule[];
    agentPresetRules: RegexRule[];
    characterRules: RegexRule[];
    versions: RegexRuleVersion[];
    activeVersionId: string;
    revision: number;
}
```

源码：[packages/host/product-api/src/types.ts:715](../../packages/host/product-api/src/types.ts#L715)

## RegexRuleEditorImportResult

```ts
export interface RegexRuleEditorImportResult {
    collection: RegexRuleEditorCollection;
    importedFileCount: number;
    importedRuleCount: number;
    failedFileNames: string[];
}
```

源码：[packages/host/product-api/src/types.ts:729](../../packages/host/product-api/src/types.ts#L729)

## RegexRuleImportDocument

```ts
export interface RegexRuleImportDocument {
    displayName: string;
    json: string;
}
```

源码：[packages/host/product-api/src/types.ts:698](../../packages/host/product-api/src/types.ts#L698)

## RegexRuleImportResult

```ts
export interface RegexRuleImportResult {
    collection: RegexRuleCollection;
    importedFileCount: number;
    importedRuleCount: number;
    failedFileNames: string[];
}
```

源码：[packages/host/product-api/src/types.ts:703](../../packages/host/product-api/src/types.ts#L703)

## RegexRuleScope

```ts
export type RegexRuleScope = 'Global' | 'AgentPreset' | 'Character';
```

源码：[packages/host/product-api/src/types.ts:654](../../packages/host/product-api/src/types.ts#L654)

## RegexRuleTarget

```ts
export type RegexRuleTarget = 'UserInput' | 'AiOutput' | 'SettingContent' | 'Reasoning';
```

源码：[packages/host/product-api/src/types.ts:655](../../packages/host/product-api/src/types.ts#L655)

## RegexRuleTestResult

```ts
export interface RegexRuleTestResult {
    output: string;
    validationMessage: string | null;
}
```

源码：[packages/host/product-api/src/types.ts:736](../../packages/host/product-api/src/types.ts#L736)

## RegexRuleVersion

```ts
export interface RegexRuleVersion {
    id: string;
    name: string;
    globalEnabledIds: string[];
    agentPresetEnabledIds: string[];
    characterEnabledIds: string[];
}
```

源码：[packages/host/product-api/src/types.ts:674](../../packages/host/product-api/src/types.ts#L674)

## RequestPreviewSummary

```ts
export interface RequestPreviewSummary {
    id: string;
    round: number | null;
    request: number;
    turn: number;
    step: number;
    provider: string;
    model: string;
}
```

源码：[packages/client/features/dsh-client-roleplay/src/host/request-preview.d.mts:4](../../packages/client/features/dsh-client-roleplay/src/host/request-preview.d.mts#L4)

## RoleplayRequestContextItem

```ts
export interface RoleplayRequestContextItem {
    order: number;
    messageId: string;
    role: 'system' | 'user' | 'assistant';
    kind: 'system' | 'prompt' | 'history' | 'user' | 'assistant' | 'tool' | 'context';
    title: string;
    source: string;
    anchor: string;
    content: string;
}
```

源码：[packages/client/features/dsh-client-roleplay/src/projections.d.ts:4](../../packages/client/features/dsh-client-roleplay/src/projections.d.ts#L4)

## ScriptFolder

```ts
export interface ScriptFolder {
    [key: string]: AuthorScriptJson;
    type: 'folder';
    id: string;
    name: string;
    enabled: boolean;
    icon: string;
    color: string;
    scripts: ScriptItem[];
}
```

源码：[packages/host/product-api/src/types.ts:51](../../packages/host/product-api/src/types.ts#L51)

## ScriptItem

```ts
export interface ScriptItem {
    [key: string]: AuthorScriptJson;
    type: 'script';
    id: string;
    name: string;
    enabled: boolean;
    content: string;
    info: string;
    data: { [key: string]: AuthorScriptJson; };
    button: { [key: string]: AuthorScriptJson; enabled: boolean; buttons: Array<{ [key: string]: AuthorScriptJson; name: string; visible: boolean; }>; };
    export_with: { [key: string]: AuthorScriptJson; data: boolean; button: boolean; };
}
```

源码：[packages/host/product-api/src/types.ts:38](../../packages/host/product-api/src/types.ts#L38)

## ScriptLibrary

```ts
export interface ScriptLibrary {
    scope: ScriptLibraryScope;
    ownerId: string;
    enabled: boolean;
    revision: number;
    trees: ScriptTree[];
    variables: { [key: string]: AuthorScriptJson; };
}
```

源码：[packages/host/product-api/src/types.ts:62](../../packages/host/product-api/src/types.ts#L62)

## ScriptLibraryScope

```ts
export type ScriptLibraryScope = 'global' | 'character' | 'preset';
```

源码：[packages/host/product-api/src/types.ts:37](../../packages/host/product-api/src/types.ts#L37)

## ScriptTree

```ts
export type ScriptTree = ScriptItem | ScriptFolder;
```

源码：[packages/host/product-api/src/types.ts:61](../../packages/host/product-api/src/types.ts#L61)

## ScriptWorkspace

```ts
export interface ScriptWorkspace {
    path: string;
    version: string;
    entries: Array<{ id: string; file: string; }>;
}
```

源码：[packages/host/product-api/src/types.ts:83](../../packages/host/product-api/src/types.ts#L83)

## SettingLibrary

```ts
export interface SettingLibrary {
    characterId: string;
    name: string;
    entries: SettingLibraryEntry[];
    groups: SettingLibraryGroup[];
    promptPositions: SettingLibraryPromptPosition[];
    activeVersionId: string;
    versions: SettingLibraryVersion[];
    listAllExpanded: boolean;
    expandedGroupIds: string[];
}
```

源码：[packages/host/product-api/src/types.ts:576](../../packages/host/product-api/src/types.ts#L576)

## SettingLibraryContent

```ts
export type SettingLibraryContent = Pick<SettingLibrary, 'characterId' | 'name' | 'entries' | 'groups' | 'promptPositions'>;
```

源码：[packages/host/product-api/src/types.ts:588](../../packages/host/product-api/src/types.ts#L588)

## SettingLibraryConversation

```ts
export interface SettingLibraryConversation {
    sessionId: string;
    title: string;
    characterName: string;
    characterAvatar: string;
    summary: string;
    updatedAt: string;
    library: SettingLibrary;
}
```

源码：[packages/host/product-api/src/types.ts:590](../../packages/host/product-api/src/types.ts#L590)

## SettingLibraryEntry

```ts
export interface SettingLibraryEntry {
    id: string;
    title: string;
    iconId: string;
    kind: 'normal' | 'opening' | 'history_compaction' | 'hidden_tool_timeline';
    groupId: string;
    content: string;
    openingMessages: SettingLibraryOpeningMessage[];
    defaultOpeningMessageId: string;
    agentSelectionHint: string;
    agentReadStrategy: 'required' | 'keyword' | 'normal';
    dynamicMode: 'standard' | 'ejs_reference';
    contentMode: 'plain_text' | 'ejs';
    keywords: string[];
    keywordScanDepth: number;
    conditionKeywords: string[];
    keywordCondition: 'none' | 'any' | 'all' | 'not_any';
    keywordUseRegex: boolean;
    keywordIgnoreCase: boolean;
    keywordWholeWord: boolean;
    keywordRecursionDepth: number;
    triggerMode: 'always' | 'agent_tool' | null;
    enabled: boolean;
    position: SettingLibraryPosition | null;
    promptPositionId: string;
    insertRole: 'system' | 'user' | 'assistant';
    order: number;
    viewOrder: number;
    groupViewOrder: number;
    treeViewOrder: number;
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:506](../../packages/host/product-api/src/types.ts#L506)

## SettingLibraryEntryChanges

```ts
export type SettingLibraryEntryChanges = Partial<Omit<SettingLibraryEntry, 'id' | 'kind' | 'openingMessages' | 'defaultOpeningMessageId' | 'createdAt' | 'updatedAt'>>;
```

源码：[packages/host/product-api/src/types.ts:550](../../packages/host/product-api/src/types.ts#L550)

## SettingLibraryEntryUpdate

```ts
export interface SettingLibraryEntryUpdate {
    id: string;
    changes: SettingLibraryEntryChanges;
}
```

源码：[packages/host/product-api/src/types.ts:552](../../packages/host/product-api/src/types.ts#L552)

## SettingLibraryGroup

```ts
export interface SettingLibraryGroup {
    id: string;
    name: string;
    parentId: string;
    order: number;
    treeViewOrder: number;
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:540](../../packages/host/product-api/src/types.ts#L540)

## SettingLibraryOpeningMessage

```ts
export interface SettingLibraryOpeningMessage {
    id: string;
    title: string;
    content: string;
    variableVersionId?: string;
    initialVariableStateJson: string;
}
```

源码：[packages/host/product-api/src/types.ts:498](../../packages/host/product-api/src/types.ts#L498)

## SettingLibraryPosition

```ts
export type SettingLibraryPosition = 'instructions' | 'insert_point_1' | 'insert_point_2' | 'insert_point_3' | 'insert_point_4' | 'insert_point_5';
```

源码：[packages/host/product-api/src/types.ts:490](../../packages/host/product-api/src/types.ts#L490)

## SettingLibraryPromptPosition

```ts
export interface SettingLibraryPromptPosition {
    id: string;
    name: string;
    anchor: SettingLibraryPosition;
    side: 'before_setting_position' | 'after_setting_position';
    order: number;
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:554](../../packages/host/product-api/src/types.ts#L554)

## SettingLibraryVersion

```ts
export interface SettingLibraryVersion {
    id: string;
    name: string;
    entries: SettingLibraryEntry[];
    groups: SettingLibraryGroup[];
    promptPositions: SettingLibraryPromptPosition[];
    listAllExpanded: boolean;
    expandedGroupIds: string[];
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:564](../../packages/host/product-api/src/types.ts#L564)

## TavilyConnection

```ts
export interface TavilyConnection {
    ok: true;
    plan: string;
    used: number;
    limit: number;
}
```

源码：[packages/host/product-api/src/types.ts:362](../../packages/host/product-api/src/types.ts#L362)

## VariableConfig

```ts
export interface VariableConfig {
    characterId: string;
    name: string;
    initialStateJson: string;
    schemaCode: string;
    objects: VariableObjectConfig[];
    variables: VariableItemConfig[];
    expandedObjectIds: string[];
    activeVersionId: string;
    versions: VariableConfigVersion[];
}
```

源码：[packages/host/product-api/src/types.ts:642](../../packages/host/product-api/src/types.ts#L642)

## VariableConfigVersion

```ts
export interface VariableConfigVersion {
    id: string;
    name: string;
    initialStateJson: string;
    schemaCode: string;
    objects: VariableObjectConfig[];
    variables: VariableItemConfig[];
    expandedObjectIds: string[];
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:630](../../packages/host/product-api/src/types.ts#L630)

## VariableFloorSnapshot

```ts
export interface VariableFloorSnapshot {
    id: string;
    label: string;
    messagePreview: string;
    createdAt: string;
    state: VariableStateDocument;
    changedValueCount: number;
    changedPaths: string[];
}
```

源码：[packages/host/product-api/src/types.ts:323](../../packages/host/product-api/src/types.ts#L323)

## VariableItemConfig

```ts
export interface VariableItemConfig {
    id: string;
    title: string;
    objectId: string;
    enabled: boolean;
    type: '' | 'number' | 'string' | 'boolean' | 'object' | 'array' | 'null';
    defaultValue: string;
    description: string;
    updateRule: string;
    readMode: 'required' | 'on_demand';
    order: number;
    treeViewOrder: number;
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:614](../../packages/host/product-api/src/types.ts#L614)

## VariableJsonValue

```ts
export type VariableJsonValue = null | boolean | number | string | VariableJsonValue[] | { [key: string]: VariableJsonValue; };
```

源码：[packages/host/product-api/src/types.ts:312](../../packages/host/product-api/src/types.ts#L312)

## VariableObjectConfig

```ts
export interface VariableObjectConfig {
    id: string;
    name: string;
    parentId: string;
    enabled: boolean;
    description: string;
    updateRule: string;
    dynamicKey: boolean;
    order: number;
    treeViewOrder: number;
    createdAt: string;
    updatedAt: string;
}
```

源码：[packages/host/product-api/src/types.ts:600](../../packages/host/product-api/src/types.ts#L600)

## VariableStateDocument

```ts
export interface VariableStateDocument {
    rawJson: string;
    root: { [key: string]: VariableJsonValue; } | null;
    errorMessage: string;
    topLevelCount: number;
    valueCount: number;
}
```

源码：[packages/host/product-api/src/types.ts:315](../../packages/host/product-api/src/types.ts#L315)

## VariableViewerTimeline

```ts
export interface VariableViewerTimeline {
    current: VariableStateDocument;
    floors: VariableFloorSnapshot[];
}
```

源码：[packages/host/product-api/src/types.ts:333](../../packages/host/product-api/src/types.ts#L333)

## WebFetchMode

```ts
export type WebFetchMode = 'http' | 'deepseek_api';
```

源码：[packages/host/product-api/src/types.ts:353](../../packages/host/product-api/src/types.ts#L353)

## WebSearchMode

```ts
export type WebSearchMode = 'provider_native' | 'tavily' | 'deepseek_api';
```

源码：[packages/host/product-api/src/types.ts:352](../../packages/host/product-api/src/types.ts#L352)

## 官方和平台类型

官方类型从其对应的 DSH 公开包入口导入；平台类型使用 TypeScript 标准库。

[锁定版本的官方接口目录](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/docs/subsystems/README.zh.md)

`GenerateOptions`、`RemoteStream`、`Session`
