import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
// @ts-expect-error The browser test runtime does not publish declarations.
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAuthorClient } from '@eleckoi/dsh-client-author/runtime'
import type { ElecKoiAuthorApi } from '@eleckoi/author-sdk'
import { dshClientPlugin } from './helpers/dshClientPlugin'
// @ts-expect-error The installed-bundle test loader does not publish declarations.
import { officialTrajectoryFixture } from './helpers/officialTrajectory.js'

const source = readFileSync(new URL('../packages/client/features/dsh-client-conversations/src/client.js', import.meta.url), 'utf8')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const event = (type: string, seq: number, data: unknown, surfaceOp?: string) => ({ type, seq, time: seq * 10, data,
  ...(surfaceOp === undefined ? {} : { surfaceOp }) })

function history() {
  return [event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic input' }] }, 'append'),
    event('step/start', 3, { turn: 1, step: 1 }),
    event('request/header', 4, { reason: 'initial', startsSeries: true, header: {
      config: { provider: 'synthetic-provider', model: 'synthetic-model' },
      tools: [{ name: 'synthetic_tool', description: 'Synthetic tool', parameters: { type: 'object' } }],
    } }),
    event('assistant/message', 5, { turn: 1, step: 1, stream: [], message: {
      id: 'synthetic-reply', role: 'assistant', source: { provider: 'synthetic-provider', model: 'synthetic-model' },
      content: [{ type: 'reasoning', text: 'Synthetic final reasoning' }, { type: 'text', text: 'Synthetic reply' },
        { type: 'tool-call', id: 'synthetic-call', name: 'synthetic_tool', arguments: '{"value":2}' }],
    } }, 'append'),
    event('tool/call', 6, { turn: 1, step: 1, callId: 'synthetic-call', name: 'synthetic_tool', arguments: '{"value":2}' }),
    event('tool/ptc-dispatch-start', 7, { rootCallId: 'synthetic-call', parentCallId: 'synthetic-call', subCallId: 'synthetic-child', name: 'synthetic_child_tool', arguments: { value: 2 } }),
    event('tool/ptc-dispatch', 8, { rootCallId: 'synthetic-call', parentCallId: 'synthetic-call', subCallId: 'synthetic-child', name: 'synthetic_child_tool',
      arguments: { value: 2 }, isError: false, content: [{ type: 'text', text: 'Synthetic child result' }] }),
    event('tool/result', 9, { turn: 1, step: 1, message: { role: 'tool', source: { callId: 'synthetic-call' },
      content: [{ type: 'text', text: 'Synthetic tool result' }], isError: false } }, 'append'),
    event('step/end', 10, { turn: 1, step: 1 }), event('turn/end', 11, { turn: 1, reason: { kind: 'completed' } })]
}

async function harness(events = history(), hasMore = false) {
  const engine = officialTrajectoryFixture()
  let trajectory = engine.replace(events, hasMore)
  const details = { conversation: { id: 'synthetic-chat', title: 'Synthetic chat' },
    metadata: { characterId: 'synthetic-role', characterName: 'Synthetic role', characterAvatar: '' },
    runtimeSessionId: 'synthetic-session', messages: [], hasMore, beforeSequence: hasMore ? 2 : null }
  let registration: any, catalog: any, closeCatalog = () => {}
  runInNewContext(source, { AbortController, window: { __ModuleLoader__: { load: (value: any) => { registration = value } } } })
  dshClientPlugin(registration).apply({ remote: { eleckoiConversations: {
    changes: (signal: AbortSignal) => (async function* () {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    })(),
    list: async () => ({ ok: true, value: [{ ...details.conversation, runtimeSessionId: details.runtimeSessionId }] }),
    details: async () => ({ ok: true, value: details }),
  } }, provide: (_name: string, service: any) => { catalog = service }, on: () => () => {},
  effect: (run: () => () => void) => { closeCatalog = run() } })
  await catalog.open('synthetic-chat')
  const binding = { session: {}, eventSource: {} }
  catalog.sessionReference = { sessionId: 'synthetic-session', binding, release() {} }
  catalog.sessionTarget = {}
  const target = vi.fn((name: string) => {
    expect(name).toBe('trajectory')
    return { getSnapshot: () => trajectory }
  })
  catalog.uiConversation = { binding: (value: unknown) => { expect(value).toBe(binding); return { target } } }
  const page = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
  const runtime = new NativeAuthorClient({ window: page.window, remote: {} as any, conversations: catalog,
    models: {} as any, libraries: {} as any, report: vi.fn() })
  runtime.mountDocument(page.window, 'synthetic-chat', '')
  cleanups.push(async () => { await runtime.dispose(); page.window.close(); closeCatalog() })
  return { api: page.window.ElecKoi as ElecKoiAuthorApi, page, runtime, catalog, target, engine,
    get trajectory() { return trajectory }, set trajectory(value: any) { trajectory = value } }
}

