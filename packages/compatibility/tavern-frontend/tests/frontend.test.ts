// @ts-expect-error The browser test runtime does not publish declarations.
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installElecKoiAuthorApi } from '@eleckoi/author-sdk/browser'
import { installTavernFrontend, prepareFrontendCompatibilitySource, activateFrontendCompatibilityScripts, mountFrontendCompatibility } from '@eleckoi/tavern-frontend'
import { NativeAudioRuntime, nativeAudioMethods } from '@eleckoi/dsh-client-author/audio'
import { NativeAudioElement } from '../../../../tests/helpers/nativeAudioElement'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(close => close()))

async function fixture(count = 3, withAudio = false) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', runScripts: 'dangerously' })
  const page: any = dom.window, listeners = new Map<string, Set<(payload: any) => void>>()
  let state: any = { score: 1, nested: { value: 2 } }, owner = 'synthetic-chat'
  let messages: any[] = Array.from({ length: count }, (_, index) => ({ id: `synthetic-message-${index}`, conversationId: owner,
    role: index % 2 ? 'assistant' : 'user', content: `Synthetic text ${index}`, speakerName: `Synthetic speaker ${index % 2}`,
    variableState: { score: index }, status: 'complete', attachments: [] }))
  const library: any = { characterId: 'synthetic-character', name: 'Synthetic settings', groups: [], promptPositions: [],
    entries: Array.from({ length: count }, (_, index) => ({ id: `synthetic-entry-${index}`, kind: 'normal', title: `Synthetic setting ${index}`,
      content: `Synthetic long content ${index}\n${'x'.repeat(1200)}\nSynthetic tail ${index}`, enabled: true, keywords: [`key-${index}`], position: 'instructions' })) }
  const methods: Record<string, (params: any) => any> = {
    'context.current': () => ({ surface: 'message-renderer', scope: 'current-character', conversationId: owner, messageId: 'synthetic-message-1', characterId: 'synthetic-character' }),
    'app.getCapabilities': () => Object.keys(methods).map(method => ({ method })),
    'messages.getPage': () => ({ items: structuredClone(messages), hasMore: false, beforeSequence: null }),
    'messages.setContent': ({ id, text }) => { const message = messages.find(item => item.id === id); if (!message) throw new Error('Missing message'); message.content = text; return structuredClone(message) },
    'variables.getState': () => structuredClone(state),
    'variables.setState': ({ state: next }) => { state = structuredClone(next); return structuredClone(state) },
    'character.current': () => ({ id: 'synthetic-character', name: 'Synthetic character' }),
    'presets.list': () => ({ activePresetId: 'synthetic-preset', items: [{ id: 'synthetic-preset', name: 'Synthetic preset' }] }),
    'settingLibrary.getSummary': () => ({ name: library.name, characterId: library.characterId, entryCount: library.entries.length }),
    'settingLibrary.current': () => structuredClone(library),
    'settingLibrary.updateEntries': ({ updates }) => updates.map((update: any) => { const entry = library.entries.find((item: any) => item.id === update.id); Object.assign(entry, update.changes); return structuredClone(entry) }),
    'input.get': () => ({ text: 'Synthetic draft' }), 'input.set': ({ text }) => ({ text }),
    'chat.stopGeneration': () => ({ cancelled: true }),
    'events.list': () => ({ items: ['messages.changed', 'agent.output.delta', 'agent.state.changed', 'agent.run.finished', 'agent.run.cancelled'] }),
  }
  const audioElements: NativeAudioElement[] = []
  let nativeAudio: NativeAudioRuntime | undefined
  if (withAudio) {
    nativeAudio = new NativeAudioRuntime({ createAudio: () => { const element = new NativeAudioElement(); audioElements.push(element); return element as unknown as HTMLAudioElement },
      emit: event => { for (const listener of listeners.get(event.name) || []) listener(event.payload) }, report: error => { throw error } })
    for (const method of nativeAudioMethods) methods[method] = params => nativeAudio!.invoke(owner, method, params)
    const prior = methods['events.list']!; methods['events.list'] = () => ({ items: [...prior({}).items, 'audio.state.changed', 'audio.time.updated'] })
  }
  const request = vi.fn(async (method: string, params: any) => {
    if (!methods[method]) throw new Error(`Unsupported native method: ${method}`)
    return methods[method](params)
  })
  const sdk = installElecKoiAuthorApi(page, { request, on: (event, listener) => {
    const entries = listeners.get(event) || new Set(); entries.add(listener); listeners.set(event, entries)
    return () => { entries.delete(listener); if (!entries.size) listeners.delete(event) }
  } })
  const report = vi.fn(), controller = await installTavernFrontend(page, sdk, { report })
  cleanups.push(() => { controller.dispose(); nativeAudio?.dispose(); dom.window.close() })
  return { page, sdk, controller, request, methods, report, library, listeners, audioElements,
    get state() { return state }, get messages() { return messages },
    select: (id: string) => { owner = id },
    emit: (name: string, payload: any) => { for (const listener of listeners.get(name) || []) listener(payload) },
  }
}

