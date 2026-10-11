<!-- 由 pnpm generate:plugin-docs 使用锁定的 DSH 官方生成器生成，请勿手工修改。 -->

# Client 接口引用的数据类型

以下声明由官方 TypeGraphRenderer 从公开方法引用的类型生成。类型应从对应公开包入口导入，完整设定字段保留在原有结构中。

## CharacterCatalogSnapshot

```ts
export interface CharacterCatalogSnapshot {
    status: 'loading' | 'ready' | 'error';
    collection: CharacterCollection;
    error: string;
}
```

源码：[packages/client/features/dsh-client-characters/src/client/types.ts:4](../../packages/client/features/dsh-client-characters/src/client/types.ts#L4)

## CharacterDownloadResult

```ts
export interface CharacterDownloadResult {
    canceled: false;
    directory: string;
    written: { characterId: string; fileName: string; }[];
    failures: { characterId: string; message: string; }[];
}
```

源码：[packages/client/features/dsh-client-characters/src/client/types.ts:5](../../packages/client/features/dsh-client-characters/src/client/types.ts#L5)

## ClientDisplayPreferencesSnapshot

```ts
export interface ClientDisplayPreferencesSnapshot {
    status: 'loading' | 'ready' | 'error';
    ui: Readonly<Record<string, DisplayPreferenceValue>>;
    chatDisplay: Readonly<Record<string, DisplayPreferenceValue>>;
    writable: boolean;
    revision?: number;
    error: string;
}
```

源码：[packages/client/features/dsh-client-display-preferences/src/client/types.ts:4](../../packages/client/features/dsh-client-display-preferences/src/client/types.ts#L4)

## ClientModelConfig

```ts
export interface ClientModelConfig {
    id: string;
    name?: string;
    provider?: string;
    model?: string;
    model_options?: ClientModelOption[];
    enabled?: boolean;
    base_url?: string;
    api_format?: string;
    api_key?: string;
    custom_headers?: Record<string, string>;
    proxy_url?: string;
    credentialRef?: string;
    credentialConfigured?: boolean;
    clearCredential?: boolean;
    settingsNs?: string;
    settingsPath?: string[];
    clearConfiguration?: boolean;
    image_settings?: Record<string, import('@eleckoi/dsh-product-api/types').VariableJsonValue>;
}
```

源码：[packages/client/features/dsh-client-models/src/client/types.ts:9](../../packages/client/features/dsh-client-models/src/client/types.ts#L9)

## ClientModelOption

```ts
export interface ClientModelOption {
    id: string;
    name: string;
    description?: string;
    inputModalities?: readonly ('text' | 'image')[];
    contextWindowTokens?: number;
    maxOutputTokens?: number;
    supportsImageInput?: boolean;
    reasoningEfforts?: false | Record<string, string | null>;
    reasoningEffort?: string;
    temperature?: number;
    topP?: number;
    autoCompactTokenLimit?: number;
    isUserAdded?: boolean;
}
```

源码：[packages/client/features/dsh-client-models/src/client/types.ts:3](../../packages/client/features/dsh-client-models/src/client/types.ts#L3)

## ConfigurationSnapshot

```ts
export interface ConfigurationSnapshot<T> {
    status: 'idle' | 'loading' | 'ready' | 'error';
    value: T | null;
    error: string;
}
```

源码：[packages/client/features/dsh-client-character-configuration/src/client/types.ts:4](../../packages/client/features/dsh-client-character-configuration/src/client/types.ts#L4)

## ConversationCatalogSnapshot

```ts
export interface ConversationCatalogSnapshot {
    status: 'loading' | 'ready' | 'error';
    items: ConversationSummary[];
    error: string;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:42](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L42)

## ConversationChatSnapshot

```ts
export interface ConversationChatSnapshot {
    details: ConversationDetailsSnapshot;
    stream: ConversationStreamSnapshot;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:57](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L57)

## ConversationClientDetails

```ts
export interface ConversationClientDetails extends Omit<ConversationDetailsMetadata, 'messages'> {
    messages: ConversationClientMessage[];
    replace?: boolean;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:41](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L41)

## ConversationClientMessage

```ts
export interface ConversationClientMessage extends Omit<ConversationMessageMetadata, 'dshTurn'> {
    content?: string;
    displayContent?: string;
    status: 'complete' | 'streaming' | 'error' | 'cancelled';
    sequence?: number;
    productSequence?: number;
    sessionEventSeq?: number;
    dshTurn?: number | null;
    requestId?: string;
    nativeVariableStateJson?: string;
    inputEventSeq?: number;
    process?: ConversationProcessItem[];
    dshMessageId?: string;
    runtimeSessionId?: string;
    renderKey?: string;
    dshNodeKey?: string;
    turnUsage?: TurnTailChatData['tokenUsage'];
    inputImageAttachments?: (ImageAttachmentRef | ConversationPendingImage)[];
    inputFileAttachments?: (FileAttachmentRef | ConversationPendingFile)[];
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:18](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L18)

## ConversationDetailsSnapshot

```ts
export interface ConversationDetailsSnapshot {
    id: string;
    status: 'idle' | 'loading' | 'ready' | 'error';
    details: ConversationClientDetails | null;
    runtimeSessionId?: string;
    error: string;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:43](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L43)

## ConversationGenerationChange

```ts
export interface ConversationGenerationChange {
    conversationId: string;
    runtimeSessionId: string;
    kind: 'live' | 'baseline' | 'released';
    running: boolean;
    events: readonly ConversationGenerationEvent[];
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:47](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L47)

## ConversationGenerationEvent

```ts
export type ConversationGenerationEvent = Extract<SessionEventLike, { type: 'turn/start' | 'turn/end' | 'assistant/message'; }>;
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:45](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L45)

## ConversationGenerationReply

```ts
export type ConversationGenerationReply = { status: 'pending'; } | { status: 'ready'; message: ConversationClientMessage | null; } | { status: 'unavailable'; reason: string; };
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:54](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L54)

## ConversationPendingFile

```ts
export interface ConversationPendingFile {
    attachmentId: string;
    name: string;
    bytes: number;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:16](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L16)

## ConversationPendingImage

```ts
export interface ConversationPendingImage {
    attachmentId: string;
    name: string;
    dataUrl: string;
    width?: number;
    height?: number;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:14](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L14)

## ConversationProcessItem

```ts
export interface ConversationProcessItem {
    id: string;
    kind: 'tool' | 'command' | 'file_change' | 'compaction' | 'subagent' | 'action' | 'narrative' | 'reasoning';
    status: 'running' | 'complete' | 'error' | 'cancelled';
    toolName: string;
    arguments: string;
    summary: string;
    detail: string;
    startedAtMillis: number;
    completedAtMillis?: number;
    parentId?: string;
    delegatedModel?: string;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:12](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L12)

## ConversationRegenerateInput

```ts
export interface ConversationRegenerateInput {
    conversationId: string;
    requestId: string;
    eventSeq: number;
    replacementMessage?: string;
    signal?: AbortSignal;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:72](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L72)

## ConversationRunResult

```ts
export interface ConversationRunResult {
    details: ConversationClientDetails | null;
    cancelled: boolean;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:73](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L73)

## ConversationSelection

```ts
export interface ConversationSelection {
    active_conversation_id: string;
    preferred_sessions: Record<string, string>;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:69](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L69)

## ConversationSendInput

```ts
export interface ConversationSendInput {
    conversationId: string;
    requestId: string;
    text?: string;
    mode?: 'steer' | 'queue';
    signal?: AbortSignal;
    images?: { mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string; name?: string; }[];
    files?: string[];
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:71](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L71)

## ConversationStatsSnapshot

```ts
export interface ConversationStatsSnapshot {
    id: string;
    stats: { sessionStats?: SessionStatsProjection; tokenUsage?: TokenUsageProjection; contextPressure?: ContextPressureProjection; contextBreakdown?: ContextBreakdownProjection; } | null;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:59](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L59)

## ConversationStreamSnapshot

```ts
export interface ConversationStreamSnapshot {
    id: string;
    status: 'idle' | 'running' | 'complete' | 'error';
    runId: string;
    requestId: string;
    messageId: string;
    nodeKey: string;
    dshTurn?: number;
    renderKey?: string;
    sequence: number;
    content: string;
    process: ConversationProcessItem[];
    error: string;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:44](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L44)

## ConversationTimelineSnapshot

```ts
export interface ConversationTimelineSnapshot {
    id: string;
    status: 'idle' | 'loading' | 'ready' | 'error';
    timeline: VariableViewerTimeline | null;
    error: string;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:68](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L68)

## ConversationUploadedFile

```ts
export interface ConversationUploadedFile {
    id: string;
    receiptId: string;
    attachmentId: string;
    name: string;
    bytes: number;
}
```

源码：[packages/client/features/dsh-client-conversations/src/client/types.ts:70](../../packages/client/features/dsh-client-conversations/src/client/types.ts#L70)

## CreatorStudioSnapshot

```ts
export interface CreatorStudioSnapshot {
    status: 'loading' | 'ready' | 'error';
    collection: CreatorProjectCollection;
    error: string;
}
```

源码：[packages/client/features/dsh-client-creator-studio/src/client/types.ts:4](../../packages/client/features/dsh-client-creator-studio/src/client/types.ts#L4)

## ModelCatalogSnapshot

```ts
export interface ModelCatalogSnapshot {
    status: 'loading' | 'ready' | 'error';
    configs: ClientModelConfig[];
    error: string;
}
```

源码：[packages/client/features/dsh-client-models/src/client/types.ts:16](../../packages/client/features/dsh-client-models/src/client/types.ts#L16)

## NativeAuthorChatHandlers

```ts
export type NativeAuthorChatHandlers = Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>;
```

源码：[packages/client/features/dsh-client-author/src/client/types.ts:20](../../packages/client/features/dsh-client-author/src/client/types.ts#L20)

## NativeAuthorPanel

```ts
export interface NativeAuthorPanel extends AuthorScriptPanel {
    key: string;
    conversationId: string;
    scriptKey: string;
    baseUrl: string;
}
```

源码：[packages/client/features/dsh-client-author/src/client/types.ts:11](../../packages/client/features/dsh-client-author/src/client/types.ts#L11)

## NativeAuthorProjectContext

```ts
export type NativeAuthorProjectContext = { projectId: string; entryFile: string; view: string; } & ({ scope: 'application'; } | { scope: 'character'; characterId: string; conversationId?: string; });
```

源码：[packages/client/features/dsh-client-author/src/client/types.ts:21](../../packages/client/features/dsh-client-author/src/client/types.ts#L21)

## NativeAuthorRuntimeSnapshot

```ts
export interface NativeAuthorRuntimeSnapshot {
    status: 'idle' | 'starting' | 'ready' | 'error' | 'closed';
    conversationId: string;
    error: string;
    scriptStatuses: Record<string, AuthorScriptStatus & { scope: string; ownerId: string; source: string; }>;
}
```

源码：[packages/client/features/dsh-client-author/src/client/types.ts:4](../../packages/client/features/dsh-client-author/src/client/types.ts#L4)

## NativeAuthorUiSnapshot

```ts
export interface NativeAuthorUiSnapshot {
    buttons: Array<{ key: string; id: string; label: string; scriptKey: string; scriptName: string; scope: string; conversationId: string; busy: boolean; error: string; }>;
    panel: NativeAuthorPanel | null;
}
```

源码：[packages/client/features/dsh-client-author/src/client/types.ts:14](../../packages/client/features/dsh-client-author/src/client/types.ts#L14)

## PersonaSnapshot

```ts
export interface PersonaSnapshot {
    status: 'loading' | 'ready' | 'error';
    profile: PersonaProfile | null;
    error: string;
}
```

源码：[packages/client/features/dsh-client-persona/src/client/types.ts:4](../../packages/client/features/dsh-client-persona/src/client/types.ts#L4)

## PresetCatalogSnapshot

```ts
export interface PresetCatalogSnapshot {
    status: 'loading' | 'ready' | 'error';
    catalog: AgentPresetCatalog | null;
    error: string;
}
```

源码：[packages/client/features/dsh-client-presets/src/client/types.ts:4](../../packages/client/features/dsh-client-presets/src/client/types.ts#L4)

## PresetDetailSnapshot

```ts
export interface PresetDetailSnapshot {
    status: 'idle' | 'ready' | 'error';
    preset: AgentPreset | null;
    error: string;
}
```

源码：[packages/client/features/dsh-client-presets/src/client/types.ts:5](../../packages/client/features/dsh-client-presets/src/client/types.ts#L5)

## WebSearchSnapshot

```ts
export interface WebSearchSnapshot {
    status: 'loading' | 'ready' | 'error';
    mode: WebSearchMode;
    maxResults: number;
    apiKeyConfigured: boolean;
    apiKeyRef: string;
    apiKeyWritable: boolean;
    writable: boolean;
    tavilyAvailable: boolean;
    revision?: number;
    error: string;
}
```

源码：[packages/client/features/dsh-client-web-search/src/client/types.ts:4](../../packages/client/features/dsh-client-web-search/src/client/types.ts#L4)

## 官方和平台类型

官方类型从其对应的 DSH 公开包入口导入；平台类型使用 TypeScript 标准库。

[锁定版本的官方接口目录](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/docs/subsystems/README.zh.md)

`GenerateOptions`、`RemoteStream`、`Session`
