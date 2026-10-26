import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installElecKoiAuthorApi } from '@eleckoi/author-sdk/browser'
import { installTavernFrontend, prepareFrontendCompatibilitySource, activateFrontendCompatibilityScripts, mountFrontendCompatibility } from '../src/index'
import { NativeAudioRuntime, nativeAudioMethods } from '../../../client/features/dsh-client-author/src/audio'
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
    const prior = methods['events.list']; methods['events.list'] = () => ({ items: [...prior({}).items, 'audio.state.changed', 'audio.time.updated'] })
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