describe('frontend compatibility through the real author SDK dispatcher', () => {
  it('reads detached message views and maps edits to stable native IDs', async () => {
    const value = await fixture()
    expect(value.page.getChatMessages('0-1').map((item: any) => item.message)).toEqual(['Synthetic text 0', 'Synthetic text 1'])
    expect(value.page.getCurrentMessageId()).toBe(1)
    expect(value.page.getChatMessages('{{lastMessageId}}', { include_swipes: false, hide_state: 'all' })[0].native_id).toBe('synthetic-message-2')
    expect(value.page.getChatMessages('999-1000')).toEqual([])
    const detached = value.page.getChatMessages(-1); detached[0].message = 'Uncommitted'
    expect(value.messages[2].content).toBe('Synthetic text 2')
    await value.page.setChatMessages([{ message_id: 1, message: 'Synthetic edited' }])
    expect(value.request).toHaveBeenCalledWith('messages.setContent', { id: 'synthetic-message-1', text: 'Synthetic edited' }, expect.anything())
    expect(value.page.getChatMessages(1)[0].message).toBe('Synthetic edited')
    const count = value.request.mock.calls.length
    expect(() => value.page.setChatMessages([{ message_id: 0, message: 'Never saved' }, { message_id: 1, is_hidden: true }])).toThrow(/is_hidden/)
    expect(value.request.mock.calls.length).toBe(count)
  })
  it('keeps pending variable edits in memory, persists through SDK, and rolls back rejected writes', async () => {
    const value = await fixture()
    value.page.replaceVariables({ score: 2 })
    expect(value.page.getVariables()).toEqual({ score: 2 })
    value.page.updateVariablesWith((state: any) => { state.score++ })
    await value.controller.flush()
    expect(value.state).toEqual({ score: 3 })
    expect(value.page.getVariables({ type: 'message', message_id: 0 })).toEqual({ score: 0 })
    expect(() => value.page.replaceVariables({}, { type: 'global' })).toThrow(/global/)
    value.methods['variables.setState'] = () => { throw new Error('Synthetic write rejected') }
    value.page.replaceVariables({ score: 99 })
    await expect(value.controller.flush()).rejects.toThrow('前端兼容操作未完成')
    expect(value.page.getVariables()).toEqual({ score: 3 })
    expect(value.report).toHaveBeenCalled()
  })
  it('projects any native JSON tree without interpreting its keys or changing native reads', async () => {
    const value = await fixture()
    const state = { records: { alpha: { amount: 7, optional: null } }, list: [1, false, 'Synthetic'], stat_data: { kept: true } }
    await value.sdk.variables.setState(state); await value.controller.refresh()
    expect(await value.page.waitGlobalInitialized('Mvu')).toBe(value.page.Mvu)
    expect(value.page.getAllVariables()).toEqual({ stat_data: state })
    expect(value.page.Mvu.getMvuData()).toEqual({ stat_data: state })
    expect(value.page.getVariables()).toEqual(state)
    const detached = value.page.getAllVariables(); detached.stat_data.records.alpha.amount = 99
    expect(value.state).toEqual(state)
    expect(value.page.Mvu.getMvuData({ type: 'message', message_id: 0 })).toEqual({ stat_data: { score: 0 } })
    value.messages[0].variableState = null; await value.controller.refresh()
    expect(() => value.page.Mvu.getMvuData({ type: 'message', message_id: 0 })).toThrow(/没有历史变量/)
    expect(() => value.page.Mvu.getMvuData({ type: 'global' })).toThrow(/global/)
    expect(() => value.page.getAllVariables({ type: 'global' })).toThrow(/参数/)
    await expect(value.page.waitGlobalInitialized('SyntheticMissingService')).rejects.toThrow(/不支持/)
    expect(value.page.Mvu.parseMessage).toBeUndefined()
    expect(value.page.Mvu.replaceMvuData).toBeUndefined()
  })
  it('notifies only accepted variable changes, after native refresh, with detached read-only payloads', async () => {
    const value = await fixture(), listener = vi.fn((after: any) => {
      expect(value.page.getAllVariables()).toEqual(after)
      expect(Object.isFrozen(after.stat_data)).toBe(true)
    })
    value.page.eventOn(value.page.Mvu.events.VARIABLE_UPDATE_ENDED, listener)
    await value.sdk.variables.setState({ score: 9, optional: null })
    value.emit('messages.changed', { conversationId: 'synthetic-chat', reason: 'edited', messageIds: [] })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    expect(listener).toHaveBeenLastCalledWith({ stat_data: { score: 9, optional: null } }, { stat_data: { score: 1, nested: { value: 2 } } })
    value.emit('messages.changed', { conversationId: 'synthetic-chat', reason: 'edited', messageIds: [] })
    await value.controller.refresh(); await value.controller.flush()
    expect(listener).toHaveBeenCalledOnce()
    value.methods['variables.setState'] = () => { throw new Error('Synthetic rejected state') }
    value.page.replaceVariables({ score: 100 })
    await expect(value.controller.flush()).rejects.toThrow()
    expect(listener).toHaveBeenCalledOnce()
    expect(value.page.getAllVariables()).toEqual({ stat_data: { score: 9, optional: null } })
  })
  it('refreshes committed variables on generation completion without polling', async () => {
    const value = await fixture(), listener = vi.fn()
    value.page.eventOn(value.page.Mvu.events.VARIABLE_UPDATE_ENDED, listener)
    await value.sdk.variables.setState({ score: 8 })
    value.emit('agent.run.finished', { conversationId: 'synthetic-chat', runId: 'synthetic-session', generationId: 'synthetic-generation',
      turn: 1, reason: 'completed', message: value.messages[1] })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    expect(value.page.getAllVariables()).toEqual({ stat_data: { score: 8 } })
  })
  it('does not let an older overlapping read overwrite the latest variable view', async () => {
    const value = await fixture(), listener = vi.fn()
    value.page.eventOn(value.page.Mvu.events.VARIABLE_UPDATE_ENDED, listener)
    let complete!: (state: any) => void
    value.methods['variables.getState'] = vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      .mockResolvedValue({ revision: 3 })
    const earlier = value.controller.refresh()
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await value.controller.refresh(); complete({ revision: 2 }); await earlier
    expect(value.page.getAllVariables()).toEqual({ stat_data: { revision: 3 } })
    expect(listener).toHaveBeenCalledOnce()
  })
  it('preserves diagnostic wrapper results, receivers and synchronous or asynchronous failures', async () => {
    const value = await fixture()
    const wrapped = value.page.errorCatched(function (this: { offset: number }, number: number) { return this.offset + number })
    expect(wrapped.call({ offset: 4 }, 2)).toBe(6)
    expect(() => value.page.errorCatched(() => { throw new Error('Synthetic synchronous failure') })()).toThrow('Synthetic synchronous failure')
    await expect(value.page.errorCatched(async () => { throw new Error('Synthetic asynchronous failure') })()).rejects.toThrow('Synthetic asynchronous failure')
    expect(value.report).toHaveBeenCalledTimes(2)
    const getAll = value.page.getAllVariables, getMvuData = value.page.Mvu.getMvuData, wait = value.page.waitGlobalInitialized
    value.controller.dispose()
    expect(() => getAll()).toThrow(/已关闭/)
    expect(() => getMvuData()).toThrow(/已关闭/)
    expect(() => wrapped()).toThrow(/已关闭/)
    await expect(wait('Mvu')).rejects.toThrow(/已关闭/)
    expect(value.page.Mvu).toBeUndefined()
  })
  it('delivers stream events without re-reading message history or settings per token', async () => {
    const value = await fixture(), listener = vi.fn()
    value.page.eventOn('stream_token_received', listener)
    value.request.mockClear()
    for (let sequence = 0; sequence < 1000; sequence++) value.emit('agent.output.delta', {
      conversationId: 'synthetic-chat', messageId: 'synthetic-message-1', generationId: 'synthetic-generation',
      operation: 'append', sequence, delta: 'x', accumulated: 'x'.repeat(sequence + 1),
    })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1000))
    expect(value.page.getChatMessages(1)[0].message).toHaveLength(1000)
    expect(value.request).not.toHaveBeenCalled()
  })
  it('preserves all 10001 long variable values and merges nested objects without replacing unrelated fields', async () => {
    const value = await fixture()
    const large = Object.fromEntries(Array.from({ length: 10001 }, (_, index) => [`synthetic-${index}`, { body: `${'x'.repeat(256)} Synthetic tail ${index}`, keep: true }]))
    value.page.replaceVariables(large); await value.controller.flush()
    value.page.insertOrAssignVariables({ 'synthetic-10000': { keyword: 'Synthetic final keyword' } })
    await value.controller.flush()
    const result = value.page.getVariables()
    expect(Object.keys(result)).toHaveLength(10001)
    for (const index of [0, 5000, 10000]) expect(result[`synthetic-${index}`].body).toContain(`Synthetic tail ${index}`)
    expect(result['synthetic-10000']).toMatchObject({ keep: true, keyword: 'Synthetic final keyword' })
    const display = value.page.getAllVariables().stat_data
    expect(Object.keys(display)).toHaveLength(10001)
    for (const index of [0, 5000, 10000]) expect(display[`synthetic-${index}`]).toEqual(result[`synthetic-${index}`])
    const library = await value.sdk.settingLibrary.current()
    expect(library).toEqual(value.library)
    expect(value.page.getWorldbook).toBeUndefined()
  }, 20000)
  it('restores globals, removes listeners and blocks retained functions after page release', async () => {
    const value = await fixture(), getMessages = value.page.getChatMessages
    value.controller.dispose()
    expect(value.page.TavernHelper).toBeUndefined()
    expect(value.page.SillyTavern).toBeUndefined()
    expect(value.listeners.size).toBe(0)
    expect(() => getMessages()).toThrow(/已关闭/)
    expect(value.page.ElecKoi).toBe(value.sdk)
  })
  it('rejects an asynchronous variable update if its owning chat changes', async () => {
    const value = await fixture()
    let continueUpdate!: () => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { continueUpdate = resolve })
    const update = value.page.updateVariablesWith(async (draft: any) => {
      entered(); await gate; draft.score = 99
    })
    await started; value.select('synthetic-other-chat'); continueUpdate()
    await expect(update).rejects.toThrow(/聊天已切换/)
    expect(value.request.mock.calls.some(call => call[0] === 'variables.setState')).toBe(false)
    expect(value.state.score).toBe(1)
  })
  it('never exposes excluded services or writable transcript projections', async () => {
    const value = await fixture(), context = value.page.SillyTavern.getContext()
    for (const key of ['generateRaw', 'injectPrompts', 'getTokenCount', 'createWorldbook', 'createChatMessages', 'rotateChatMessages', 'installExtension', 'triggerSlash']) expect(value.page.TavernHelper[key]).toBeUndefined()
    expect(() => context.chat.push({})).toThrow()
    expect(context.groups).toBeUndefined()
    expect(context.saveChat).toBeUndefined()
  })
  it('reuses the native audio player, preserves playlists, deduplicates and reports percentage progress', async () => {
    const value = await fixture(3, true)
    value.page.replaceAudioList('bgm', [{ url: 'https://example.test/a.mp3', title: 'Synthetic A' }, { url: 'https://example.test/b.mp3', title: 'Synthetic B' }])
    await value.controller.flush()
    value.page.appendAudioList('bgm', [{ url: 'https://example.test/a.mp3', title: 'Duplicate URL' },
      { url: 'https://example.test/c.mp3', title: 'Synthetic A' }, { url: 'https://example.test/c.mp3', title: 'Synthetic C' }])
    await value.controller.flush()
    expect(value.page.getAudioList('bgm')).toHaveLength(3)
    expect(value.page.playAudio('bgm', { url: 'https://example.test/b.mp3', title: 'Synthetic B' })).toBeUndefined()
    await value.controller.flush()
    expect(value.page.getAudioList('bgm')).toHaveLength(3)
    const element = value.audioElements.at(-1)!
    element.currentTime = 30; element.emit('timeupdate')
    await vi.waitFor(() => expect(value.page.getCurrentAudio('bgm').progress).toBe(25))
    expect(value.page.getCurrentAudio('bgm').playing).toBe(true)
    value.page.pauseAudio('bgm'); await value.controller.flush()
    expect(value.page.getCurrentAudio('bgm').playing).toBe(false)
    expect(value.page.getAudioSettings).toBeUndefined()
  })
})

