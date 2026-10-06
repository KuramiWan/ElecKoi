<!-- 由 pnpm generate:plugin-docs 使用锁定的 DSH 官方生成器生成，请勿手工修改。 -->

# Host 接口引用的数据类型

以下声明由官方 TypeGraphRenderer 从公开方法引用的类型生成。类型应从对应公开包入口导入，完整设定字段保留在原有结构中。

## AgentPreset

```ts
export interface AgentPreset {
    id: string;
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
    roleplayPlan: { steps: string[]; };
    regexRules: RegexRule[];
    expandedGroupIds: string[];
}
```

源码：[packages/dsh-product-api/src/types.ts:628](../../packages/dsh-product-api/src/types.ts#L628)

## AgentPresetCatalog

```ts
export interface AgentPresetCatalog {
    activePresetId: string;
    groups: AgentPresetLibraryGroup[];
    presets: AgentPresetSummary[];
}
```

源码：[packages/dsh-product-api/src/types.ts:607](../../packages/dsh-product-api/src/types.ts#L607)

## AgentPresetExportFormat

```ts
export type AgentPresetExportFormat = 'json' | 'png';
```

源码：[packages/dsh-product-api/src/types.ts:567](../../packages/dsh-product-api/src/types.ts#L567)

## AgentPresetExportResult

```ts
export interface AgentPresetExportResult {
    fileName: string;
    mimeType: string;
    base64: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:659](../../packages/dsh-product-api/src/types.ts#L659)

## AgentPresetImportDocument

```ts
export interface AgentPresetImportDocument {
    displayName: string;
    mimeType: string;
    base64: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:646](../../packages/dsh-product-api/src/types.ts#L646)

## AgentPresetImportResult

```ts
export interface AgentPresetImportResult {
    preset: AgentPreset;
    source: AgentPresetImportSource;
    skippedUnsupportedEntries: number;
    skippedDepthRegexCount: number;
}
```

源码：[packages/dsh-product-api/src/types.ts:652](../../packages/dsh-product-api/src/types.ts#L652)

## AgentPresetImportSource

```ts
export type AgentPresetImportSource = 'eleckoi' | 'sillytavern';
```

源码：[packages/dsh-product-api/src/types.ts:566](../../packages/dsh-product-api/src/types.ts#L566)

## AgentPresetLibraryGroup

```ts
export interface AgentPresetLibraryGroup {
    id: string;
    name: string;
    sortIndex: number;
}
```

源码：[packages/dsh-product-api/src/types.ts:589](../../packages/dsh-product-api/src/types.ts#L589)

## AgentPresetModelFamily

```ts
export type AgentPresetModelFamily = 'general' | 'claude' | 'openai' | 'gemini' | 'deepseek' | 'other';
```

源码：[packages/dsh-product-api/src/types.ts:565](../../packages/dsh-product-api/src/types.ts#L565)

## AgentPresetModelTag

```ts
export interface AgentPresetModelTag {
    id: string;
    label: string;
    providerId: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:569](../../packages/dsh-product-api/src/types.ts#L569)

## AgentPresetProfile

```ts
export interface AgentPresetProfile {
    authorName: string;
    authorAvatarPath: string;
    usageInstructions: string;
    timeline: AgentPresetTimelineItem[];
}
```

源码：[packages/dsh-product-api/src/types.ts:582](../../packages/dsh-product-api/src/types.ts#L582)

## AgentPresetSummary

```ts
export interface AgentPresetSummary {
    id: string;
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

源码：[packages/dsh-product-api/src/types.ts:595](../../packages/dsh-product-api/src/types.ts#L595)

## AgentPresetTimelineItem

```ts
export interface AgentPresetTimelineItem {
    id: string;
    title: string;
    dateLabel: string;
    note: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:575](../../packages/dsh-product-api/src/types.ts#L575)

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

源码：[packages/dsh-product-api/src/types.ts:618](../../packages/dsh-product-api/src/types.ts#L618)

## AgentToolMember

```ts
export interface AgentToolMember {
    name: string;
    description: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:613](../../packages/dsh-product-api/src/types.ts#L613)

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

源码：[packages/dsh-product-api/src/types.ts:210](../../packages/dsh-product-api/src/types.ts#L210)

## CharacterCollection

```ts
export interface CharacterCollection {
    active_character_id: string;
    groups: string[];
    items: CharacterRecord[];
}
```

源码：[packages/dsh-product-api/src/types.ts:283](../../packages/dsh-product-api/src/types.ts#L283)

## CharacterConfigurationChange

```ts
export type CharacterConfigurationChange = { kind: 'snapshot'; } | { kind: 'configuration'; domain: 'settingLibraries' | 'variables' | 'regexRules' | 'agentPresets'; characterId?: string; };
```

源码：[packages/dsh-product-api/src/types.ts:83](../../packages/dsh-product-api/src/types.ts#L83)

## CharacterExportFormat

```ts
export type CharacterExportFormat = 'png' | 'json';
```

源码：[packages/dsh-product-api/src/types.ts:295](../../packages/dsh-product-api/src/types.ts#L295)

## CharacterExportResult

```ts
export interface CharacterExportResult {
    fileName: string;
    mimeType: 'image/png' | 'application/json';
    base64: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:323](../../packages/dsh-product-api/src/types.ts#L323)

## CharacterGroupAssignment

```ts
export interface CharacterGroupAssignment {
    characterId: string;
    group: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:289](../../packages/dsh-product-api/src/types.ts#L289)

## CharacterImportFile

```ts
export interface CharacterImportFile {
    displayName: string;
    mimeType: string;
    base64: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:297](../../packages/dsh-product-api/src/types.ts#L297)

## CharacterImportPreview

```ts
export interface CharacterImportPreview {
    token: string;
    items: CharacterImportPreviewItem[];
}
```

源码：[packages/dsh-product-api/src/types.ts:312](../../packages/dsh-product-api/src/types.ts#L312)

## CharacterImportPreviewItem

```ts
export interface CharacterImportPreviewItem {
    id: string;
    name: string;
    summary: string;
    imageAvailable: boolean;
    errorMessage: string;
    importable: boolean;
}
```

源码：[packages/dsh-product-api/src/types.ts:303](../../packages/dsh-product-api/src/types.ts#L303)

## CharacterImportResult

```ts
export interface CharacterImportResult {
    collection: CharacterCollection;
    importedCharacterIds: string[];
    failedMessages: string[];
}
```

源码：[packages/dsh-product-api/src/types.ts:317](../../packages/dsh-product-api/src/types.ts#L317)

## CharacterImportSource

```ts
export type CharacterImportSource = 'eleckoi' | 'sillytavern';
```

源码：[packages/dsh-product-api/src/types.ts:294](../../packages/dsh-product-api/src/types.ts#L294)

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

源码：[packages/dsh-product-api/src/types.ts:246](../../packages/dsh-product-api/src/types.ts#L246)

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

源码：[packages/dsh-product-api/src/types.ts:260](../../packages/dsh-product-api/src/types.ts#L260)

## ConversationChange

```ts
export type ConversationChange = { kind: 'snapshot'; } | { kind: 'generation'; conversationId: string; error: string; } | { kind: 'catalog'; conversationId: string; reason: 'created' | 'deleted'; } | { kind: 'messages'; conversationId: string; reason: 'edited' | 'deleted' | 'regenerated'; messageIds: string[]; };
```

源码：[packages/dsh-product-api/src/types.ts:72](../../packages/dsh-product-api/src/types.ts#L72)

## ConversationCreateInput

```ts
export interface ConversationCreateInput {
    title?: string;
    metadata?: Partial<ConversationMetadata>;
}
```

源码：[packages/dsh-product-api/src/types.ts:54](../../packages/dsh-product-api/src/types.ts#L54)

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

源码：[packages/dsh-product-api/src/types.ts:145](../../packages/dsh-product-api/src/types.ts#L145)

## ConversationLifecycleParticipant

```ts
export interface ConversationLifecycleParticipant {
    readonly id: string;
    prepare?(input: ConversationPreparation, signal: AbortSignal): void | Promise<void>;
    afterSave?(input: ConversationSave, signal: AbortSignal): void | Promise<void>;
    prepareRestore?(input: ConversationRestore, signal: AbortSignal): ConversationRestorePlan | Promise<ConversationRestorePlan>;
}
```

源码：[packages/dsh-product-api/src/conversationLifecycle.ts:41](../../packages/dsh-product-api/src/conversationLifecycle.ts#L41)

## ConversationMessageDisplayInput

```ts
export interface ConversationMessageDisplayInput {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    variableStateJson: string;
    status: 'complete' | 'streaming' | 'error' | 'cancelled';
    createdAt: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:157](../../packages/dsh-product-api/src/types.ts#L157)

## ConversationMessageDisplayResult

```ts
export interface ConversationMessageDisplayResult {
    id: string;
    sourceContent: string;
    displayContent: string;
    variableStateJson: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:167](../../packages/dsh-product-api/src/types.ts#L167)

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

源码：[packages/dsh-product-api/src/types.ts:111](../../packages/dsh-product-api/src/types.ts#L111)

## ConversationMetadata

```ts
export interface ConversationMetadata {
    characterId: string;
    characterName: string;
    characterAvatar: string;
    characterPersona: CharacterPersona;
}
```

源码：[packages/dsh-product-api/src/types.ts:47](../../packages/dsh-product-api/src/types.ts#L47)

## ConversationModelSelection

```ts
export interface ConversationModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:33](../../packages/dsh-product-api/src/types.ts#L33)

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

源码：[packages/dsh-product-api/src/types.ts:101](../../packages/dsh-product-api/src/types.ts#L101)

## ConversationPreparation

```ts
export interface ConversationPreparation {
    readonly operationId: string;
    readonly conversationId: string;
    readonly runtimeSessionId: string;
    readonly turn: number;
    readonly text: string;
    readonly model: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string; };
    readonly runtime: Readonly<ConversationRuntimePreparation>;
}
```

源码：[packages/dsh-product-api/src/conversationLifecycle.ts:13](../../packages/dsh-product-api/src/conversationLifecycle.ts#L13)

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

源码：[packages/dsh-product-api/src/types.ts:39](../../packages/dsh-product-api/src/types.ts#L39)

## ConversationRestore

```ts
export interface ConversationRestore {
    readonly operationId: string;
    readonly conversationId: string;
    readonly runtimeSessionId: string;
    readonly reason: 'delete-messages' | 'regenerate';
    readonly fromTurn: number;
    readonly fromEventSeq: number;
    readonly state: Readonly<ConversationRuntimeStateSnapshot>;
}
```

源码：[packages/dsh-product-api/src/conversationLifecycle.ts:24](../../packages/dsh-product-api/src/conversationLifecycle.ts#L24)

## ConversationRestorePlan

```ts
export interface ConversationRestorePlan {
    apply(): void | Promise<void>;
    rollback(): void | Promise<void>;
}
```

源码：[packages/dsh-product-api/src/conversationLifecycle.ts:35](../../packages/dsh-product-api/src/conversationLifecycle.ts#L35)

## ConversationRuntimePreparation

```ts
export interface ConversationRuntimePreparation {
    conversationId: string;
    runtimeSessionId: string;
    variableContext?: { initialStateJson: string; schemaCode: string; objects: VariableObjectConfig[]; variables: VariableItemConfig[]; stateJson: string; };
    conversationContext: { characterId: string; characterName: string; persona: Record<string, unknown>; history: Array<{ role: 'user' | 'assistant'; content: string; speakerName?: string; }>; historyMode: 'prefix'; currentPromptText: string; settingLibrary?: ConversationRuntimeSettingLibrary; };
    disabledToolGroupIds: string[];
    agentPreset: { id: string; versionId: string; name: string; roleplayPlan: { steps: string[]; }; historyCompactionInstructions?: string; };
    settingLibraryBaseline?: { source: ConversationRuntimeSettingLibrary; projected: ConversationRuntimeSettingLibrary; };
}
```

源码：[packages/dsh-product-api/src/types.ts:673](../../packages/dsh-product-api/src/types.ts#L673)

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

源码：[packages/dsh-product-api/src/types.ts:665](../../packages/dsh-product-api/src/types.ts#L665)

## ConversationRuntimeStateSnapshot

```ts
export interface ConversationRuntimeStateSnapshot {
    variableStateJson: string;
    settingLibraryStateJson: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:140](../../packages/dsh-product-api/src/types.ts#L140)

## ConversationSave

```ts
export interface ConversationSave {
    readonly operationId: string;
    readonly conversationId: string;
    readonly runtimeSessionId: string;
    readonly turn: number;
}
```

源码：[packages/dsh-product-api/src/conversationLifecycle.ts:5](../../packages/dsh-product-api/src/conversationLifecycle.ts#L5)

## ConversationSummary

```ts
export interface ConversationSummary extends ConversationRecord {
    metadata: ConversationMetadata;
    runtimeSessionId: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:59](../../packages/dsh-product-api/src/types.ts#L59)

## CreateCreatorProjectInput

```ts
export interface CreateCreatorProjectInput {
    name: string;
    mode: CreatorProjectMode;
    parentDirectory: string;
    sourceCharacterId?: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:346](../../packages/dsh-product-api/src/types.ts#L346)

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

源码：[packages/dsh-product-api/src/types.ts:331](../../packages/dsh-product-api/src/types.ts#L331)

## CreatorProjectCollection

```ts
export interface CreatorProjectCollection {
    items: CreatorProject[];
}
```

源码：[packages/dsh-product-api/src/types.ts:342](../../packages/dsh-product-api/src/types.ts#L342)

## CreatorProjectMode

```ts
export type CreatorProjectMode = 'blank' | 'existing';
```

源码：[packages/dsh-product-api/src/types.ts:329](../../packages/dsh-product-api/src/types.ts#L329)

## DisplayPreferencesSnapshot

```ts
export interface DisplayPreferencesSnapshot {
    ui: Record<string, DisplayPreferenceValue>;
    chatDisplay: Record<string, DisplayPreferenceValue>;
    writable: boolean;
    revision: number;
}
```

源码：[packages/dsh-product-api/src/types.ts:808](../../packages/dsh-product-api/src/types.ts#L808)

## DisplayPreferenceValue

```ts
export type DisplayPreferenceValue = null | boolean | number | string | DisplayPreferenceValue[] | { [key: string]: DisplayPreferenceValue; };
```

源码：[packages/dsh-product-api/src/types.ts:805](../../packages/dsh-product-api/src/types.ts#L805)

## ElecKoiHostStatus

```ts
export interface ElecKoiHostStatus {
    architecture: 'dsh-remote';
    protocolVersion: 1;
}
```

源码：[packages/dsh-product-api/src/types.ts:1](../../packages/dsh-product-api/src/types.ts#L1)

## ModelConnectionInput

```ts
export interface ModelConnectionInput {
    configId: string;
    model: string;
    baseURL: string;
    api: string;
    apiKey?: string;
    headers?: Record<string, string>;
}
```

源码：[packages/dsh-product-api/src/types.ts:6](../../packages/dsh-product-api/src/types.ts#L6)

## ModelDiscoveryInput

```ts
export interface ModelDiscoveryInput {
    configId: string;
    baseURL: string;
    api: string;
    apiKey?: string;
    headers?: Record<string, string>;
}
```

源码：[packages/dsh-product-api/src/types.ts:15](../../packages/dsh-product-api/src/types.ts#L15)

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

源码：[packages/dsh-product-api/src/types.ts:23](../../packages/dsh-product-api/src/types.ts#L23)

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

源码：[packages/dsh-product-api/src/types.ts:233](../../packages/dsh-product-api/src/types.ts#L233)

## ProductRecordChange

```ts
export type ProductRecordChange = { kind: 'snapshot'; } | { kind: 'records'; domain: 'characters' | 'persona' | 'creatorProjects'; ids?: string[]; };
```

源码：[packages/dsh-product-api/src/types.ts:91](../../packages/dsh-product-api/src/types.ts#L91)

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
}
```

源码：[packages/dsh-product-api/src/types.ts:514](../../packages/dsh-product-api/src/types.ts#L514)

## RegexRuleCollection

```ts
export interface RegexRuleCollection {
    characterId: string;
    agentPresetId: string;
    agentPresetName: string;
    agentPresetRegexRevision: string;
    globalRules: RegexRule[];
    agentPresetRules: RegexRule[];
    characterRules: RegexRule[];
    versions: RegexRuleVersion[];
    activeVersionId: string;
    revision: number;
}
```

源码：[packages/dsh-product-api/src/types.ts:535](../../packages/dsh-product-api/src/types.ts#L535)

## RegexRuleImportDocument

```ts
export interface RegexRuleImportDocument {
    displayName: string;
    json: string;
}
```

源码：[packages/dsh-product-api/src/types.ts:548](../../packages/dsh-product-api/src/types.ts#L548)

## RegexRuleImportResult

```ts
export interface RegexRuleImportResult {
    collection: RegexRuleCollection;
    importedFileCount: number;
    importedRuleCount: number;
    failedFileNames: string[];
}
```

源码：[packages/dsh-product-api/src/types.ts:553](../../packages/dsh-product-api/src/types.ts#L553)

## RegexRuleScope

```ts
export type RegexRuleScope = 'Global' | 'AgentPreset' | 'Character';
```

源码：[packages/dsh-product-api/src/types.ts:511](../../packages/dsh-product-api/src/types.ts#L511)

## RegexRuleTarget

```ts
export type RegexRuleTarget = 'UserInput' | 'AiOutput' | 'SlashCommand' | 'SettingContent' | 'Reasoning';
```

源码：[packages/dsh-product-api/src/types.ts:512](../../packages/dsh-product-api/src/types.ts#L512)

## RegexRuleTestResult

```ts
export interface RegexRuleTestResult {
    output: string;
    validationMessage: string | null;
}
```

源码：[packages/dsh-product-api/src/types.ts:560](../../packages/dsh-product-api/src/types.ts#L560)

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

源码：[packages/dsh-product-api/src/types.ts:527](../../packages/dsh-product-api/src/types.ts#L527)

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

源码：[packages/dsh-product-api/src/types.ts:435](../../packages/dsh-product-api/src/types.ts#L435)

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

源码：[packages/dsh-product-api/src/types.ts:447](../../packages/dsh-product-api/src/types.ts#L447)

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

源码：[packages/dsh-product-api/src/types.ts:369](../../packages/dsh-product-api/src/types.ts#L369)

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

源码：[packages/dsh-product-api/src/types.ts:403](../../packages/dsh-product-api/src/types.ts#L403)

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

源码：[packages/dsh-product-api/src/types.ts:361](../../packages/dsh-product-api/src/types.ts#L361)

## SettingLibraryPosition

```ts
export type SettingLibraryPosition = 'instructions' | 'insert_point_1' | 'insert_point_2' | 'insert_point_3' | 'insert_point_4' | 'insert_point_5';
```

源码：[packages/dsh-product-api/src/types.ts:353](../../packages/dsh-product-api/src/types.ts#L353)

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

源码：[packages/dsh-product-api/src/types.ts:413](../../packages/dsh-product-api/src/types.ts#L413)

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

源码：[packages/dsh-product-api/src/types.ts:423](../../packages/dsh-product-api/src/types.ts#L423)

## TavilyConnection

```ts
export interface TavilyConnection {
    ok: true;
    plan: string;
    used: number;
    limit: number;
}
```

源码：[packages/dsh-product-api/src/types.ts:226](../../packages/dsh-product-api/src/types.ts#L226)

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

源码：[packages/dsh-product-api/src/types.ts:499](../../packages/dsh-product-api/src/types.ts#L499)

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

源码：[packages/dsh-product-api/src/types.ts:487](../../packages/dsh-product-api/src/types.ts#L487)

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

源码：[packages/dsh-product-api/src/types.ts:195](../../packages/dsh-product-api/src/types.ts#L195)

## VariableItemConfig

```ts
export interface VariableItemConfig {
    id: string;
    title: string;
    objectId: string;
    enabled: boolean;
    type: '' | 'number' | 'string' | 'boolean' | 'array';
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

源码：[packages/dsh-product-api/src/types.ts:471](../../packages/dsh-product-api/src/types.ts#L471)

## VariableJsonValue

```ts
export type VariableJsonValue = null | boolean | number | string | VariableJsonValue[] | { [key: string]: VariableJsonValue; };
```

源码：[packages/dsh-product-api/src/types.ts:184](../../packages/dsh-product-api/src/types.ts#L184)

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

源码：[packages/dsh-product-api/src/types.ts:457](../../packages/dsh-product-api/src/types.ts#L457)

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

源码：[packages/dsh-product-api/src/types.ts:187](../../packages/dsh-product-api/src/types.ts#L187)

## VariableViewerTimeline

```ts
export interface VariableViewerTimeline {
    current: VariableStateDocument;
    floors: VariableFloorSnapshot[];
}
```

源码：[packages/dsh-product-api/src/types.ts:205](../../packages/dsh-product-api/src/types.ts#L205)

## WebSearchMode

```ts
export type WebSearchMode = 'provider_native' | 'tavily';
```

源码：[packages/dsh-product-api/src/types.ts:224](../../packages/dsh-product-api/src/types.ts#L224)
