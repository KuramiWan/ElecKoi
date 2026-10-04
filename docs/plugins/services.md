# 服务接口

Service 是 Cordis Context 上的稳定能力。提供方用 `ctx.provide()` 或 `ctx.reflect.provide()` 注册，使用方用 `inject` 声明依赖，然后从 `ctx.<key>` 调用。

```js
return {
  inject: ['eleckoiCharacters'],
  apply(ctx) {
    const stop = ctx.eleckoiCharacters.subscribe(() => {
      console.log(ctx.eleckoiCharacters.getSnapshot())
    })
    return stop
  }
}
```

不要导入 service 的实现 class，也不要通过全局变量寻找 service。`getSnapshot`/`subscribe` 对遵循 React `useSyncExternalStore` 语义：snapshot 在无变化时保持同一引用，subscribe 返回取消订阅函数。

当前登记 **13 个 service**。

## `eleckoiCharacters`（Client）

角色目录的只读快照和刷新入口。

```ts
interface ElecKoiCharacters {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'error'
    collection: {
      active_character_id: string
      groups: string[]
      items: Array<{ id: string; [key: string]: unknown }>
    }
    error: string
  }
  subscribe(listener: () => void): () => void
  refresh(): Promise<ElecKoiCharacters['getSnapshot'] extends () => infer S
    ? S extends { collection: infer C } ? C : never : never>
}
```

写操作由角色页面 owner actions 或对应正式命令完成，目录 service 本身不提供任意写入。

## 角色配置服务（Client）

三个 service 都以 `characterId` 为 key 保存独立快照。公共模式：

```ts
interface CharacterConfigurationService<T> {
  getSnapshot(characterId: string): { status: 'idle' | 'loading' | 'ready' | 'error'; value: T | null; error: string }
  subscribe(listener: (kind: string, characterId: string, snapshot: unknown) => void): () => void
  read(characterId: string): Promise<T>
  readUntracked(characterId: string): Promise<T>
  save(characterId: string, value: T): Promise<T>
  saveViewState(characterId: string, expandedIds: string[]): Promise<unknown>
}
```

### `eleckoiSettingLibraries`

在公共模式之外提供：

```ts
getConversationSnapshot(characterId: string): ConfigurationSnapshot<unknown[]>
readConversations(characterId: string): Promise<unknown[]>
saveConversation(characterId: string, sessionId: string, library: unknown): Promise<unknown>
resetConversation(characterId: string, sessionId: string): Promise<unknown>
saveConversationVersion(characterId: string, sessionId: string, name: string): Promise<unknown>
```

角色母设定与聊天分支设定分开存储；`sessionId` 使用列表返回的目标聊天 ID。聊天不预建分支：只有修改设定工具产生真实变更且数据库提交成功后才自动出现，失败、无变化和只读调用都不会创建。界面保存只编辑已有分支。分支只保存条目、文件夹的变更及删除标记，工具搜索和读取使用母设定叠加当前聊天变更后的有效库，不读取轨迹日志来恢复设定。

### `eleckoiVariables`

实现公共模式，用于角色变量对象、变量值、版本和展开状态。

### `eleckoiRegexRules`

`save()` 使用 collection 的 `revision` 做并发校验，并增加：

```ts
import(characterId: string, collection: unknown, fallbackScope: string, documents: unknown[]): Promise<unknown>
export(characterId: string, ruleIds: string[]): Promise<unknown>
test(text: string, rule: unknown, target: unknown): Promise<unknown>
```

## `eleckoiConversations`（Client）

管理聊天目录、当前消息详情、轨迹和正在生成的临时状态。