describe('author script readiness', () => {
  it('keeps ordinary HTML usable without installing pretend SDK capabilities', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', runScripts: 'dangerously' })
    const source = prepareFrontendCompatibilitySource('<body><script>window.plainCardLoaded=true</script></body>', new dom.window.DOMParser())
    dom.window.document.open(); dom.window.document.write(source); dom.window.document.close()
    const page: any = dom.window, report = vi.fn()
    const mount = mountFrontendCompatibility(page, undefined, report)
    cleanups.push(() => { mount.dispose(); dom.window.close() })
    await mount.ready
    expect(page.plainCardLoaded).toBe(true)
    expect(page.TavernHelper).toBeUndefined()
    expect(page.ElecKoi).toBeUndefined()
    expect(report).not.toHaveBeenCalled()
  })
  it('holds scripts until compatibility is ready and preserves JSON and module text', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', runScripts: 'dangerously' })
    cleanups.push(() => dom.window.close())
    const source = prepareFrontendCompatibilitySource('<!doctype html><body><script>window.cardResult=getVariables().score; document.addEventListener("DOMContentLoaded",()=>window.cardReady=true)</script><script type="application/json">{"value":"<script>"}</script></body>', new dom.window.DOMParser())
    dom.window.document.open(); dom.window.document.write(source); dom.window.document.close()
    const page: any = dom.window
    expect(page.cardResult).toBeUndefined()
    page.getVariables = () => ({ score: 42 })
    await activateFrontendCompatibilityScripts(page, () => true)
    expect(page.cardResult).toBe(42)
    expect(page.cardReady).toBe(true)
    expect(page.document.querySelector('script[type="application/json"]').textContent).toContain('<script>')
  })
})
