import type { AuthorEventMap, AuthorEventName, AuthorSendAttachment, ElecKoiAuthorApi } from './contracts'
import { AuthorApiError } from './errors'
import { applyAuthorVariablePatch, mergeAuthorVariableState, type AuthorVariableState } from './variables'
import type { AuthorVariableRule } from './scripts'
import type { AuthorRequestOptions } from './variable-bindings'
import { serializeAuthorJsonObject } from './json'
export * from './scripts'
export { createAuthorVariableBindings } from './variable-bindings'
export type { AuthorVariablesRemote, AuthorVariableBinding, AuthorRequestOptions } from './variable-bindings'

export interface AuthorHostAdapter {
  request(method: string, params: Record<string, unknown>, options: AuthorRequestOptions): unknown | Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): () => void
  isEventCurrent?(event: AuthorEventName, payload: unknown): boolean
  registerVariableRule?(rule: AuthorVariableRule): () => void
  registerButton?(button: { id: string; label: string; onClick(signal: AbortSignal): void | Promise<void> }): () => void
  dispose?(): void
}

export type AuthorApiWindow = Pick<Window, 'addEventListener' | 'dispatchEvent' | 'fetch' | 'btoa' | 'document'> & {
  console: Console
  CustomEvent: typeof CustomEvent
  AbortController: typeof AbortController
  ElecKoi?: ElecKoiAuthorApi
  __ElecKoiHostAdapter?: AuthorHostAdapter
  __ElecKoiAuthorPendingCount?: () => number
}

export interface AuthorVariableTransaction {
  conversationId: string
  signal: AbortSignal
  getState(): AuthorVariableState
  setState(state: AuthorVariableState): void
}

const runtimes = new WeakMap<AuthorApiWindow, { transaction?: AuthorVariableTransaction; closed: boolean }>()

export async function runWithAuthorVariableTransaction<T>(
  window: AuthorApiWindow,
  transaction: AuthorVariableTransaction,
  action: () => T | Promise<T>
): Promise<T> {
  const runtime = runtimes.get(window)
  if (!runtime || runtime.closed) throw new AuthorApiError('FRAME_CLOSED', '变量规则所属作者页面不可用')
  if (runtime.transaction && runtime.transaction !== transaction) {
    throw new AuthorApiError('VARIABLE_RULE_BUSY', '当前作者页面正在处理另一份变量修改')
  }
  transaction.signal.throwIfAborted()
  const previous = runtime.transaction
  runtime.transaction = transaction
  try {
    const result = await action()
    transaction.signal.throwIfAborted()
    if (runtime.closed) throw new AuthorApiError('FRAME_CLOSED', '变量规则所属作者页面已经关闭')
    return result
  } finally { runtime.transaction = previous }
}