```ts
interface ElecKoiConversations {
  getSnapshot(): ConversationCatalogSnapshot
  subscribe(listener: () => void): () => void
  getDetailsSnapshot(): ConversationDetailsSnapshot
  subscribeDetails(listener: () => void): () => void
  getTimelineSnapshot(): ConversationTimelineSnapshot
  subscribeTimeline(listener: () => void): () => void
  getStreamSnapshot(): ConversationStreamSnapshot
  subscribeStream(listener: () => void): () => void

  refresh(): Promise<unknown[]>
  open(conversationId: string): Promise<unknown | null>
  pageOlder(expectedId: string, expectedBeforeSequence: number): Promise<unknown | null>
  openTimeline(conversationId: string): Promise<unknown | null>
  closeTimeline(conversationId: string): void

  uploadFile(
    conversationId: string,
    file: File,
    options?: { signal?: AbortSignal; onProgress?: (progress: { loaded: number; total?: number }) => void }
  ): Promise<{ id: string; receiptId: string; attachmentId: string; name: string; bytes: number }>

  send(input: { conversationId: string; requestId: string; text: string; [key: string]: unknown }): Promise<unknown>
  regenerate(input: { conversationId: string; requestId: string; eventSeq: number; [key: string]: unknown }): Promise<unknown>
  cancelRequest(conversationId: string, requestId: string): Promise<boolean>

  rememberSession(characterId: string, sessionId: string): void
  preferredSession(characterId: string): string
  forgetSession(characterId: string, sessionId: string): void
}
```

`uploadFile()` 使用 DSH 官方 `ctx.fileUpload`，返回仅限当前 DSH Session 使用的一次性 receipt；`send()` 把 receipt 交给同一 Session 的 prompt，文件的持久引用随后从正式 `user/message` 投影。上传中的操作可由 `AbortSignal` 取消，Client 不经过 Desktop Gateway 或本地文件草稿协议。`rememberSession` 只维护当前 Client 进程的角色偏好映射，不是聊天数据存储 API。

## `eleckoiCreatorStudio`（Client）

管理创作项目文件目录。项目清单和项目清单文件由 DSH Host 读写；Client 不访问本地文件系统，也不把项目目录保存到 SQLite。

```ts
interface ElecKoiCreatorStudio {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'error'
    collection: {
      items: Array<{
        id: string
        name: string
        mode: 'blank' | 'existing'
        rootPath: string
        sourceCharacterId: string
        coverImage: string
        createdAt: string
        updatedAt: string
      }>
    }
    error: string
  }
  subscribe(listener: () => void): () => void
  refresh(): Promise<ReturnType<ElecKoiCreatorStudio['getSnapshot']>['collection']>
  create(input: {
    name: string
    mode: 'blank' | 'existing'
    parentDirectory: string
    sourceCharacterId?: string
  }): Promise<ReturnType<ElecKoiCreatorStudio['getSnapshot']>['collection']>
  delete(projectId: string): Promise<ReturnType<ElecKoiCreatorStudio['getSnapshot']>['collection']>
  selectDirectory(signal?: AbortSignal): Promise<string | null>
}
```

`selectDirectory()` 调用锁定版本 DSH 的 `ctx.remote.directoryPicker.pick()`，返回 Host 上的绝对目录或取消后的 `null`。调用方应在窗口关闭时中止信号；Client 插件卸载也会取消所有未完成选择。项目页面不再依赖 Electron 私有业务桥。桌面 profile 由官方自适应目录选择插件提供本机选择器，远程 browse backend 不支持此本机操作时返回官方错误。

## `eleckoiModels`（Client）

```ts
interface ElecKoiModels {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'error'
    configs: Array<{ id: string; provider: string; model: string; [key: string]: unknown }>
    error: string
  }
  subscribe(listener: () => void): () => void
  refresh(): Promise<unknown[]>
  save(config: ModelConfigDraft): Promise<ModelConfig>
  deleteConfig(id: string): Promise<ModelConfig | undefined>
  deleteProvider(provider: string, preferredId?: string): Promise<ModelConfig | undefined>
  discover(config: ModelConfigDraft): Promise<ModelOption[]>
  testConnection(config: ModelConfigDraft): Promise<{ supported: true }>
}
```

这个 service 挂载 ElecKoi 自定义模型配置界面，并调用官方 `ctx.remote.settings`、`ctx.remote.llm` 与 `ctx.remote.credentials`。通用协议保存在 `llm-pi-ai` 的显式 provider profile 中，DeepSeek 专用协议使用其官方 adapter 设置。密钥只进入 Credentials；Client 快照只返回是否已经配置密钥，不返回密钥正文。

