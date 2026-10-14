import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-settings'
import type { AgentPreset, PersonaProfile, RegexRule, RegexRuleCollection, SettingLibraryEntry, ScriptLibrary, ScriptLibraryScope, ScriptTree,
  TavernAuxiliaryGenerationEvent, TavernCompatibilityJson, TavernCompatibilityRecord } from './types.js'
import { NativeTavernOperations } from './tavern-native-operations.js'

type RecordValue = Record<string, unknown>
type Operation = (conversationId: string, params: RecordValue) => unknown | Promise<unknown>
export const TAVERN_COMPATIBILITY_NAMESPACE = 'eleckoi-product-api'

declare module '@deepseek-ai/cordis' {
  interface Context { eleckoiTavernCompatibilityApi: ElecKoiTavernCompatibilityApi }
}

const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const clone = <T>(value: T): T => structuredClone(value)
const present = (value: unknown): boolean => value !== undefined && value !== null
const remoteJson = (value: unknown): TavernCompatibilityJson => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(remoteJson)
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).map(([key, field]) => [key, remoteJson(field)]))
  }
  throw new TypeError('原生兼容接口只能返回有限数值、文本和 JSON 对象。')
}

/** Same public calls, implemented with product repositories and official settings. */
export class ElecKoiTavernCompatibilityApi extends TypertRemoteService {
  static inject = ['typert', 'settings', 'llm', 'agentDefaultModel', 'eleckoiProductData', 'eleckoiProductRecordChanges', 'eleckoiCharacterConfigurationChanges', 'eleckoiConversationChanges']
  private readonly owner: Context
  private readonly nativeOperations: NativeTavernOperations
  private readonly operations = new Map<string, Operation>()
  private snapshotReader?: (conversationId: string) => Promise<RecordValue> | RecordValue
  private tail: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'eleckoiTavernCompatibilityApi', { namespace: 'eleckoiTavernCompatibility' })
    this.owner = ctx
    this.nativeOperations = new NativeTavernOperations(ctx)
  }

  /** Host wiring supplies existing Session/generation operations without duplicating their stores. */
  registerOperation(method: string, operation: Operation): void { this.operations.set(method, operation) }
  setSnapshotReader(reader: (conversationId: string) => Promise<RecordValue> | RecordValue): void { this.snapshotReader = reader }

  /** 读取原生目录与消息投影；空聊天编号用于主页和全局脚本。
   * @param conversationId - 当前聊天编号；主页传空字符串。
   * @returns 角色、用户资料、预设、设定库及作用域变量快照。
   */
  @Remote
  async snapshot(conversationId: string): Promise<TavernCompatibilityRecord> {
    const data = this.owner.eleckoiProductData
    const details = conversationId ? data.readConversationDetails(conversationId, undefined, 1) : undefined
    const state = this.state()
    const characters = data.readCharacters()
    const catalog = data.readAgentPresetCatalog()
    const characterId = details?.metadata.characterId || characters.active_character_id
    const personas = this.personas(state)
    const activePersonaId = text(state.activePersonaId, 'default')
    const nativeRegex = characterId ? data.readRegexRules(characterId) : undefined
    const extra = this.snapshotReader ? await this.snapshotReader(conversationId) : {}
    const nativeServices = await this.nativeOperations.snapshot()
    const annotations = object(object(state.messages)[conversationId])
    const messages = array(extra.messages ?? (conversationId ? this.messageMetadata(conversationId) : [])).map(value => {
      const row = object(value)
      return { ...row, ...object(annotations[text(row.id)]) }
    })
    const chatVariables = conversationId ? JSON.parse(data.readAuthorConversationState(conversationId).currentVariableStateJson) : {}
    const variableScopes = clone(object(state.variables))
    variableScopes.global = { '': {}, ...object(variableScopes.global) }
    variableScopes.character = { ...(characterId ? { [characterId]: {} } : {}), ...object(variableScopes.character) }
    variableScopes.chat = { ...object(variableScopes.chat), ...(conversationId ? { [conversationId]: chatVariables } : {}) }
    variableScopes.script = { ...Object.fromEntries(this.scriptCatalog(conversationId).map(script => [text(script.id), {}])), ...object(variableScopes.script) }
    variableScopes.message = Object.fromEntries(messages.map(row => [text(row.id), present(row.variableState) ? clone(object(row.variableState)) :
      typeof row.variableStateJson === 'string' ? JSON.parse(row.variableStateJson) : {}]))
    const worlds = this.worldbooks(state)
    const globalWorld = worlds.find(item => item.scope === 'global')
    const currentBindings: RecordValue = { global: globalWorld ? [globalWorld.name] : [], character: {}, chat: {} }
    const characterBindings = object(currentBindings.character)
    for (const item of characters.items) {
      characterBindings[item.id] = { primary: this.nativeWorldbookName(item.id), additional: [] }
    }
    currentBindings.character = characterBindings
    return remoteJson({
      ...extra,
      ...nativeServices,
      context: { ...object(extra.context), conversationId, chatId: conversationId, characterId, characterName: details?.metadata.characterName ?? text(characters.items.find(item => item.id === characterId)?.name),
        personaId: activePersonaId, presetId: catalog.activePresetIds.roleplay, runtimeSessionId: details?.runtimeSessionId ?? '' },
      characters: { items: characters.items.map(item => this.character(item.id, state)), activeId: characterId },
      personas: { items: personas, activeId: activePersonaId },
      presets: { items: catalog.presets, activeId: catalog.activePresetIds.roleplay },
      worldbooks: { items: worlds.map(item => ({ id: item.name, name: item.name })), bindings: currentBindings },
      lorebookSettings: clone(object(state.lorebookSettings)), messages,
      regexes: nativeRegex ? {
        global: this.publicRegexes(nativeRegex.globalRules, 'global', state),
        preset: this.publicRegexes(nativeRegex.agentPresetRules, 'preset', state),
        character: this.publicRegexes(nativeRegex.characterRules, 'character', state),
        characterEnabled: state.characterRegexEnabled !== false
      } : { global: [], preset: [], character: [], characterEnabled: true },
      variables: chatVariables, variableScopes,
      scripts: this.scriptCatalog(conversationId), extensionSettings: clone(object(state.extensionSettings)),
      chatMetadata: { ...object(extra.chatMetadata), ...clone(object(object(state.chatMetadata)[conversationId])) }
    }) as TavernCompatibilityRecord
  }

  /** 调用原生服务；写入按提交顺序处理，失败向调用页面抛出。
   * @param conversationId - 当前聊天编号；全局目录操作可以传空字符串。
   * @param method - 对应原生业务的操作名。
   * @param params - 原生操作参数。
   * @returns 原生服务的实际结果。
   */
  @Remote
  invoke(conversationId: string, method: string, params: TavernCompatibilityRecord): Promise<TavernCompatibilityJson> {
    const execute = async () => {
      const operation = this.operations.get(method)
      const result = operation ? await operation(conversationId, clone(params)) : await this.dispatch(conversationId, method, clone(params))
      return remoteJson(result === undefined ? null : result)
    }
    if (this.nativeOperations.concurrent(method)) return execute()
    const pending = this.tail.then(execute)
    this.tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  /** 通过原生 LLM 连接执行独立辅助生成，逐段返回真实输出。
   * @param params - 已保存连接、纯文本消息及生成参数。
   * @param signal - 取消生成或关闭流的信号。
   * @returns 模型开始、正文、推理及完成事件。
   */
  @Remote({ mode: 'stream' })
  generate(params: TavernCompatibilityRecord, signal: AbortSignal): AsyncIterable<TavernAuxiliaryGenerationEvent> {
    return this.nativeOperations.generate(clone(params), signal)
  }

  private messageMetadata(conversationId: string) {
    const messages: import('./types.js').ConversationMessageMetadata[] = []
    let cursor: number | undefined
    do {
      const page = this.owner.eleckoiProductData.readConversationDetails(conversationId, cursor, 200)
      messages.unshift(...page.messages)
      if (!page.hasMore || page.beforeSequence === null) return messages
      if (page.beforeSequence === cursor) throw new Error('原生消息分页游标没有前进。')
      cursor = page.beforeSequence
    } while (true)
  }

  private state(): RecordValue {
    const descriptor = this.owner.settings.describe().find(item => item.ns === TAVERN_COMPATIBILITY_NAMESPACE)
    if (!descriptor) throw new Error('ElecKoi 兼容目录 settings namespace 尚未注册。')
    return clone(object(object(descriptor.value).state))
  }

  private async saveState(state: RecordValue): Promise<void> {
    const descriptor = this.owner.settings.describe().find(item => item.ns === TAVERN_COMPATIBILITY_NAMESPACE)
    if (!descriptor) throw new Error('ElecKoi 兼容目录 settings namespace 尚未注册。')
    await this.owner.settings.mutate(TAVERN_COMPATIBILITY_NAMESPACE, [{ op: 'set', path: ['state'], value: state }], descriptor.revision)
  }

  private currentCharacterId(conversationId: string): string {
    return (conversationId ? this.owner.eleckoiProductData.readConversationDetails(conversationId).metadata.characterId : '') || this.owner.eleckoiProductData.readCharacters().active_character_id
  }

  private character(id: string, state = this.state()): RecordValue {
    const native = this.owner.eleckoiProductData.readCharacters().items.find(item => item.id === id || item.name === id)
    if (!native) throw new Error(`角色不存在：${id}`)
    const preserved = object(object(state.characterFields)[native.id])
    const persona = object(native.persona)
    return { ...clone(preserved), ...native, persona: { ...object(preserved.persona), ...persona }, name: native.name, avatar: native.avatar,
      first_mes: text(persona.opening), data: { ...object(preserved.data), ...object(preserved), name: native.name, first_mes: text(persona.opening) } }
  }

  private personas(state: RecordValue): RecordValue[] {
    const native = this.owner.eleckoiProductData.readPersona()
    const saved = object(state.personas)
    const activeId = text(state.activePersonaId, 'default')
    const result = Object.entries(saved).map(([id, value]) => ({ ...clone(object(value)), id }))
    const current = { ...object(saved[activeId]), id: activeId, name: native.user_name, avatar: native.user_avatar,
      user_name: native.user_name, user_avatar: native.user_avatar, user_square: native.user_square, user_portrait: native.user_portrait }
    const index = result.findIndex(item => item.id === activeId)
    if (index < 0) result.unshift(current)
    else result[index] = current
    return result
  }

  private nativeWorldbookName(characterId: string): string {
    const library = this.owner.eleckoiProductData.readSettingLibrary(characterId)
    const character = this.owner.eleckoiProductData.readCharacters().items.find(item => item.id === characterId)
    return text(library.name, text(character?.name, characterId)) + ` [${characterId}]`
  }

  private worldbooks(state: RecordValue): Array<{ name: string; entries: RecordValue[]; scope: 'global' | 'character'; ownerId: string }> {
    const global = this.owner.eleckoiProductData.readGlobalSettingLibrary()
    const result: Array<{ name: string; entries: RecordValue[]; scope: 'global' | 'character'; ownerId: string }> = [{ name: global.name,
      entries: global.entries.filter(entry => entry.kind === 'normal').map((entry, index) => this.publicEntry(entry, index, state, global.characterId)), scope: 'global', ownerId: global.characterId }]
    for (const character of this.owner.eleckoiProductData.readCharacters().items) {
      const name = this.nativeWorldbookName(character.id)
      const library = this.owner.eleckoiProductData.readSettingLibrary(character.id)
      result.push({ name, scope: 'character', ownerId: character.id, entries: library.entries.filter(entry => entry.kind === 'normal').map((entry, index) => this.publicEntry(entry, index, state, character.id)) })
    }
    return result
  }

  private publicEntry(entry: SettingLibraryEntry, index: number, state: RecordValue, ownerId: string): RecordValue {
    const preserved = object(object(state.worldbookEntryFields)[`${ownerId}:${entry.id}`])
    return { ...preserved, ...entry, uid: preserved.uid ?? index, name: entry.title, comment: entry.title,
      key: entry.keywords, keysecondary: entry.conditionKeywords, disable: !entry.enabled, constant: entry.triggerMode === 'always',
      strategy: { ...object(preserved.strategy), type: entry.triggerMode === 'always' ? 'constant' : 'selective', keys: entry.keywords,
        keys_secondary: { ...object(object(preserved.strategy).keys_secondary), logic: entry.keywordCondition, keys: entry.conditionKeywords }, scan_depth: entry.keywordScanDepth },
      position: { ...object(preserved.position), type: entry.position ?? 'instructions', role: entry.insertRole, order: entry.order, depth: object(preserved.position).depth ?? index },
      recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null, ...object(preserved.recursion) } }
  }

  private nativeEntry(value: RecordValue, index: number): SettingLibraryEntry {
    const strategy = object(value.strategy), position = object(value.position)
    const existing = value as Partial<SettingLibraryEntry>
    const now = new Date().toISOString()
    const positionType = typeof value.position === 'string' ? value.position : position.type
    const nativePosition = ['instructions', 'insert_point_1', 'insert_point_2', 'insert_point_3', 'insert_point_4', 'insert_point_5'].includes(String(positionType))
      ? positionType as SettingLibraryEntry['position'] : 'instructions'
    return {
      id: text(value.id, present(value.uid) ? String(value.uid) : randomUUID()), title: text(value.name, text(value.comment, text(value.title))),
      iconId: text(value.iconId), kind: existing.kind ?? 'normal', groupId: text(value.groupId), content: text(value.content),
      openingMessages: existing.openingMessages ?? [], defaultOpeningMessageId: text(value.defaultOpeningMessageId), agentSelectionHint: text(value.agentSelectionHint),
      agentReadStrategy: existing.agentReadStrategy ?? 'keyword', dynamicMode: existing.dynamicMode ?? 'standard', contentMode: existing.contentMode ?? 'plain_text',
      keywords: array(strategy.keys ?? value.key ?? value.keywords).map(String), keywordScanDepth: Number(strategy.scan_depth ?? value.keywordScanDepth ?? 2),
      conditionKeywords: array(object(strategy.keys_secondary).keys ?? value.keysecondary ?? value.conditionKeywords).map(String),
      keywordCondition: existing.keywordCondition ?? 'any', keywordUseRegex: Boolean(value.keywordUseRegex), keywordIgnoreCase: value.keywordIgnoreCase !== false,
      keywordWholeWord: Boolean(value.keywordWholeWord), keywordRecursionDepth: Number(value.keywordRecursionDepth ?? 0),
      triggerMode: strategy.type === 'constant' || value.constant === true ? 'always' : existing.triggerMode ?? null,
      enabled: value.disable !== true && value.enabled !== false,
      position: nativePosition,
      promptPositionId: text(value.promptPositionId), insertRole: position.role === 'user' || position.role === 'assistant' ? position.role : existing.insertRole ?? 'system',
      order: Math.max(1, Number(position.order ?? value.order ?? index + 1)), viewOrder: index, groupViewOrder: index, treeViewOrder: index,
      createdAt: text(value.createdAt, now), updatedAt: now
    }
  }

  private publicRegexes(rules: RegexRule[], scope: string, state: RecordValue): RecordValue[] {
    return rules.map(rule => ({ ...object(object(state.regexFields)[rule.id]), ...rule, scope, find_regex: rule.pattern, replace_string: rule.replacement,
      source: { user_input: rule.targets.includes('UserInput'), ai_output: rule.targets.includes('AiOutput'), slash_command: rule.targets.includes('SlashCommand'), world_info: rule.targets.includes('SettingContent'), reasoning: rule.targets.includes('Reasoning') },
      destination: { display: !rule.promptOnly, prompt: !rule.displayOnly }, min_depth: rule.minDepth ?? null, max_depth: rule.maxDepth ?? null }))
  }

  private nativeRegex(value: RecordValue, index: number): RegexRule {
    const source = object(value.source), destination = object(value.destination)
    const placements = array(value.placement)
    const targets: RegexRule['targets'] = Array.isArray(value.targets) ? value.targets as RegexRule['targets'] : []
    for (const [name, target, placement] of [['user_input', 'UserInput', 1], ['ai_output', 'AiOutput', 2], ['slash_command', 'SlashCommand', 3], ['world_info', 'SettingContent', 5], ['reasoning', 'Reasoning', 6]] as const) {
      if ((source[name] === true || placements.includes(placement)) && !targets.includes(target)) targets.push(target)
    }
    return { id: text(value.id, randomUUID()), name: text(value.name, text(value.scriptName)), pattern: text(value.pattern, text(value.find_regex, text(value.findRegex))),
      replacement: text(value.replacement, text(value.replace_string, text(value.replaceString))), targets: targets.length ? targets : ['UserInput', 'AiOutput'],
      enabled: value.enabled !== false && value.disabled !== true,
      displayOnly: Boolean(value.displayOnly ?? value.markdownOnly ?? (destination.display === true && destination.prompt === false)),
      promptOnly: Boolean(value.promptOnly ?? (destination.prompt === true && destination.display === false)), runOnEdit: value.runOnEdit !== false,
      order: index, trimStrings: array(value.trimStrings).map(String), minDepth: present(value.min_depth ?? value.minDepth) ? Number(value.min_depth ?? value.minDepth) : null,
      maxDepth: present(value.max_depth ?? value.maxDepth) ? Number(value.max_depth ?? value.maxDepth) : null,
      substituteRegex: value.substituteRegex === 1 || value.substituteRegex === 2 ? value.substituteRegex : 0 }
  }

  private preset(id: string, state: RecordValue): RecordValue {
    const native = this.owner.eleckoiProductData.readAgentPreset(id)
    const extra = object(object(state.presetFields)[id])
    const promptFields = object(extra.promptFields)
    return { ...extra, ...native, prompts: native.entries.map(entry => ({ ...object(promptFields[entry.id]), identifier: entry.id,
      name: entry.title, content: entry.content, role: entry.insertRole, enabled: entry.enabled })) }
  }

  private scriptCatalog(conversationId: string): RecordValue[] {
    const data = this.owner.eleckoiProductData
    const characterId = this.currentCharacterId(conversationId), presetId = data.readAgentPresetCatalog().activePresetIds.roleplay
    return (['global', 'preset', 'character'] as const).flatMap(scope => {
      const ownerId = scope === 'global' ? '' : scope === 'character' ? characterId : presetId
      if (scope !== 'global' && !ownerId) return []
      const library = data.readScriptLibrary(scope, ownerId)
      return library.trees.flatMap(tree => (tree.type === 'folder' ? tree.scripts.map(script => ({ ...script, enabled: tree.enabled && script.enabled })) : [tree])
        .map(script => ({ ...script, scope, ownerId, libraryEnabled: library.enabled, revision: library.revision })))
    })
  }

  private async scriptOperation(conversationId: string, method: string, params: RecordValue): Promise<unknown> {
    const data = this.owner.eleckoiProductData
    const scopeName = text(params.scope, text(params.type, 'global'))
    if (!['global', 'character', 'preset'].includes(scopeName)) throw new Error(`脚本库归属不正确：${scopeName}`)
    const scope = scopeName as ScriptLibraryScope
    const ownerId = text(params.ownerId, scope === 'global' ? '' : scope === 'character' ? this.currentCharacterId(conversationId) : data.readAgentPresetCatalog().activePresetIds.roleplay)
    const library = data.readScriptLibrary(scope, ownerId)
    if (method === 'scripts.getTrees') return clone(library.trees)
    if (method === 'scripts.replaceTrees') {
      const saved = data.saveScriptLibrary({ ...library, trees: clone(array(params.trees)) as ScriptTree[] })
      this.owner.eleckoiCharacterConfigurationChanges.publish({ kind: 'configuration', domain: 'scripts' })
      return saved.trees
    }
    const id = text(params.id)
    const current = library.trees.flatMap(tree => tree.type === 'folder' ? tree.scripts : [tree]).find(script => script.id === id)
    if (!current) throw new Error(`原生脚本不存在：${id}`)
    if (method === 'scripts.getInfo') return clone(current)
    if (method === 'scripts.getButtons') return clone(current.button.buttons)
    if (method === 'scripts.getSettings') return clone(current.data)
    if (method === 'scripts.setInfo') {
      const updates = object(params.info)
      Object.assign(current, clone(updates), { id: current.id, type: 'script' })
    } else if (method === 'scripts.setButtons') current.button = { ...current.button, buttons: clone(array(params.buttons)) as typeof current.button.buttons }
    else if (method === 'scripts.setSettings') current.data = clone(object(params.data)) as typeof current.data
    else throw new Error(`原生脚本未提供操作：${method}`)
    const saved = data.saveScriptLibrary(library as ScriptLibrary)
    this.owner.eleckoiCharacterConfigurationChanges.publish({ kind: 'configuration', domain: 'scripts' })
    const result = saved.trees.flatMap(tree => tree.type === 'folder' ? tree.scripts : [tree]).find(script => script.id === id)
    if (!result) throw new Error('已保存脚本不在原生库中。')
    return method === 'scripts.setButtons' ? result.button.buttons : method === 'scripts.setSettings' ? result.data : result
  }

  private async dispatch(conversationId: string, method: string, params: RecordValue): Promise<unknown> {
    if (this.nativeOperations.has(method)) return this.nativeOperations.invoke(method, params)
    const data = this.owner.eleckoiProductData
    const state = this.state()
    if (method === 'settings.get') {
      if (params.namespace !== undefined || params.ns !== undefined) return this.nativeOperations.invoke('configuration.get', params)
      return clone(object(state.extensionSettings))
    }
    if (method === 'settings.set') {
      if (params.namespace !== undefined || params.ns !== undefined) return this.nativeOperations.invoke('configuration.set', params)
      state.extensionSettings = clone(object(params.value ?? params.settings))
      await this.saveState(state)
      return clone(state.extensionSettings)
    }
    if (method === 'chat.metadata.get') return clone(object(object(state.chatMetadata)[conversationId]))
    if (method === 'chat.metadata.set') {
      if (!conversationId) throw new Error('保存聊天元数据需要当前聊天编号。')
      const metadata = clone(object(params.value ?? params.metadata ?? params.data))
      state.chatMetadata = { ...object(state.chatMetadata), [conversationId]: metadata }
      await this.saveState(state)
      this.owner.eleckoiConversationChanges.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: [] })
      return metadata
    }
    const id = text(params.id)
    const value = clone(object(params.data))
    const name = text(params.name)
    if (method === 'character.list') return { items: data.readCharacters().items.map(item => this.character(item.id, state)), activeId: this.currentCharacterId(conversationId) }
    if (method === 'character.get') return this.character(id || this.currentCharacterId(conversationId), state)
    if (method === 'character.create' || method === 'character.replace') {
      const isNew = method.endsWith('create')
      const previous = isNew ? {} : this.character(id, state)
      const card: RecordValue & { id: string; name: string } = { ...previous, ...value, ...object(value.data), id: isNew ? text(value.id, randomUUID()) : text(previous.id), name: name || text(value.name, text(previous.name)) }
      const persona = { ...object(previous.persona), ...object(card.persona), assistant_name: card.name,
        assistant_avatar: text(card.avatar, text(object(previous.persona).assistant_avatar)), assistant_square: text(object(card.persona).assistant_square, text(object(previous.persona).assistant_square)),
        assistant_cover: text(object(card.persona).assistant_cover, text(object(previous.persona).assistant_cover)), opening: text(card.first_mes, text(object(card.persona).opening)) }
      const collection = isNew ? data.createCharacter({ ...card, persona }) : data.updateCharacter({ ...card, persona })
      const native = collection.items.find(item => item.id === card.id)
      if (!native) throw new Error('已保存角色不在原生目录中。')
      const unknown = clone(card)
      for (const key of Object.keys(native)) delete unknown[key]
      delete unknown.first_mes
      const personaFields = { ...object(card.persona) }
      for (const key of Object.keys(object(native.persona))) delete personaFields[key]
      if (Object.keys(personaFields).length) unknown.persona = personaFields
      if (Object.keys(object(unknown.data)).length) {
        const fields = object(unknown.data)
        for (const key of Object.keys(native)) delete fields[key]
        delete fields.first_mes
        unknown.data = fields
      }
      state.characterFields = { ...object(state.characterFields), [card.id]: unknown }
      await this.saveState(state)
      this.owner.eleckoiProductRecordChanges.publish({ kind: 'records', domain: 'characters', ids: [card.id] })
      return this.character(card.id, state)
    }
    if (method === 'character.delete') {
      const deleted = this.character(id, state)
      await this.owner.eleckoiCharactersApi.delete([text(deleted.id)])
      delete object(state.characterFields)[text(deleted.id)]
      await this.saveState(state); return true
    }
    if (method === 'persona.list') return { items: this.personas(state), activeId: text(state.activePersonaId, 'default') }
    if (method === 'persona.get') {
      const persona = this.personas(state).find(item => item.id === id || item.name === id)
      if (!persona) throw new Error(`用户资料不存在：${id}`)
      return persona
    }
    if (method.startsWith('persona.')) {
      const saved = Object.fromEntries(this.personas(state).map(item => [text(item.id), item]))
      let targetId = id
      if (method === 'persona.create') { targetId = text(value.id, randomUUID()); if (saved[targetId]) throw new Error('用户资料编号已存在。'); saved[targetId] = { ...value, id: targetId, name: name || text(value.name), avatar: text(value.avatar, text(value.user_avatar)) } }
      else if (method === 'persona.replace') { if (!saved[id]) throw new Error('用户资料不存在。'); saved[id] = { ...saved[id], ...value, id, name: text(value.name, text(saved[id].name)) } }
      else if (method === 'persona.delete') { if (!saved[id]) throw new Error('用户资料不存在。'); if (id === text(state.activePersonaId, 'default')) throw new Error('请先选择其他用户资料，再删除当前资料。'); delete saved[id] }
      else if (method === 'persona.select') { if (!saved[id]) throw new Error('用户资料不存在。'); state.activePersonaId = id }
      else throw new Error(`未知用户资料操作：${method}`)
      state.personas = saved
      if (method === 'persona.select' || targetId === text(state.activePersonaId, 'default')) {
        const item = saved[targetId]
        if (!item) throw new Error('当前用户资料不存在。')
        data.savePersona({ ...data.readPersona(), ...item, user_name: text(item.name, text(item.user_name)), user_avatar: text(item.avatar, text(item.user_avatar)) } as PersonaProfile)
        this.owner.eleckoiProductRecordChanges.publish({ kind: 'records', domain: 'persona' })
      }
      await this.saveState(state)
      return method === 'persona.delete' ? true : saved[targetId]
    }
    if (method === 'preset.list') { const catalog = data.readAgentPresetCatalog(); return { items: catalog.presets, activeId: catalog.activePresetIds.roleplay } }
    if (method === 'preset.get') {
      return this.preset(id || data.readAgentPresetCatalog().activePresetIds.roleplay, state)
    }
    if (method === 'preset.select') return data.setActiveAgentPreset(id)
    if (method === 'preset.delete') { const catalog = data.deleteAgentPreset(id); delete object(state.presetFields)[id]; await this.saveState(state); return catalog }
    if (method === 'preset.create' || method === 'preset.replace' || method === 'preset.rename') {
      const native = method === 'preset.create' ? data.createAgentPreset(name || text(value.name, 'Untitled'), text(value.libraryGroupId), value.purpose === 'creator' ? 'creator' : 'roleplay') : data.readAgentPreset(id)
      const merged = { ...native, ...value, id: native.id, name: method === 'preset.rename' ? name : text(value.name, native.name) }
      if (Array.isArray(value.prompts)) merged.entries = value.prompts.map((entry, index) => {
        const prompt = object(entry)
        return this.nativeEntry({ ...prompt, id: text(prompt.identifier, text(prompt.id, randomUUID())), position: { type: 'instructions', role: prompt.role, order: index + 1 } }, index)
      })
      const saved = data.saveAgentPreset(merged as AgentPreset, native.regexRules)
      const unknown = { ...object(object(state.presetFields)[native.id]), ...value }
      for (const key of Object.keys(saved)) delete unknown[key]
      if (Array.isArray(value.prompts)) {
        const fields = object(unknown.promptFields)
        value.prompts.forEach((entry, index) => {
          const prompt = clone(object(entry)), nativeEntry = merged.entries[index]
          if (!nativeEntry) throw new Error('预设提示词保存顺序不匹配。')
          for (const key of ['identifier', 'id', 'name', 'content', 'role', 'enabled']) delete prompt[key]
          fields[nativeEntry.id] = prompt
        })
        unknown.promptFields = fields
      }
      delete unknown.prompts
      state.presetFields = { ...object(state.presetFields), [native.id]: unknown }
      await this.saveState(state)
      this.owner.eleckoiCharacterConfigurationChanges.publish({ kind: 'configuration', domain: 'agentPresets' })
      return this.preset(native.id, state)
    }
    if (method.startsWith('worldbook.')) return this.worldbookOperation(conversationId, method, params, state)
    if (method === 'scripts.list') return this.scriptCatalog(conversationId)
    if (method.startsWith('scripts.')) return this.scriptOperation(conversationId, method, params)
    if (method === 'regex.get') return (await this.snapshot(conversationId)).regexes
    if (method === 'regex.replace') {
      const characterId = this.currentCharacterId(conversationId)
      if (!characterId) throw new Error('保存正则规则前需要至少一个原生角色。')
      const collection = data.readRegexRules(characterId)
      const options = object(params.options), scope = text(options.scope, 'all')
      const fields = object(state.regexFields)
      const input = array(params.rules).map(object)
      const group = (groupScope: string) => input.filter(rule => scope === groupScope || text(rule.scope, 'global') === groupScope).map((rule, index) => {
        const normalized = this.nativeRegex(rule, index), unknown = clone(rule)
        for (const key of [...Object.keys(normalized), 'scope', 'source', 'destination', 'find_regex', 'findRegex', 'replace_string', 'replaceString', 'min_depth', 'max_depth', 'placement', 'scriptName', 'disabled', 'markdownOnly']) delete unknown[key]
        fields[normalized.id] = unknown; return normalized
      })
      const next: RegexRuleCollection = { ...collection,
        globalRules: scope === 'all' || scope === 'global' ? group('global') : collection.globalRules,
        agentPresetRules: scope === 'all' || scope === 'preset' ? group('preset') : collection.agentPresetRules,
        characterRules: scope === 'all' || scope === 'character' ? group('character') : collection.characterRules }
      const saved = data.saveRegexRules(characterId, next, collection.revision)
      state.regexFields = fields; await this.saveState(state)
      this.owner.eleckoiCharacterConfigurationChanges.publish({ kind: 'configuration', domain: 'regexRules', characterId })
      return saved
    }
    if (method === 'variables.getScope' || method === 'variables.setScope' || method === 'variables.get' || method === 'variables.replace' || method === 'variables.setState') {
      const scope = text(params.scope, 'chat')
      const owner = text(params.owner, scope === 'character' ? this.currentCharacterId(conversationId) : scope === 'chat' ? conversationId : '')
      if (scope === 'chat') {
        if (method === 'variables.getScope' || method === 'variables.get') return JSON.parse(data.readAuthorConversationState(owner).currentVariableStateJson)
        if (!owner) throw new Error('聊天变量需要当前聊天编号。')
        const saved = data.updateConversationVariables(owner, JSON.stringify(params.variables ?? params.data ?? params.state ?? {}))
        this.owner.eleckoiConversationChanges.publish({ kind: 'messages', conversationId: owner, reason: 'edited', messageIds: [] })
        return JSON.parse(saved)
      }
      if (!['global', 'character', 'script', 'message'].includes(scope)) throw new Error(`未知变量归属：${scope}`)
      const variables = object(state.variables), scoped = object(variables[scope])
      if (scope === 'message') {
        if (!conversationId) throw new Error('消息变量需要当前聊天。')
        const annotations = object(state.messages), messages = object(annotations[conversationId]), metadata = object(messages[owner])
        if (method === 'variables.getScope' || method === 'variables.get') {
          if (present(metadata.variableState)) return clone(object(metadata.variableState))
          const native = this.snapshotReader ? array((await this.snapshotReader(conversationId)).messages).find(item => object(item).id === owner) : undefined
          const nativeState = object(native).variableState
          if (present(nativeState)) return clone(object(nativeState))
          const ledger = this.messageMetadata(conversationId).find(item => item.id === owner)
          if (!ledger) throw new Error(`聊天中不存在变量归属消息：${owner}`)
          return JSON.parse(ledger.variableStateJson)
        }
        metadata.variableState = clone(object(params.variables ?? params.data)); messages[owner] = metadata; annotations[conversationId] = messages; state.messages = annotations
        await this.saveState(state)
        this.owner.eleckoiConversationChanges.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: [owner] })
        return clone(metadata.variableState)
      }
      if (method === 'variables.getScope' || method === 'variables.get') return clone(object(scoped[owner]))
      scoped[owner] = clone(object(params.variables ?? params.data)); variables[scope] = scoped; state.variables = variables
      await this.saveState(state); return clone(scoped[owner])
    }
    if (method === 'messages.metadata') {
      const supported = new Set(['speakerName', 'isHidden', 'variableState', 'extra'])
      for (const update of array(params.updates)) for (const key of Object.keys(object(object(update).patch))) {
        if (!supported.has(key)) throw new Error(`该消息字段没有独立原生元数据归属：${key}`)
      }
      const annotations = object(state.messages), scoped = object(annotations[conversationId])
      for (const update of array(params.updates)) { const item = object(update); const messageId = text(item.id); scoped[messageId] = { ...object(scoped[messageId]), ...object(item.patch) } }
      annotations[conversationId] = scoped; state.messages = annotations; await this.saveState(state)
      this.owner.eleckoiConversationChanges.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: array(params.updates).map(item => text(object(item).id)) })
      return clone(scoped)
    }
    if (method === 'messages.update') return this.updateMessages(conversationId, params, state)
    if (['messages.create', 'messages.delete', 'messages.rotate'].includes(method)) {
      throw new Error('原生 Session 尚未提供任意插入、删除及重排消息的批次接口；兼容层不能建立第二份正文或假装完成。')
    }
    if (method === 'chat.historyBrief') return data.readConversationCatalog().filter(item => item.metadata.characterId === text(params.characterId))
    if (method === 'chat.historyDetail') {
      const chat = text(params.chat)
      const found = data.readConversationCatalog().find(item => item.id === chat && item.metadata.characterId === text(params.characterId))
      if (!found) throw new Error('找不到属于该角色的聊天。')
      return this.snapshot(found.id)
    }
    if (method.startsWith('import.')) return this.importRaw(conversationId, method, params)
    throw new Error(`ElecKoi 尚未注册原生操作：${method}`)
  }

  private async updateMessages(conversationId: string, params: RecordValue, state: RecordValue): Promise<unknown> {
    if (!conversationId) throw new Error('修改消息需要当前原生聊天。')
    if (!this.snapshotReader) throw new Error('原生 Session 消息读取服务尚未接入。')
    const rows = array((await this.snapshotReader(conversationId)).messages).map(object)
    const updates = array(params.updates).map(value => ({ id: text(object(value).id), patch: clone(object(object(value).patch)) }))
    const supported = new Set(['content', 'speakerName', 'isHidden', 'variableState', 'extra', 'role'])
    for (const update of updates) {
      const row = rows.find(item => item.id === update.id)
      if (!row) throw new Error(`原生聊天中找不到消息：${update.id}`)
      for (const key of Object.keys(update.patch)) if (!supported.has(key)) throw new Error(`消息字段尚无原生编辑接口：${key}`)
      if (update.patch.role !== undefined && update.patch.role !== row.role) throw new Error('原生 Session 消息不能改变角色。')
      if (update.patch.content !== undefined && typeof update.patch.content !== 'string') throw new TypeError('消息正文必须是文本。')
      if (update.patch.content !== undefined && update.id !== 'opening' && !Number.isSafeInteger(row.sessionEventSeq)) throw new Error('原生消息缺少可编辑的 Session 事件序号。')
    }
    const annotations = object(state.messages), scoped = object(annotations[conversationId])
    for (const update of updates) {
      const row = rows.find(item => item.id === update.id)!
      if (typeof update.patch.content === 'string') {
        if (update.id === 'opening') await this.owner.eleckoiConversationsApi.updateOpening(conversationId, update.patch.content)
        else {
          let content = update.patch.content
          const raw = text(row.rawContent)
          if (row.role === 'assistant' && raw.includes('<FINAL>')) {
            content = raw.slice(0, raw.indexOf('<FINAL>')) + `<FINAL>\n${content}\n</FINAL>`
          }
          await this.owner.eleckoiConversationsApi.editMessage(conversationId, Number(row.sessionEventSeq), row.role === 'user' ? 'user' : 'assistant', content)
        }
      }
      const metadata = { ...object(scoped[update.id]), ...update.patch }
      delete metadata.content; delete metadata.role
      scoped[update.id] = metadata
    }
    annotations[conversationId] = scoped; state.messages = annotations; await this.saveState(state)
    this.owner.eleckoiConversationChanges.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: updates.map(update => update.id) })
    return (await this.snapshot(conversationId)).messages
  }

  private async worldbookOperation(conversationId: string, method: string, params: RecordValue, state: RecordValue): Promise<unknown> {
    const data = this.owner.eleckoiProductData
    const name = text(params.name)
    const all = this.worldbooks(state)
    const found = all.find(item => item.name === name)
    if (method === 'worldbook.list') return all.map(item => item.name)
    if (method === 'worldbook.get') { if (!found) throw new Error(`世界书不存在：${name}`); return clone(found.entries) }
    if (method === 'worldbook.settings') { state.lorebookSettings = clone(object(params.data)); await this.saveState(state); return state.lorebookSettings }
    if (['worldbook.bindings', 'worldbook.getOrCreateChat', 'worldbook.create', 'worldbook.delete'].includes(method)) {
      throw new Error('原生设定库按全局或角色固定归属；独立多库、聊天绑定和删除库接口尚无对应原生归属模型。请使用已有全局或角色设定库的条目接口。')
    }
    if (!found) throw new Error(`原生设定库不存在：${name}`)
    let entries = array(params.entries).map(object)
    if (method === 'worldbook.createEntries') {
      const previous = found!.entries
      let uid = Math.max(0, ...previous.map(entry => Number(entry.uid) || 0)) + 1
      entries = [...previous, ...entries.map(entry => ({ ...entry, uid: entry.uid ?? uid++ }))]
    } else if (method === 'worldbook.deleteEntries') { const selected = array(params.ids).map(String); entries = found!.entries.filter(entry => !selected.includes(String(entry.uid ?? entry.id))) }
    else if (method !== 'worldbook.replace') throw new Error(`未知世界书操作：${method}`)
    entries = entries.map((entry, index) => ({ ...entry, uid: entry.uid ?? entry.id ?? index }))
    const library = found.scope === 'global' ? data.readGlobalSettingLibrary() : data.readSettingLibrary(found.ownerId)
    const fields = object(state.worldbookEntryFields)
    const native = entries.map((entry, index) => {
      const previous = found.entries.find(item => String(item.uid) === String(entry.uid))
      const item = this.nativeEntry({ ...entry, id: text(entry.id, text(previous?.id, randomUUID())), kind: 'normal' }, index)
      item.kind = 'normal'
      item.openingMessages = []
      item.defaultOpeningMessageId = ''
      const unknown = clone(entry)
      const positionMetadata = clone(object(entry.position))
      for (const key of ['type', 'role', 'order']) delete positionMetadata[key]
      for (const key of Object.keys(item)) delete unknown[key]
      for (const key of ['id', 'name', 'title', 'comment', 'content', 'key', 'keysecondary', 'keywords', 'conditionKeywords', 'disable', 'enabled', 'constant', 'kind', 'openingMessages', 'defaultOpeningMessageId', 'createdAt', 'updatedAt']) delete unknown[key]
      if (Object.keys(positionMetadata).length) unknown.position = positionMetadata
      fields[`${found.ownerId}:${item.id}`] = unknown
      return item
    })
    const protectedEntries = library.entries.filter(entry => entry.kind !== 'normal')
    const protectedIds = new Set(protectedEntries.map(entry => entry.id))
    if (native.some(entry => protectedIds.has(entry.id))) throw new Error('普通条目编号不能覆盖原生开场白或其他受保护条目。')
    if (new Set(native.map(entry => entry.id)).size !== native.length) throw new Error('设定库条目编号不能重复。')
    if (found.scope === 'global') data.replaceGlobalSettingLibraryContent({ ...library, entries: [...protectedEntries, ...native] })
    else data.replaceSettingLibraryContent(found.ownerId, { ...library, entries: [...protectedEntries, ...native] })
    state.worldbookEntryFields = fields
    this.owner.eleckoiCharacterConfigurationChanges.publish({ kind: 'configuration', domain: 'settingLibraries', characterId: found.ownerId })
    await this.saveState(state)
    return native.map((entry, index) => this.publicEntry(entry, index, state, found.ownerId))
  }

  private async importRaw(conversationId: string, method: string, params: RecordValue): Promise<unknown> {
    const data = this.owner.eleckoiProductData
    const raw = text(params.raw), name = text(params.name, 'Import.json')
    const document = { displayName: name, mimeType: text(params.mimeType, 'application/json'), base64: text(params.base64, Buffer.from(raw).toString('base64')) }
    if (method === 'import.character') {
      const preview = data.prepareCharacterImports([document], 'sillytavern')
      return data.commitCharacterImports(preview.token)
    }
    if (method === 'import.preset') return data.importAgentPreset('sillytavern', document, 'roleplay')
    if (method === 'import.chat') return this.owner.eleckoiConversationsApi.importArchive(this.currentCharacterId(conversationId), raw)
    if (method === 'import.worldbook') { const parsed = JSON.parse(raw); const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.entries) ? parsed.entries : Object.values(parsed.entries ?? {}); return this.dispatch(conversationId, 'worldbook.create', { name: name.replace(/\.[^.]+$/, ''), entries }) }
    if (method === 'import.regex') {
      const characterId = this.currentCharacterId(conversationId), collection = data.readRegexRules(characterId)
      return data.importRegexRules(characterId, 'Global', [{ displayName: name, json: raw }], collection.revision)
    }
    throw new Error(`未知导入操作：${method}`)
  }
}
