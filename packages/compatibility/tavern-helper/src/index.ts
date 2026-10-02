type JsonObject = Record<string, unknown>

function safeScriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export interface TavernHelperFrontendMessageSnapshot {
  id: string
  messageId: number
  role: 'system' | 'assistant' | 'user'
  name: string
  content: string
  variableState: JsonObject
}

export interface TavernHelperFrontendRuntimeSnapshot {
  currentMessageId: number
  userName: string
  characterName: string
  worldbookName: string
  variableState: JsonObject
  messages: TavernHelperFrontendMessageSnapshot[]
}

function installTavernHelperFrontendRuntime(global: any, initial: TavernHelperFrontendRuntimeSnapshot) {
  'use strict'
  if (global.__ElecKoiTavernHelperFrontendRuntime) return

  const api = global.ElecKoi
  const clone = (value: any) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  const object = (value: any) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const mvuState = (value: any) => {
    const state = clone(object(value))
    return object(state.stat_data) === state.stat_data
      ? state
      : { initialized_lorebooks: {}, stat_data: state }
  }
  const eventListeners = new Map<string, Set<Function>>()
  const messageRecords = Array.isArray(initial.messages)
    ? initial.messages.map(item => ({ ...clone(item), variableState: mvuState(item.variableState) }))
    : []
  const messageByNumber = (messageId: unknown) => {
    const requested = messageId === undefined || messageId === 'latest'
      ? initial.currentMessageId
      : Number(messageId)
    return messageRecords.find(item => item.messageId === requested) || messageRecords.at(requested) || messageRecords.at(-1)
  }
  let variableState = mvuState(initial.variableState)
  let runtimeLibrary: any = null
  let libraryLoad: Promise<any> | null = null

  const tavernEvents = Object.freeze({
    APP_READY: 'app_ready',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_UPDATED: 'message_updated',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_STARTED: 'generation_started',
    GENERATION_STOPPED: 'generation_stopped',
    GENERATION_ENDED: 'generation_ended',
    SETTINGS_UPDATED: 'settings_updated',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    STREAM_TOKEN_RECEIVED: 'stream_token_received'
  })
  const mvuEvents = Object.freeze({
    VARIABLE_INITIALIZED: 'mag_variable_initiailized',
    VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    COMMAND_PARSED: 'mag_command_parsed',
    VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
    BEFORE_MESSAGE_UPDATE: 'mag_before_message_update'
  })
  const eventEmit = async (name: string, ...args: any[]) => {
    const values = [...(eventListeners.get(name) || [])]
    for (const listener of values) await listener(...args)
  }
  const eventOn = (name: string, listener: Function) => {
    const values = eventListeners.get(name) || new Set<Function>()
    values.add(listener)
    eventListeners.set(name, values)
    const stop = () => values.delete(listener)
    Object.defineProperty(stop, 'stop', { value: stop })
    return stop
  }
  const eventOnce = (name: string, listener: Function) => {
    let stop = () => {}
    stop = eventOn(name, (...args: any[]) => {
      stop()
      return listener(...args)
    })
    return stop
  }
  const eventRemoveListener = (name: string, listener: Function) => eventListeners.get(name)?.delete(listener)
  const eventClearEvent = (name: string) => eventListeners.delete(name)
  const eventClearListener = (listener: Function) => eventListeners.forEach(values => values.delete(listener))
  const eventClearAll = () => eventListeners.clear()

  const variableTarget = (option: any = { type: 'chat' }) => {
    if (option?.type === 'message') return object(messageByNumber(option.message_id)?.variableState)
    return variableState
  }
  const persistVariables = (next: any, option: any = { type: 'chat' }) => {
    const normalized = mvuState(next)
    if (option?.type === 'message') {
      const record = messageByNumber(option.message_id)
      if (record) record.variableState = normalized
    }
    variableState = normalized
    void eventEmit(mvuEvents.VARIABLE_UPDATE_ENDED, clone(normalized))
    void api?.variables?.setState?.(clone(normalized)).catch((error: unknown) => console.error(error))
    return clone(normalized)
  }
  const getVariables = (option: any = { type: 'chat' }) => clone(variableTarget(option))
  const getAllVariables = () => clone(variableState)
  const replaceVariables = (variables: any, option: any = { type: 'chat' }) => persistVariables(variables, option)
  const updateVariablesWith = (updater: Function, option: any = { type: 'chat' }) => {
    void eventEmit(mvuEvents.VARIABLE_UPDATE_STARTED, clone(variableState))
    const draft = getVariables(option)
    const result = updater(draft)
    if (result && typeof result.then === 'function') {
      return result.then((value: any) => persistVariables(value === undefined ? draft : value, option))
    }
    return persistVariables(result === undefined ? draft : result, option)
  }
  const mergeObjects = (left: any, right: any): any => {
    const output = { ...object(left) }
    for (const [key, value] of Object.entries(object(right))) {
      output[key] = object(output[key]) === output[key] && object(value) === value
        ? mergeObjects(output[key], value)
        : clone(value)
    }
    return output
  }
  const insertOrAssignVariables = (variables: any, option: any = { type: 'chat' }) => (
    updateVariablesWith((current: any) => mergeObjects(current, variables), option)
  )
  const insertVariables = (variables: any, option: any = { type: 'chat' }) => (
    updateVariablesWith((current: any) => ({ ...clone(object(variables)), ...current }), option)
  )
  const deleteVariable = (path: string | string[], option: any = { type: 'chat' }) => updateVariablesWith((current: any) => {
    const parts = Array.isArray(path) ? path : String(path).split('.').filter(Boolean)
    let parent = current
    for (const part of parts.slice(0, -1)) parent = object(parent)[part]
    if (parent && typeof parent === 'object') delete parent[parts.at(-1) as string]
    return current
  }, option)

  const normalizeRange = (range: string | number) => {
    const maximum = Math.max(0, messageRecords.length - 1)
    const clamp = (value: number) => Math.min(maximum, Math.max(0, value < 0 ? maximum + value + 1 : value))
    if (/^-?\d+$/.test(String(range))) {
      const value = clamp(Number(range))
      return [value, value]
    }
    const match = /^(-?\d+)-(-?\d+)$/.exec(String(range))
    if (!match) return null
    return [clamp(Number(match[1])), clamp(Number(match[2]))].sort((a, b) => a - b)
  }
  const publicChatMessage = (record: any) => ({
    message_id: record.messageId,
    name: record.name,
    role: record.role,
    is_hidden: false,
    message: record.content,
    data: clone(record.variableState),
    extra: {},
    swipe_id: 0,
    swipes: [record.content],
    swipes_data: [clone(record.variableState)]
  })
  const getChatMessages = (range: string | number, options: any = {}) => {
    const selected = normalizeRange(range)
    if (!selected) return []
    return messageRecords
      .filter(item => item.messageId >= selected[0] && item.messageId <= selected[1])
      .filter(item => !options.role || options.role === 'all' || item.role === options.role)
      .map(publicChatMessage)
  }
  const setChatMessages = async (updates: any[]) => {
    if (!Array.isArray(updates)) throw new TypeError('消息更新必须是数组')
    const results = []
    for (const update of updates) {
      const record = messageByNumber(update?.message_id)
      if (!record) continue
      if (Number.isInteger(update.swipe_id) && update.message === undefined) {
        const openings = await api.openings.list()
        const opening = openings?.items?.[update.swipe_id]
        if (opening?.id) results.push(await api.openings.select(opening.id))
        continue
      }
      if (typeof update.message === 'string') {
        record.content = update.message
        results.push(await api.messages.setContent(record.id, update.message))
        void eventEmit(tavernEvents.MESSAGE_UPDATED, record.messageId)
      }
    }
    return results
  }

  const authorEntryToWorldbook = (entry: any) => ({
    uid: entry.id,
    name: entry.title,
    enabled: entry.enabled,
    strategy: {
      type: entry.triggerMode === 'always' || entry.agentReadStrategy === 'required' ? 'constant' : 'selective',
      keys: clone(entry.keywords || []),
      keys_secondary: {
        logic: entry.keywordCondition === 'all' ? 'and_all'
          : entry.keywordCondition === 'not_any' ? 'not_any' : 'and_any',
        keys: clone(entry.conditionKeywords || [])
      },
      scan_depth: entry.keywordScanDepth || 'same_as_global'
    },
    position: {
      type: entry.position === 'instructions' ? 'before_character_definition' : 'after_character_definition',
      role: entry.insertRole || 'system',
      depth: 4,
      order: entry.order || 1
    },
    content: entry.content,
    probability: 100,
    recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null }
  })
  const worldbookEntryToAuthor = (entry: any, previous: any, order: number) => {
    const now = new Date().toISOString()
    const secondaryLogic = entry.strategy?.keys_secondary?.logic
    const keywordCondition = secondaryLogic === 'and_all' ? 'all'
      : secondaryLogic === 'not_any' || secondaryLogic === 'not_all' ? 'not_any'
        : Array.isArray(entry.strategy?.keys_secondary?.keys) && entry.strategy.keys_secondary.keys.length
          ? 'any' : previous?.keywordCondition || 'none'
    const constant = entry.strategy?.type === 'constant'
    return {
      ...(previous || {
        id: typeof entry.uid === 'string' ? entry.uid : global.crypto?.randomUUID?.() || `entry-${Date.now()}-${order}`,
        iconId: '', kind: 'normal', groupId: '', openingMessages: [], defaultOpeningMessageId: '',
        agentSelectionHint: '', agentReadStrategy: 'normal', dynamicMode: 'standard', contentMode: 'plain_text',
        keywords: [], keywordScanDepth: 0, conditionKeywords: [], keywordCondition: 'none', keywordUseRegex: false,
        keywordIgnoreCase: true, keywordWholeWord: false, keywordRecursionDepth: 0, triggerMode: null,
        position: 'instructions', promptPositionId: '', insertRole: 'system', order, viewOrder: order,
        groupViewOrder: 0, treeViewOrder: order, createdAt: now, updatedAt: now
      }),
      title: String(entry.name ?? previous?.title ?? ''),
      content: String(entry.content ?? previous?.content ?? ''),
      enabled: entry.enabled !== false,
      keywords: Array.isArray(entry.strategy?.keys) ? entry.strategy.keys.map(String) : previous?.keywords || [],
      conditionKeywords: Array.isArray(entry.strategy?.keys_secondary?.keys)
        ? entry.strategy.keys_secondary.keys.map(String) : previous?.conditionKeywords || [],
      keywordCondition,
      agentReadStrategy: constant ? 'required' : 'keyword',
      triggerMode: previous?.triggerMode === 'always' ? 'always' : 'agent_tool',
      insertRole: previous?.insertRole || 'system',
      order: previous?.order || order,
      updatedAt: now
    }
  }
  const loadLibrary = async () => {
    if (runtimeLibrary) return runtimeLibrary
    if (!libraryLoad) libraryLoad = Promise.resolve(api?.settingLibrary?.current?.()).then((value: any) => {
      runtimeLibrary = value || {
        characterId: '', name: initial.worldbookName || initial.characterName || '当前角色设定库',
        entries: [], groups: [], promptPositions: []
      }
      return runtimeLibrary
    })
    return libraryLoad
  }
  const saveWorldbook = async (entries: any[]) => {
    const library = await loadLibrary()
    const oldEntries = new Map(library.entries.map((entry: any) => [entry.id, entry]))
    const oldByName = new Map(library.entries.map((entry: any) => [entry.title, entry]))
    const nextEntries = entries.map((entry, index) => {
      const previous = oldEntries.get(entry.uid) || oldByName.get(entry.name)
      return worldbookEntryToAuthor(entry, previous, index + 1)
    })
    runtimeLibrary = await api.settingLibrary.replace({ ...library, entries: nextEntries })
    void eventEmit(tavernEvents.WORLDINFO_UPDATED, runtimeLibrary.name, { entries: clone(entries) })
    return clone(entries)
  }
  const getWorldbook = async (_name: string) => (await loadLibrary()).entries.map(authorEntryToWorldbook)
  const replaceWorldbook = async (_name: string, entries: any[]) => saveWorldbook(clone(entries))
  const updateWorldbookWith = async (name: string, updater: Function) => {
    const current = await getWorldbook(name)
    const result = await updater(clone(current))
    return replaceWorldbook(name, result === undefined ? current : result)
  }
  const createWorldbookEntries = async (name: string, entries: any[]) => {
    const current = await getWorldbook(name)
    return replaceWorldbook(name, [...current, ...clone(entries)])
  }
  const deleteWorldbookEntries = async (name: string, predicate: any) => {
    const current = await getWorldbook(name)
    const remove = typeof predicate === 'function'
      ? predicate
      : (entry: any) => (Array.isArray(predicate) ? predicate : [predicate]).includes(entry.uid)
    return replaceWorldbook(name, current.filter((entry: any) => !remove(entry)))
  }

  const triggerSlash = async (command: unknown) => {
    const value = String(command ?? '').trim()
    const setInput = /^\/setinput\s+([\s\S]*)$/i.exec(value)
    if (setInput) return api.input.set(setInput[1])
    const send = /^\/send\s+([\s\S]*?)(?:\|\/trigger)?$/i.exec(value)
    if (send) return api.chat.send(send[1].trim())
    if (/^\/trigger$/i.test(value)) return api.input.send()
    return api.input.set(value)
  }
  const waitGlobalInitialized = async (name: string) => {
    if (name === 'Mvu') return global.Mvu
    if (!(name in global)) throw new Error(`Global is not available: ${name}`)
    return global[name]
  }
  const initializeGlobal = (name: string, value: any) => { global[name] = value; return value }
  const errorCatched = (action: Function) => function(this: any, ...args: any[]) {
    try {
      const result = action.apply(this, args)
      return result && typeof result.catch === 'function' ? result.catch(console.error) : result
    } catch (error) {
      console.error(error)
      return undefined
    }
  }

  const mvu = Object.freeze({
    events: mvuEvents,
    getMvuData: (option: any = { type: 'chat' }) => getVariables(option),
    replaceMvuData: async (state: any, option: any = { type: 'chat' }) => replaceVariables(state, option),
    isDuringExtraAnalysis: () => false
  })
  const helper = Object.freeze({
    tavern_events: tavernEvents,
    eventOn, eventOnce, eventEmit, eventRemoveListener, eventClearEvent, eventClearListener, eventClearAll,
    getLastMessageId: () => Math.max(0, ...messageRecords.map(item => item.messageId)),
    getCurrentMessageId: () => initial.currentMessageId,
    getChatMessages, setChatMessages,
    getVariables, getAllVariables, replaceVariables, updateVariablesWith, insertOrAssignVariables, insertVariables, deleteVariable,
    initializeGlobal, waitGlobalInitialized, errorCatched, triggerSlash,
    getWorldbookNames: () => [runtimeLibrary?.name || initial.worldbookName],
    getGlobalWorldbookNames: () => [],
    getCharWorldbookNames: () => ({ primary: runtimeLibrary?.name || initial.worldbookName, additional: [] }),
    getChatWorldbookName: () => runtimeLibrary?.name || initial.worldbookName,
    getWorldbook, replaceWorldbook, updateWorldbookWith, createWorldbookEntries, deleteWorldbookEntries
  })
  Object.assign(global, helper)
  Object.defineProperties(global, {
    TavernHelper: { value: helper, configurable: true },
    tavern_events: { value: tavernEvents, configurable: true },
    Mvu: { value: mvu, writable: true, configurable: true },
    SillyTavern: {
      value: {
        name1: initial.userName || 'User',
        name2: initial.characterName || 'Assistant',
        getContext: () => ({ name1: initial.userName || 'User', name2: initial.characterName || 'Assistant' })
      },
      configurable: true
    }
  })
  api?.events?.on?.('messages.changed', async (payload: any) => {
    try {
      const items = await api.messages.list()
      messageRecords.splice(0, messageRecords.length, ...items.map((item: any, index: number) => ({
        id: item.id,
        messageId: Number.isInteger(item.sequence) ? item.sequence : index,
        role: item.role,
        name: item.speakerName || (item.role === 'user' ? initial.userName : initial.characterName),
        content: item.content,
        variableState: clone(item.variableState || {})
      })))
      const lastId = Math.max(0, ...messageRecords.map(item => item.messageId))
      const eventName = payload?.reason === 'deleted' ? tavernEvents.MESSAGE_DELETED
        : payload?.reason === 'edited' ? tavernEvents.MESSAGE_EDITED : tavernEvents.MESSAGE_RECEIVED
      await eventEmit(eventName, lastId, payload?.reason || 'normal')
    } catch (error) {
      console.error(error)
    }
  })
  void loadLibrary().catch(() => {})
  queueMicrotask(() => {
    void eventEmit(mvuEvents.VARIABLE_INITIALIZED, clone(variableState))
    void eventEmit(tavernEvents.APP_READY)
  })
  Object.defineProperty(global, '__ElecKoiTavernHelperFrontendRuntime', {
    value: Object.freeze({ version: 1 }), configurable: false
  })
}

export function createTavernHelperFrontendRuntimeSource(snapshot: TavernHelperFrontendRuntimeSnapshot = {
  currentMessageId: 0,
  userName: 'User',
  characterName: 'Assistant',
  worldbookName: '',
  variableState: {},
  messages: []
}): string {
  return `(${installTavernHelperFrontendRuntime.toString()})(window, JSON.parse(${safeScriptString(JSON.stringify(snapshot))}));`
}