describe('native author trajectory', () => {
  it('reads the actual registered trajectory target without flattening reasoning, nested tools, request identities or hierarchy', async () => {
    const r = await harness(), result = await r.api.chat.getAgentTrajectory()
    expect(r.target).toHaveBeenCalledExactlyOnceWith('trajectory')
    expect(result).toMatchObject({ conversationId: 'synthetic-chat', runtimeSessionId: 'synthetic-session',
      history: { hasMore: false, beforeSequence: null } })
    expect(result.snapshot.events).toEqual(r.trajectory.eventNodes)
    expect(result.snapshot.requests).toEqual(r.trajectory.requests)
    expect(result.snapshot.requests).toContainEqual(expect.objectContaining({ purpose: 'assistant', startSeq: 3, resultSeq: 5, status: 'complete' }))
    const assistant = result.snapshot.events.find(item => item.kind === 'assistant')!
    expect(assistant).toMatchObject({ kind: 'assistant', messageId: 'synthetic-reply', blocks: [
      { kind: 'reasoning', text: 'Synthetic final reasoning' }, { kind: 'text', text: 'Synthetic reply' },
      { kind: 'tool-call', callId: 'synthetic-call', name: 'synthetic_tool', argsRaw: '{"value":2}' },
    ] })
    const tool = result.snapshot.events.find(item => item.kind === 'tool-result')!
    expect(tool).toMatchObject({ callId: 'synthetic-call', subCalls: [{ kind: 'tool-result', callId: 'synthetic-child',
      parentCallId: 'synthetic-call', content: [{ type: 'text', text: 'Synthetic child result' }] }] })
    expect(result.snapshot.locations.get(2)).toEqual({ kind: 'turn', turn: 1, turnStatus: 'closed' })
    expect(result.snapshot.toolSchemas.get('synthetic-call')).toMatchObject({ name: 'synthetic_tool' })
    expect(result.snapshot).not.toHaveProperty('eventLocations')
    expect(JSON.stringify(result)).not.toContain('totalRecords')
    ;(assistant as any).blocks[0].text = 'Synthetic page-only change'
    ;(result.snapshot.toolSchemas.get('synthetic-call') as any).name = 'Synthetic page-only schema'
    ;(result.snapshot.locations as Map<number, unknown>).clear()
    expect((await r.api.chat.getAgentTrajectory()).snapshot.events).toEqual(r.trajectory.eventNodes)
    expect(r.trajectory.callSchemas.get('synthetic-call').name).toBe('synthetic_tool')
    expect(r.trajectory.eventLocations.get(2).turn.data).toBeTruthy()
  })

  it('preserves real partial output, active tool phases, unpaired results and requests whose final record is outside the window', async () => {
    const r = await harness(history().slice(0, 7)), result = await r.api.chat.getAgentTrajectory()
    expect(result.snapshot.runningTools).toMatchObject([{ callId: 'synthetic-call', phase: 'start',
      subCalls: [{ callId: 'synthetic-child', phase: 'start' }] }])
    r.engine.append(event('step/start', 12, { turn: 1, step: 2 }))
    r.trajectory = r.engine.append(event('assistant/live-chunk', 13, { turn: 1, step: 2,
      chunk: { type: 'text-delta', index: 0, text: 'Synthetic live prefix' } }))
    const live = await r.api.chat.getAgentTrajectory()
    expect(live.snapshot.partial).toEqual(r.trajectory.partial)
    expect(live.snapshot.partial).toMatchObject({ turn: 1, step: 2, blocks: [{ kind: 'text', text: 'Synthetic live prefix' }] })
    expect(live.snapshot.requests).toEqual(r.trajectory.requests)
    expect(live.snapshot.requests.find(item => item.startSeq === 3)?.resultSeq).toBe(5)
    r.trajectory = r.engine.replace(history().filter(item => item.seq >= 9), true)
    const orphan = await r.api.chat.getAgentTrajectory()
    expect(orphan.snapshot.events).toContainEqual(expect.objectContaining({ kind: 'tool-result', callId: 'synthetic-call', call: null, callTime: null }))
    expect(orphan.snapshot.events).toEqual(r.trajectory.eventNodes)
  })

  it('loads older history only with its exact current cursor and preserves real failures', async () => {
    const r = await harness(history(), true)
    const pageOlder = vi.fn(async (_id: string, _cursor: number) => {
      r.trajectory = r.engine.prepend([event('system/message', 0, { turn: 0, step: 0, message: {
        id: 'synthetic-system', role: 'system', source: { kind: 'system' }, content: [{ type: 'text', text: 'Synthetic system text' }] } }, 'append')])
      r.catalog.detailsSnapshot.details = { ...r.catalog.detailsSnapshot.details, hasMore: false, beforeSequence: null }
      return r.catalog.detailsSnapshot.details
    })
    r.catalog.pageOlder = pageOlder
    await expect(r.api.chat.getAgentTrajectory({ beforeSequence: 1 })).rejects.toMatchObject({ code: 'STALE_HISTORY_CURSOR' })
    await expect(r.api.call('chat.getAgentTrajectory', { beforeIndex: 1, limit: 5 })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(pageOlder).not.toHaveBeenCalled()
    const before = await r.api.chat.getAgentTrajectory()
    expect(before.history.hasMore).toBe(true)
    const older = await r.api.chat.getAgentTrajectory({ beforeSequence: before.history.beforeSequence! })
    expect(pageOlder).toHaveBeenCalledExactlyOnceWith('synthetic-chat', 2)
    expect(older.history).toEqual({ hasMore: false, beforeSequence: null })
    expect(older.snapshot.requests[0]).toMatchObject({ prompt: { system: 'Synthetic system text' }, promptChange: { seq: 0 } })
    await expect(r.api.chat.getAgentTrajectory({ beforeSequence: 2 })).rejects.toMatchObject({ code: 'STALE_HISTORY_CURSOR' })
    r.catalog.uiConversation.binding = () => { throw new Error('Synthetic trajectory failure') }
    await expect(r.api.chat.getAgentTrajectory()).rejects.toThrow('Synthetic trajectory failure')
  })

  it('rejects missing Session and late results after chat switch instead of reading the replacement chat', async () => {
    const r = await harness()
    r.catalog.detailsSnapshot.details.runtimeSessionId = ''
    await expect(r.api.chat.getAgentTrajectory()).rejects.toMatchObject({ code: 'SESSION_NOT_READY' })
    r.catalog.detailsSnapshot.details.runtimeSessionId = 'synthetic-session'
    let finish!: (value: unknown) => void
    r.catalog.readTrajectory = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const pending = r.api.chat.getAgentTrajectory(), rejected = expect(pending).rejects.toMatchObject({ code: 'FRAME_CLOSED' })
    r.catalog.activate('synthetic-next-chat'); await r.runtime.refresh()
    finish(r.trajectory); await rejected
    expect(r.catalog.readTrajectory).toHaveBeenCalledExactlyOnceWith('synthetic-chat')
    await expect(r.api.chat.getAgentTrajectory()).rejects.toMatchObject({ code: 'FRAME_CLOSED' })
  })

  it('does not accept a snapshot from a changed Session or substitute an empty projection on target failure', async () => {
    const r = await harness()
    let finish!: (value: unknown) => void
    r.catalog.readTrajectory = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const pending = r.api.chat.getAgentTrajectory(), rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    r.catalog.detailsSnapshot.details.runtimeSessionId = 'synthetic-replacement-session'
    finish(r.trajectory); await rejected
    r.catalog.detailsSnapshot.details.runtimeSessionId = 'synthetic-session'
    delete r.catalog.readTrajectory
    r.trajectory = null
    await expect(r.api.chat.getAgentTrajectory()).rejects.toThrow('轨迹投影尚未就绪')
  })
})