`ModelConfigDraft` 使用配置界面的字段：`id`、`provider`、`name`、`model`、`api_format`、`base_url`、`api_key`、`custom_headers` 和 `model_options`。`api_key` 留空保留现有密钥；仅清除密钥时传 `clearCredential: true`。清空整个配置时传 `clearConfiguration: true`：通用配置删除其 profile，内置 DeepSeek 配置撤销端点和模型覆盖，恢复官方默认值；同时删除产品参数及未被其他配置引用的密钥。模型参数包含 `temperature`、`autoCompactTokenLimit`、`reasoningEffort`、`contextWindowTokens`、`maxOutputTokens`、`supportsImageInput` 与官方能力或显式 profile 声明的 `reasoningEfforts`。`ModelConfig` 为上述字段加 `credentialConfigured`、`settingsNs`、`settingsPath` 的读取快照，`api_key` 始终为空。

产品专有参数保存在该插件的 `eleckoi-client-models` Settings namespace，Host 请求插件读取并应用到官方 LLM 请求和压缩策略；不存入模型数据库。当前 DSH 合同不支持 Top P 和每个配置独立代理，保存非空值会明确报错。

`discover` 使用官方模型发现接口；返回模型 ID 不表示已经确认推理档位。`testConnection` 经生成的 `ctx.remote.eleckoiModels.testConnection` 调用 Host 官方 LLM adapter，只验证本次指定工具的调用和参数，不创建 Agent、Session 或聊天日志，也不保存测试草稿。一次未调用工具不能据此断定模型不支持工具调用。

## `eleckoiPersona`（Client）

```ts
interface ElecKoiPersona {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'error'
    profile: null | {
      user_name: string
      user_avatar: string
      user_square: string
      user_portrait: string
      [key: string]: unknown
    }
    error: string
  }
  subscribe(listener: () => void): () => void
  refresh(): Promise<NonNullable<ReturnType<ElecKoiPersona['getSnapshot']>['profile']>>
  save(profile: NonNullable<ReturnType<ElecKoiPersona['getSnapshot']>['profile']>): Promise<NonNullable<ReturnType<ElecKoiPersona['getSnapshot']>['profile']>>
}
```

资料界面可以通过 `eleckoi.persona.editor` owner actions 保存；Client service 内部使用生成的 `ctx.remote.eleckoiPersona.save()`，插件不接触 SQLite 或旧桥。

## `eleckoiPresets`（Client）

```ts
interface ElecKoiPresets {
  getSnapshot(): { status: string; catalog: unknown | null; error: string }
  subscribe(listener: () => void): () => void
  getDetailSnapshot(id: string): { status: string; preset: unknown | null; error: string }
  subscribeDetail(id: string, listener: () => void): () => void
  read(id: string): Promise<unknown>
  save(preset: { id: string; [key: string]: unknown }, expectedRegexRules: unknown): Promise<unknown>
  refresh(): Promise<unknown>
}
```

`save()` 同时提交预设和调用方看到的正则规则基线，用于保持预设与正则更新一致。

## `layout`（Client）

该 key 对齐 DSH 官方布局 service。正式类型来自 `@deepseek-ai/dsh-client-ui-layout/client`；ElecKoi 公开使用以下成员：

```ts
interface LayoutService {
  selectPanel(id: string | null): void
  beginNavigation(): AbortSignal
  toggleSidebar(): void
  openRightbar(): void
  closeRightbar(): void
}
```

`selectPanel` 只接受已经注册到 `main` keyed slot 的面板 key。`beginNavigation` 会中止上一次导航信号，适合取消面板切换中的异步工作。

## `eleckoiSessionEditor`（Host）

通过正式 DSH Session 日志编辑消息与回退轮次：

```ts
interface ElecKoiSessionEditor {
  editMessage(
    sessionId: string,
    messageId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void>

  rewind(sessionId: string, fromTurn: number): Promise<number | undefined>
}
```

两项操作都会先关闭该 Session 的活动写句柄，再用当前 session-format 处理。`rewind()` 在 Session 不存在或当前日志无法回退时返回 `undefined`。

它是 Host service，不能直接在 Client 中注入。需要 Client 调用的新增后台能力应建立 DSH Remote 合同，不要暴露 Node 对象或私有桥。

## `theme`（Client）

界面主题由 DSH 官方 `@deepseek-ai/dsh-client-ui-theme` 提供。Client 插件声明 `inject: ['theme']` 后，通过 `ctx.theme` 读取或切换主题，并通过 `theme/change` 事件持续同步：