export function installElecKoiAuthorApi(global: AuthorApiWindow, adapter = global.__ElecKoiHostAdapter): ElecKoiAuthorApi {
  if (runtimes.has(global) && global.ElecKoi) return global.ElecKoi
  const pending = new Map<string, { reject(error: Error): void; contextCommitted: boolean }>()
  const listeners = new Map<AuthorEventName, Set<(payload: never) => void>>()
  const eventStops = new Map<AuthorEventName, () => void>()
  const ruleStops = new Set<() => void>()
  const runtime: { transaction?: AuthorVariableTransaction; closed: boolean } = { closed: false }
  runtimes.set(global, runtime)
  const lifetime = new global.AbortController()
  let sequence = 0
  const notifyPending = () => global.dispatchEvent(new global.CustomEvent('eleckoi:author-pending-change', {
    detail: { pendingCount: pending.size }
  }))
  Object.defineProperty(global, '__ElecKoiAuthorPendingCount', { value: () => pending.size, configurable: false })

  async function invoke(method: string, params: Record<string, unknown>, options: AuthorRequestOptions, useCandidate = true): Promise<unknown> {
    if (runtime.closed) throw new AuthorApiError('FRAME_CLOSED', '作者页面已经关闭')
    const transaction = useCandidate ? runtime.transaction : undefined
    if (transaction && (!params.conversationId || params.conversationId === transaction.conversationId)) {
      transaction.signal.throwIfAborted()
      if (method === 'variables.getState' && !params.messageId) return structuredClone(transaction.getState())
      let state: AuthorVariableState | undefined
      if (method === 'variables.setState') {
        if (!params.state || typeof params.state !== 'object' || Array.isArray(params.state)) {
          throw new AuthorApiError('INVALID_PARAMS', '变量状态必须是一个对象')
        }
        state = structuredClone(params.state as AuthorVariableState)
      } else if (method === 'variables.merge') state = mergeAuthorVariableState(transaction.getState(), params.state)
      else if (method === 'variables.applyPatch') state = applyAuthorVariablePatch(transaction.getState(), params.patch)
      if (state) { transaction.setState(state); return structuredClone(state) }
    }
    if (!adapter) throw new AuthorApiError('HOST_UNAVAILABLE', '当前页面没有安装 ElecKoi 作者服务')
    if (method === 'script.setSettings' || method === 'script.setLibrarySettings') {
      const prototype = (global as AuthorApiWindow & { Object: typeof Object }).Object.prototype
      params = { ...params, settingsJson: serializeAuthorJsonObject(params.values, [prototype], 'INVALID_PARAMS') }
    }
    if (method === 'audio.play') params = { ...params, track: resolveAudioTrack(params.track) }
    else if (['audio.setPlaylist', 'audio.appendPlaylist'].includes(method) && Array.isArray(params.items)) {
      params = { ...params, items: params.items.map(resolveAudioTrack) }
    }
    return adapter.request(method, params, options)
  }

  function resolveAudioTrack(track: unknown): unknown {
    const source = typeof track === 'string' ? track : track && typeof track === 'object' ? (track as { url?: unknown }).url : undefined
    if (typeof source !== 'string' || !source.trim()) return track
    let url: string
    try { url = new URL(source, global.document.baseURI).href }
    catch { throw new AuthorApiError('INVALID_PARAMS', '音频 URL 无法按当前作者页面地址解析') }
    return typeof track === 'string' ? url : { ...track as object, url }
  }

  function dispatch<TResult = unknown>(method: string, params: Record<string, unknown> = {}, useCandidate = true, signal = lifetime.signal): Promise<TResult> {
    if (runtime.closed) return Promise.reject(new AuthorApiError('FRAME_CLOSED', '作者页面已经关闭'))
    if (signal.aborted) return Promise.reject(signal.reason)
    const id = `author-${Date.now()}-${++sequence}`
    const navigation = method === 'chat.open' || method === 'chat.delete' ? new global.AbortController() : undefined
    const cancel = () => navigation?.abort(signal.reason)
    if (navigation) signal.addEventListener('abort', cancel, { once: true })
    let cancelInvocation = () => {}
    const tracked = new Promise<TResult>((resolve, reject) => {
      const request = { reject, contextCommitted: false }
      pending.set(id, request); notifyPending()
      cancelInvocation = () => { if (!request.contextCommitted) reject(signal.reason) }
      signal.addEventListener('abort', cancelInvocation, { once: true })
      const options: AuthorRequestOptions = navigation ? { signal: navigation.signal, commitContextChange() {
        navigation.signal.throwIfAborted()
        request.contextCommitted = true
        signal.removeEventListener('abort', cancel)
      } } : { signal }
      invoke(method, params, options, useCandidate).then(value => resolve(value as TResult), reject)
    })
    return tracked.finally(() => { signal.removeEventListener('abort', cancel); signal.removeEventListener('abort', cancelInvocation); pending.delete(id); notifyPending() })
  }

  global.addEventListener('pagehide', () => {
    runtime.closed = true
    const error = new AuthorApiError('FRAME_CLOSED', '作者页面已关闭，未完成的 API 调用已结束')
    lifetime.abort(error)
    // Accepted navigation owns its result even when it closes the requesting page.
    for (const [id, request] of pending) if (!request.contextCommitted) { request.reject(error); pending.delete(id) }
    listeners.clear()
    for (const stop of eventStops.values()) stop()
    eventStops.clear(); notifyPending()
    for (const stop of ruleStops) stop()
    ruleStops.clear()
    adapter?.dispose?.()
  }, { once: true })

  function on<TName extends AuthorEventName>(event: TName, listener: (payload: AuthorEventMap[TName]) => void): () => void {
    if (runtime.closed) throw new AuthorApiError('FRAME_CLOSED', '作者页面已经关闭')
    if (!adapter) throw new AuthorApiError('HOST_UNAVAILABLE', '当前页面没有安装 ElecKoi 作者服务')
    if (!eventStops.has(event)) eventStops.set(event, adapter.on(event, payload => {
      for (const fn of listeners.get(event) ?? []) {
        Promise.resolve().then(() => {
          if (!runtime.closed && listeners.get(event)?.has(fn) && (!adapter.isEventCurrent || adapter.isEventCurrent(event, payload))) return fn(structuredClone(payload) as never)
        }).catch(error => {
          if (runtime.closed && ['FRAME_CLOSED', 'HOST_CLOSED'].includes(error?.code)) return
          global.console.error(`ElecKoi event listener failed: ${event}`, error)
          global.dispatchEvent(new global.CustomEvent('eleckoi:plugin-error', { detail: { event, error } }))
        })
      }
    }))
    const values = listeners.get(event) ?? new Set()
    values.add(listener); listeners.set(event, values)
    return () => { off(event, listener) }
  }
  function off<TName extends AuthorEventName>(event: TName, listener: (payload: AuthorEventMap[TName]) => void): boolean | undefined {
    const values = listeners.get(event)
    if (!values) return undefined
    const removed = values.delete(listener)
    if (!values.size) { listeners.delete(event); eventStops.get(event)?.(); eventStops.delete(event) }
    return removed
  }

  async function serializeAttachment(source: AuthorSendAttachment) {
    if (!source || source.type !== 'image') throw new AuthorApiError('INVALID_PARAMS', '当前聊天只支持把图片作为 Agent 附件发送')
    if (source.data) return { type: 'image', mediaType: source.mimeType, name: source.name, data: source.data }
    if (!source.url) throw new AuthorApiError('INVALID_PARAMS', '图片附件必须提供 data 或 url')
    const response = await global.fetch(source.url, { signal: lifetime.signal })
    if (!response.ok) throw new AuthorApiError('MEDIA_LOAD_FAILED', `读取图片失败：${response.status}`)
    const blob = await response.blob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
    }
    return { type: 'image', mediaType: source.mimeType || blob.type, name: source.name, data: global.btoa(binary) }
  }

  function createApi(call: ElecKoiAuthorApi['call']): ElecKoiAuthorApi {
    return Object.freeze<ElecKoiAuthorApi>({
    api: Object.freeze({ stage: 'preview', version: '0.1.0' }), call,
    app: Object.freeze<ElecKoiAuthorApi['app']>({ getInfo: () => call('app.getInfo'), getCapabilities: () => call('app.getCapabilities') }),
    context: Object.freeze<ElecKoiAuthorApi['context']>({ current: () => call('context.current') }),
    script: Object.freeze<ElecKoiAuthorApi['script']>({
      getSettings: () => call('script.getSettings'),
      setSettings: (values, expectedRevision) => call('script.setSettings', { values, expectedRevision }),
      getLibrarySettings: () => call('script.getLibrarySettings'),
      setLibrarySettings: (values, expectedRevision) => call('script.setLibrarySettings', { values, expectedRevision })
    }),
    ui: Object.freeze<ElecKoiAuthorApi['ui']>({
      registerButton: button => {
        if (runtime.closed) throw new AuthorApiError('FRAME_CLOSED', '作者页面已经关闭')
        if (!adapter?.registerButton) throw new AuthorApiError('UI_UNAVAILABLE', '只有运行中的原生脚本可以注册聊天按钮')
        if (!button || typeof button.id !== 'string' || !button.id.trim() || typeof button.label !== 'string'
          || !button.label.trim() || typeof button.onClick !== 'function') {
          throw new AuthorApiError('INVALID_PARAMS', '脚本按钮需要固定 id、label 和 onClick 函数')
        }
        const dispose = adapter.registerButton({ id: button.id, label: button.label, onClick: signal => {
          const invocation = new global.AbortController(), invocationSignal = invocation.signal
          const cancelButton = () => invocation.abort(signal.reason), cancelFrame = () => invocation.abort(lifetime.signal.reason)
          signal.addEventListener('abort', cancelButton, { once: true }); lifetime.signal.addEventListener('abort', cancelFrame, { once: true })
          if (signal.aborted) cancelButton()
          if (lifetime.signal.aborted) cancelFrame()
          const hostCall: ElecKoiAuthorApi['call'] = (method, params = {}) => dispatch(method, params, false, invocationSignal)
          return Promise.resolve().then(() => { invocationSignal.throwIfAborted(); return button.onClick({ api: createApi(hostCall), signal: invocationSignal }) }).finally(() => {
            signal.removeEventListener('abort', cancelButton); lifetime.signal.removeEventListener('abort', cancelFrame)
            invocation.abort(new AuthorApiError('BUTTON_FINISHED', '本次按钮回调已经结束'))
          })
        } })
        const stop = () => { if (ruleStops.delete(stop)) dispose() }
        ruleStops.add(stop)
        return stop
      },
      openPanel: panel => call('ui.openPanel', { ...panel }),
      closePanel: id => call('ui.closePanel', { id })
    }),
    variables: Object.freeze<ElecKoiAuthorApi['variables']>({
      getState: (options = {}) => call('variables.getState', options), getConfig: () => call('variables.getConfig'),
      setState: state => call('variables.setState', { state }), merge: state => call('variables.merge', { state }),
      applyPatch: patch => call('variables.applyPatch', { patch }), reset: () => call('variables.reset'),
      registerRule: rule => {
        if (runtime.closed) throw new AuthorApiError('FRAME_CLOSED', '作者页面已经关闭')
        if (!adapter?.registerVariableRule) throw new AuthorApiError('RULES_UNAVAILABLE', '当前页面没有安装原生作者变量规则服务')
        if (!rule || typeof rule.id !== 'string' || !rule.id.trim()
          || !['before', 'after', 'afterSchema'].includes(rule.stage) || typeof rule.run !== 'function') {
          throw new AuthorApiError('INVALID_PARAMS', '变量规则需要 id、处理阶段与 run 函数')
        }
        const dispose = adapter.registerVariableRule(rule)
        const stop = () => { if (ruleStops.delete(stop)) dispose() }
        ruleStops.add(stop)
        return stop
      }
    }),
    openings: Object.freeze<ElecKoiAuthorApi['openings']>({ list: () => call('openings.list'), current: () => call('openings.current'), select: id => call('openings.select', { id }) }),
    messages: Object.freeze<ElecKoiAuthorApi['messages']>({
      list: () => call('messages.list'), getPage: () => call('messages.getPage'),
      pageOlder: beforeSequence => call('messages.pageOlder', { beforeSequence }),
      get: id => call('messages.get', { id }), current: () => call('messages.current'),
      setContent: (id, text) => call('messages.setContent', { id, text }), deleteFrom: id => call('messages.deleteFrom', { id }),
      regenerate: id => call('messages.regenerate', { id }), editAndRegenerate: (id, text) => call('messages.editAndRegenerate', { id, text })
    }),
    chat: Object.freeze<ElecKoiAuthorApi['chat']>({
      current: () => call('chat.current'), list: () => call('chat.list'), getGenerationState: () => call('chat.getGenerationState'),
      getAgentTrajectory: (options = {}) => call('chat.getAgentTrajectory', options), getModels: () => call('chat.getModels'),
      send: async (text, options = {}) => call('chat.send', { text, attachments: await Promise.all((options.attachments ?? []).map(serializeAttachment)) }),
      stopGeneration: () => call('chat.stopGeneration'), create: (options = {}) => call('chat.create', options),
      open: conversationId => call('chat.open', { id: conversationId }), delete: conversationId => call('chat.delete', { id: conversationId }),
      selectModel: options => call('chat.selectModel', options)
    }),
    character: Object.freeze<ElecKoiAuthorApi['character']>({ current: () => call('character.current') }),
    settingLibrary: Object.freeze<ElecKoiAuthorApi['settingLibrary']>({
      current: () => call('settingLibrary.current'), getSummary: () => call('settingLibrary.getSummary'),
      replace: library => call('settingLibrary.replace', { library }),
      getEntry: id => call('settingLibrary.getEntry', { id }),
      updateEntry: (id, changes) => call('settingLibrary.updateEntry', { id, changes }),
      updateEntries: updates => call('settingLibrary.updateEntries', { updates })
    }),
    presets: Object.freeze<ElecKoiAuthorApi['presets']>({
      list: () => call('presets.list'), current: () => call('presets.current'),
      get: presetId => call('presets.get', { presetId }),
      getEntry: (presetId, id) => call('presets.getEntry', { presetId, id }),
      updateEntry: (presetId, id, changes) => call('presets.updateEntry', { presetId, id, changes }),
      updateEntries: (presetId, updates) => call('presets.updateEntries', { presetId, updates }),
      select: presetId => call('presets.select', { presetId })
    }),
    media: Object.freeze<ElecKoiAuthorApi['media']>({
      getMessageAttachments: messageId => call('media.getMessageAttachments', { messageId }),
      getMessageAttachment: (messageId, attachmentId) => call('media.getMessageAttachment', { messageId, attachmentId })
    }),
    audio: Object.freeze<ElecKoiAuthorApi['audio']>({
      play: options => call('audio.play', options), pause: (channel = 'bgm') => call('audio.pause', { channel }),
      resume: (channel = 'bgm') => call('audio.resume', { channel }), stop: (channel = 'bgm') => call('audio.stop', { channel }),
      seek: (seconds, channel = 'bgm') => call('audio.seek', { channel, seconds }), getState: (channel = 'bgm') => call('audio.getState', { channel }),
      getPlaylist: (channel = 'bgm') => call('audio.getPlaylist', { channel }),
      setPlaylist: (channel, items, options = {}) => call('audio.setPlaylist', { channel, items, ...options }),
      appendPlaylist: (channel, items) => call('audio.appendPlaylist', { channel, items }), getSettings: () => call('audio.getSettings'),
      setSettings: settings => call('audio.setSettings', { settings })
    }),
    input: Object.freeze<ElecKoiAuthorApi['input']>({
      get: () => call('input.get'), set: text => call('input.set', { text }), append: text => call('input.append', { text }),
      clear: () => call('input.clear'), send: () => call('input.send')
    }),
    events: Object.freeze<ElecKoiAuthorApi['events']>({ list: () => call('events.list'), on, off })
    })
  }
  const api = createApi(dispatch)
  global.ElecKoi = api
  return api
}
