import type { AuthorContext, AuthorMessage, AuthorEventMap, AuthorEventName, AuthorAudioChannel, AuthorAudioState, ElecKoiAuthorApi } from '@eleckoi/author-sdk'
import { copy, freeze, FrontendCompatibilityError, unsupported } from './common'
import { FrontendEvents, tavernEvents } from './events'
import { createMessageFunctions, messageIndex, publicMessage } from './messages'
import { createVariableFunctions } from './variables'
import { createAudioFunctions } from './audio'

export { prepareFrontendCompatibilitySource, activateFrontendCompatibilityScripts, mountFrontendCompatibility } from './document'
export { FrontendCompatibilityError } from './common'

export interface FrontendCompatibilityController { dispose(): void; refresh(): Promise<void>; flush(): Promise<void>; readonly helper: Record<string, any> }
export interface FrontendCompatibilityOptions { report(error: unknown): void; active?(): boolean }

/** Names and value conversion live here; the native author SDK remains the only capability owner. */
export async function installTavernFrontend(page: Window, sdk: ElecKoiAuthorApi, options: FrontendCompatibilityOptions): Promise<FrontendCompatibilityController> {
  let closed = false, context: AuthorContext, messages: AuthorMessage[] = [], variables: Record<string, unknown> = {}
  let character: Record<string, unknown> | null = null, presets: Awaited<ReturnType<ElecKoiAuthorApi['presets']['list']>> | undefined
  let generation = 0, variableEpoch = 0, tail: Promise<unknown> = Promise.resolve()
  let writingOwner: string | undefined
  const variableStages: Array<{ value: Record<string, unknown>; epoch: number }> = []
  const tasks = new Set<Promise<unknown>>(), failures: unknown[] = [], stops: Array<() => void> = []
  const descriptors = new Map<string, PropertyDescriptor | undefined>()
  const audio = new Map<AuthorAudioChannel, AuthorAudioState>()
  const capabilities = new Set<string>()
  const available = () => {
    if (closed || options.active?.() === false) throw new FrontendCompatibilityError('FRAME_CLOSED', '前端兼容页面已关闭。')
  }
  const requireCapability = (method: string) => { available(); if (!capabilities.has(method)) unsupported(method) }
  const events = new FrontendEvents(options.report)
  const track = (operation: Promise<unknown>): void => {
    tasks.add(operation)
    void operation.then(() => tasks.delete(operation), error => {
      tasks.delete(operation); failures.push(error); if (!closed) options.report(error)
    })
  }
  const refresh = async (): Promise<void> => {
    available()
    const stamp = ++generation, owner = await sdk.context.current()
    const currentCapabilities = new Set((await sdk.app.getCapabilities()).map(item => item.method))
    const [pageValue, state, card, catalog] = await Promise.all([
      currentCapabilities.has('messages.getPage') ? sdk.messages.getPage() : undefined,
      currentCapabilities.has('variables.getState') ? sdk.variables.getState() : undefined,
      currentCapabilities.has('character.current') ? sdk.character.current() : undefined,
      currentCapabilities.has('presets.list') ? sdk.presets.list() : undefined,
    ])
    available()
    if (stamp !== generation) return
    const current = await sdk.context.current(); available()
    if (current.conversationId !== owner.conversationId) throw new FrontendCompatibilityError('CONTEXT_CHANGED', '读取期间聊天已切换。')
    if (context?.conversationId !== owner.conversationId) {
      variableEpoch++; variableStages.length = 0; audio.clear()
      if (currentCapabilities.has('audio.getState')) for (const name of ['bgm', 'ambient', 'voice', 'sfx'] as const) audio.set(name, await sdk.audio.getState(name))
      available()
      if (stamp !== generation) return
    }
    capabilities.clear(); currentCapabilities.forEach(method => capabilities.add(method))
    context = owner; messages = pageValue?.items || []; variables = state || {}; character = card || null; presets = catalog
  }
  const write = <T>(operation: () => Promise<T>): Promise<T> => {
    available()
    const owner = context.conversationId
    const task = tail.then(async () => {
      available()
      if ((await sdk.context.current()).conversationId !== owner) throw new FrontendCompatibilityError('CONTEXT_CHANGED', '兼容操作所属聊天已切换。')
      writingOwner = owner
      try { const result = await operation(); available(); await refresh(); return result }
      finally { writingOwner = undefined }
    })
    tail = task.catch(() => undefined)
    return task
  }
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(page, name))
    Object.defineProperty(page, name, { configurable: true, writable: true, value })
  }
  const dispose = () => {
    if (closed) return
    closed = true; generation++; variableEpoch++; variableStages.length = 0
    page.removeEventListener('pagehide', dispose)
    for (const stop of stops.splice(0)) stop()
    events.close(); messages = []; variables = {}; audio.clear()
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(page, name, descriptor); else Reflect.deleteProperty(page, name)
    }
    descriptors.clear()
  }
  const flush = async () => {
    while (tasks.size) await Promise.allSettled([...tasks])
    if (failures.length) throw new AggregateError(failures.splice(0), '前端兼容操作未完成。')
  }
  try {
    await refresh()
    const helper: Record<string, any> = {}
    const add = (values: Record<string, any>) => Object.assign(helper, values)
    add(createMessageFunctions({
      available: () => requireCapability('messages.getPage'), messages: () => messages, currentMessageId: () => context.messageId, write,
      setContent: async (id, text) => {
        requireCapability('messages.setContent')
        if ((await sdk.context.current()).conversationId !== writingOwner) throw new FrontendCompatibilityError('CONTEXT_CHANGED', '消息修改期间聊天已切换。')
        return sdk.messages.setContent(id, text)
      },
    }))
    add(createVariableFunctions({
      available: () => requireCapability('variables.getState'), state: () => variableStages.at(-1)?.value || variables,
      ownerCheck: () => {
        const owner = context.conversationId
        return async () => { available(); if ((await sdk.context.current()).conversationId !== owner) throw new FrontendCompatibilityError('CONTEXT_CHANGED', '变量修改期间聊天已切换。') }
      },
      historical: id => {
        requireCapability('variables.getState')
        const message = messages[messageIndex(id, messages)]
        if (message.variableState === null) throw new FrontendCompatibilityError('VARIABLE_HISTORY_NOT_AVAILABLE', '这条消息没有历史变量。')
        return copy(message.variableState)
      },
      stage: value => {
        requireCapability('variables.setState')
        const stage = { value: copy(value), epoch: variableEpoch }; variableStages.push(stage)
        return write(async () => {
          if (stage.epoch !== variableEpoch) throw new FrontendCompatibilityError('DEPENDENCY_FAILED', '之前的变量保存失败，后续依赖修改已取消。')
          try { await sdk.variables.setState(stage.value) }
          catch (error) { variableEpoch++; variableStages.length = 0; throw error }
          finally { const index = variableStages.indexOf(stage); if (index >= 0) variableStages.splice(index, 1) }
        })
      }, track,
    }))
    add({
      getIframeName: () => { available(); return page.name },
      getIframeWindow: () => { available(); return page },
      getTavernHelper: () => { available(); return helper },
      eventOn: events.on.bind(events), eventOnce: (name: string, listener: (...args: any[]) => unknown) => events.on(name, listener, true),
      eventMakeFirst: (name: string, listener: (...args: any[]) => unknown) => events.move(name, listener, true),
      eventMakeLast: (name: string, listener: (...args: any[]) => unknown) => events.move(name, listener, false),
      eventRemoveListener: events.off.bind(events), eventClearEvent: events.clearEvent.bind(events),
      eventClearListener: events.clearListener.bind(events), eventClearAll: events.clearAll.bind(events),
      eventEmit: (name: string, ...args: unknown[]) => { available(); return events.emit(name, args) },
      eventEmitAndWait: (name: string, ...args: unknown[]) => { available(); track(events.emit(name, args, true)) },
    })
    helper.getInput = () => { requireCapability('input.get'); return sdk.input.get() }
    helper.setInput = helper.setInputText = (text: string) => { requireCapability('input.set'); return sdk.input.set(text) }
    add({
      getPresetNames: () => { requireCapability('presets.list'); return presets!.items.map(item => item.name) },
      getLoadedPresetName: () => { requireCapability('presets.list'); const selected = presets!.items.find(item => item.id === presets!.activePresetId); if (!selected) throw new FrontendCompatibilityError('PRESET_NOT_AVAILABLE', '当前未选择可用预设。'); return selected.name },
    })
    add(createAudioFunctions(sdk, { requireCapability, state: key => audio.get(key)!, accept: state => audio.set(state.channel, copy(state)),
      write, track, baseUrl: page.document.baseURI }))
    const publicContext: Record<string, unknown> = {}
    Object.defineProperties(publicContext, {
      chat: { enumerable: true, get: () => { available(); return freeze(messages.map((message, index) => ({ ...publicMessage(message, index), mes: message.content, is_user: message.role === 'user', name: message.speakerName }))) } },
      chatId: { enumerable: true, get: () => { available(); return context.conversationId } },
      characterId: { enumerable: true, get: () => { available(); return character ? 0 : undefined } },
      characters: { enumerable: true, get: () => { available(); return freeze(character ? [copy(character)] : []) } },
      eventSource: { enumerable: true, value: Object.freeze({ on: events.on.bind(events), once: (name: string, listener: (...args: any[]) => unknown) => events.on(name, listener, true), removeListener: events.off.bind(events) }) },
      eventTypes: { enumerable: true, value: tavernEvents }, event_types: { enumerable: true, value: tavernEvents },
    })
    publicContext.stopGeneration = () => { requireCapability('chat.stopGeneration'); return sdk.chat.stopGeneration() }
    publicContext.getCurrentChatId = () => { available(); return context.conversationId }
    const subscribe = <K extends AuthorEventName>(name: K, listener: (value: AuthorEventMap[K]) => void) => stops.push(sdk.events.on(name, listener))
    const sourceEvents = await sdk.events.list(); available()
    for (const name of sourceEvents.items) subscribe(name, payload => {
      if (closed) return
      if (name === 'audio.state.changed' || name === 'audio.time.updated') {
        const state = (payload as AuthorEventMap['audio.state.changed']).state; audio.set(state.channel, copy(state))
        events.publish(name, copy(payload)); return
      }
      if (payload.conversationId !== context.conversationId) {
        track(refresh().then(() => events.publish(tavernEvents.CHAT_CHANGED, context.conversationId)))
        return
      }
      if (name !== 'messages.changed') {
        events.publish(name, copy(payload))
        if (name === 'agent.state.changed' && (payload as AuthorEventMap['agent.state.changed']).state === 'starting') events.publish(tavernEvents.GENERATION_STARTED, 'normal')
        else if (name === 'agent.output.delta') {
          const output = payload as AuthorEventMap['agent.output.delta']
          const message = messages.find(item => item.id === output.messageId)
          if (message) message.content = output.accumulated
          events.publish(tavernEvents.STREAM_TOKEN_RECEIVED, output.accumulated)
        } else if (name === 'agent.run.finished') events.publish(tavernEvents.GENERATION_ENDED, messages.findIndex(message => message.id === (payload as AuthorEventMap['agent.run.finished']).message?.id))
        else if (name === 'agent.run.cancelled') { events.publish(tavernEvents.GENERATION_STOPPED); events.publish(tavernEvents.GENERATION_ENDED, -1) }
        return
      }
      const refreshTask = refresh().then(() => {
        available(); events.publish(name, copy(payload))
        if (name === 'messages.changed') {
          const changed = payload as AuthorEventMap['messages.changed']
          if (changed.reason === 'deleted') { events.publish(tavernEvents.MESSAGE_DELETED, messages.length); return }
          for (const id of changed.messageIds) {
            const index = messages.findIndex(message => message.id === id)
            if (index < 0) continue
            if (changed.reason === 'edited') events.publish(tavernEvents.MESSAGE_EDITED, index)
            else if (changed.reason === 'sent' && messages[index].role === 'user') events.publish(tavernEvents.MESSAGE_SENT, index)
            else if (changed.reason === 'sent') events.publish(tavernEvents.MESSAGE_RECEIVED, index)
            else events.publish(tavernEvents.MESSAGE_UPDATED, index)
          }
        }
      })
      track(refreshTask)
    })
    for (const [name, value] of Object.entries(helper)) install(name, value)
    install('TavernHelper', Object.freeze(helper))
    install('SillyTavern', Object.freeze({ getContext: () => { available(); return Object.freeze(publicContext) } }))
    install('tavern_events', tavernEvents)
    const changed = () => {
      track(sdk.context.current().then(current => {
        available()
        if (current.conversationId !== context.conversationId) return refresh().then(() => events.publish(tavernEvents.CHAT_CHANGED, context.conversationId))
      }))
    }
    page.addEventListener('eleckoi:frontend-context', changed)
    stops.push(() => page.removeEventListener('eleckoi:frontend-context', changed))
    page.addEventListener('pagehide', dispose, { once: true })
    return { helper, dispose, refresh, flush }
  } catch (error) { dispose(); throw error }
}