```ts
const snapshot = ctx.theme.getTheme()
ctx.theme.setTheme('system')
ctx.on('theme/change', (next) => {
  console.log(next.preference, next.active.colorScheme)
})
```

`preference` 可以是 `light`、`dark`、`system` 或当前已注册的第三方主题 ID。持久化由 DSH 的 `ui-theme` settings namespace 负责。ElecKoi 不另存主题到 SQLite，也不提供桌面 Gateway 主题命令。Electron 壳只观察 DSH 写入的 `html[data-ds-theme-source]`，让原生窗口配色跟随同一主题状态。

## `eleckoiWebSearch`（Client）

由 `@eleckoi/dsh-client-web-search` 提供。调用方声明 `inject: ['eleckoiWebSearch']`，通过该 model 读取搜索方式、Tavily 设置和凭据状态。

```ts
interface WebSearchSettingsModel {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'error'
    mode: 'provider_native' | 'tavily'
    maxResults: number
    apiKeyRef: string
    apiKeyConfigured: boolean
    apiKeyWritable: boolean
    writable: boolean
    tavilyAvailable: boolean
    revision?: number
    error: string
  }
  subscribe(listener: () => void): () => void
  refresh(): Promise<ReturnType<WebSearchSettingsModel['getSnapshot']>>
  update(patch: { mode?: 'provider_native' | 'tavily'; maxResults?: number }): Promise<ReturnType<WebSearchSettingsModel['getSnapshot']>>
  saveAndTest(apiKey: string): Promise<{ settings: ReturnType<WebSearchSettingsModel['getSnapshot']>; connection: TavilyConnection }>
  test(apiKey?: string): Promise<{ connection: TavilyConnection }>
  removeKey(): Promise<ReturnType<WebSearchSettingsModel['getSnapshot']>>
}
interface TavilyConnection { ok: true; plan: string; used: number; limit: number }
```

搜索提供商由 `ctx.remote.eleckoiWebSearch.selection/select` 读取和修改 profile。Tavily 的可热更新配置由官方 `ctx.remote.settings` 维护，命名空间为 `web-search-tavily`：`apiKeyEnv` 是凭据引用，默认 `TAVILY_API_KEY`；`maxResults` 为 1 到 8 的整数，默认 5。写入采用 namespace 的 revision，冲突由官方 Settings 拒绝。

密钥通过官方 `ctx.remote.credentials` 保存和删除。snapshot 只包含引用、是否已配置和是否可写，不包含密钥内容。搜索操作由 Host 在每次请求开始时调用 `ctx.credentials.resolve()`；不能把密钥缓存到 model、SQLite 或请求快照。`saveAndTest()` 在测试成功后才保存新密钥；测试仅调用 Tavily 额度端点，不创建聊天或 Session 日志。

## `eleckoiDisplayPreferences`（Client）

由 `@eleckoi/dsh-client-display-preferences` 提供，统一读取和保存侧栏、聊天列表与消息显示偏好。

```ts
interface DisplayPreferencesModel {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'error'
    ui: Record<string, unknown>
    chatDisplay: Record<string, unknown>
    writable: boolean
    revision?: number
    error: string
  }
  subscribe(listener: () => void): () => void
  refresh(): Promise<ReturnType<DisplayPreferencesModel['getSnapshot']>>
  updateUi(update: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>)): Promise<ReturnType<DisplayPreferencesModel['getSnapshot']>>
  setChatDisplay(value: Record<string, unknown>): Promise<ReturnType<DisplayPreferencesModel['getSnapshot']>>
}
```

偏好值由 DSH Settings 的 `eleckoi-display-preferences` profile 条目持久化。写入使用生成的 `ctx.remote.eleckoiDisplayPreferences` 合同；Host 会先把 Base64 全局壁纸写入本地媒体库，再把 `eleckoi-media://` 引用交给 Settings，避免在 profile 中保存整张图片。Client 不访问本机文件系统或 SQLite。

## 服务使用规则

- 只调用 manifest `members` 列出的公开成员。
- 订阅必须在组件卸载或插件停用时释放。
- 不修改 snapshot 对象；把它当作只读值。
- 不缓存具体 service 实现跨越插件 reload。
- 不把 Client service 当数据库事务；复杂写入由权威 Host owner 提供原子命令。
- 方法抛错时向用户显示可恢复错误，不把界面留在无限 loading。
