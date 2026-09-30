import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/dsh-client-conversations/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

interface Result {
  ok: boolean
  data?: Array<{ id: string }>
  error?: { message: string }
}

function mountCatalog(
  request: (name?: string, input?: unknown) => Promise<Result | unknown>,
  runtime: {
    allowOtherQueries?: boolean
    requestAnimationFrame?: (callback: () => void) => number
    cancelAnimationFrame?: (id: number) => void
  } = {}
) {
  let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
  let onEvent: ((event: unknown) => void) | undefined
  let stopped = false
  let cleanup = () => {}
  let catalog: {
    getSnapshot: () => { status: string; items: Array<{ id: string }>; error: string }
    subscribe: (listener: () => void) => () => void
    refresh: () => Promise<Array<{ id: string }>>
  } | undefined
  const bridge = {
    request: (name: string, input: unknown) => {
      if (!runtime.allowOtherQueries) {
        expect(name).toBe('query.conversations.list')
        expect(input).toEqual({})
      }
      return request(name, input)
    },
    subscribe: (listener: (event: unknown) => void) => {
      onEvent = listener
      return () => { stopped = true; onEvent = undefined }
    }
  }
  runInNewContext(source, {
    requestAnimationFrame: runtime.requestAnimationFrame,
    cancelAnimationFrame: runtime.cancelAnimationFrame,
    window: {
      eleckoi: bridge,
      __ModuleLoader__: { load: (item: typeof registration) => { registration = item } }
    }
  })
  expect(registration?.id).toBe('@eleckoi/dsh-client-conversations')
  dshClientPlugin(registration!).apply({
    provide: (name: string, value: typeof catalog) => {
      expect(name).toBe('eleckoiConversations')
      catalog = value
    },
    effect: (run: () => () => void) => { cleanup = run() },
    on: () => () => {}
  })
  if (!catalog) throw new Error('Conversation catalog was not provided')
  return {
    catalog,
    emit: (event: unknown) => onEvent?.(event),
    dispose: () => cleanup(),
    isStopped: () => stopped
  }
}

describe('DSH ElecKoi conversation client model', () => {
  it('keeps the latest baseline when requests finish out of order and releases its listener', async () => {
    const pending: Array<(result: Result) => void> = []
    const mounted = mountCatalog(() => new Promise(resolve => pending.push(resolve)))
    expect(pending).toHaveLength(1)
    let changes = 0
    mounted.catalog.subscribe(() => { changes += 1 })
    const latest = mounted.catalog.refresh()
    expect(pending).toHaveLength(2)
    pending[1]!({ ok: true, data: [{ id: 'recent' }] })
    expect((await latest).map(item => item.id)).toEqual(['recent'])
    pending[0]!({ ok: true, data: [{ id: 'older' }] })
    await settle()
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['recent'])
    expect(changes).toBe(1)

    mounted.emit({ name: 'records.changed', payload: { module: 'personas' } })
    expect(pending).toHaveLength(2)
    mounted.emit({ name: 'records.changed', payload: { module: 'conversations' } })
    expect(pending).toHaveLength(3)
    pending[2]!({ ok: true, data: [{ id: 'after-change' }] })
    await settle()
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['after-change'])

    mounted.dispose()
    expect(mounted.isStopped()).toBe(true)
    mounted.emit({ name: 'records.changed', payload: { module: 'conversations' } })
    expect(pending).toHaveLength(3)
  })

  it('keeps the last valid baseline when a later read fails', async () => {
    const responses: Result[] = [
      { ok: true, data: [{ id: 'saved' }] },
      { ok: false, error: { message: 'read failed' } }
    ]
    const mounted = mountCatalog(async () => responses.shift()!)
    await settle()
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['saved'])
    await expect(mounted.catalog.refresh()).rejects.toThrow('read failed')
    expect(mounted.catalog.getSnapshot().status).toBe('error')
    expect(mounted.catalog.getSnapshot().items.map(item => item.id)).toEqual(['saved'])
    mounted.dispose()
  })

  it('keeps the chosen history for each character across view changes', async () => {
    const mounted = mountCatalog(async () => ({ ok: true, data: [] }))
    const catalog = mounted.catalog as typeof mounted.catalog & {
      rememberSession: (characterId: string, sessionId: string) => void
      preferredSession: (characterId: string) => string
      forgetSession: (characterId: string, sessionId: string) => void
    }
    catalog.rememberSession('character-a', 'older-a')
    catalog.rememberSession('character-b', 'current-b')
    expect(catalog.preferredSession('character-a')).toBe('older-a')
    expect(catalog.preferredSession('character-b')).toBe('current-b')
    catalog.forgetSession('character-a', 'other-a')
    expect(catalog.preferredSession('character-a')).toBe('older-a')
    catalog.forgetSession('character-a', 'older-a')
    expect(catalog.preferredSession('character-a')).toBe('')
    mounted.dispose()
  })

  it('coalesces streaming deltas to the official frame cadence and flushes terminal state immediately', async () => {
    let nextFrame = 0
    const frames = new Map<number, () => void>()
    const mounted = mountCatalog(async (name, input) => {
      if (name === 'query.conversations.list') return { ok: true, data: [{ id: 'chat-1' }] }
      if (name === 'query.agent.inspect') {
        return { ok: true, data: { conversationId: (input as { conversationId: string }).conversationId, active: false } }
      }
      if (name === 'query.conversations.details') {
        return { ok: true, data: { conversation: { id: 'chat-1' }, messages: [] } }
      }
      throw new Error(`Unexpected query: ${name}`)
    }, {
      allowOtherQueries: true,
      requestAnimationFrame: (callback) => {
        nextFrame += 1
        frames.set(nextFrame, callback)
        return nextFrame
      },
      cancelAnimationFrame: (id) => { frames.delete(id) },
    })
    const catalog = mounted.catalog as typeof mounted.catalog & {
      activate: (id: string) => void
      getStreamSnapshot: () => { content: string; status: string; sequence: number }
      subscribeStream: (listener: () => void) => () => void
    }
    catalog.activate('chat-1')
    await settle()
    let changes = 0
    catalog.subscribeStream(() => { changes += 1 })

    mounted.emit({ name: 'agent.output.delta', payload: { conversationId: 'chat-1', runId: 'run-1', messageId: 'reply-1', sequence: 1, delta: 'a' } })
    mounted.emit({ name: 'agent.output.delta', payload: { conversationId: 'chat-1', runId: 'run-1', messageId: 'reply-1', sequence: 2, delta: 'b' } })
    mounted.emit({ name: 'agent.output.delta', payload: { conversationId: 'chat-1', runId: 'run-1', messageId: 'reply-1', sequence: 3, delta: 'c' } })
    expect(catalog.getStreamSnapshot().content).toBe('')
    expect(changes).toBe(0)

    for (let index = 0; index < 3; index += 1) {
      const entry = frames.entries().next().value as [number, () => void]
      frames.delete(entry[0])
      entry[1]()
    }
    expect(catalog.getStreamSnapshot()).toMatchObject({ content: 'abc', status: 'running', sequence: 3 })
    expect(changes).toBe(1)

    mounted.emit({ name: 'agent.output.delta', payload: { conversationId: 'chat-1', runId: 'run-1', messageId: 'reply-1', sequence: 4, delta: 'd' } })
    mounted.emit({ name: 'agent.run.finished', payload: { conversationId: 'chat-1', runId: 'run-1', message: { id: 'reply-1' } } })
    expect(catalog.getStreamSnapshot()).toMatchObject({ content: 'abcd', status: 'idle', sequence: 4 })
    expect(changes).toBe(2)
    expect(frames.size).toBe(0)
    mounted.dispose()
  })

  it('keeps the active conversation detail when earlier opens finish later', async () => {
    type Details = { conversation: { id: string }; messages: Array<{ id: string }> }
    const detail = (id: string, messageId: string): Details => ({ conversation: { id }, messages: [{ id: messageId }] })
    const pending: Array<{ id: string; resolve: (result: { ok: boolean; data: Details }) => void }> = []
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let onEvent: ((event: unknown) => void) | undefined
    let cleanup = () => {}
    let catalog: {
      getDetailsSnapshot: () => { id: string; status: string; details: Details | null }
      subscribeDetails: (listener: () => void) => () => void
      open: (id: string) => Promise<Details | null>
    } | undefined
    const bridge = {
      request: (name: string, input: { conversationId?: string }) => name === 'query.conversations.list'
        ? Promise.resolve({ ok: true, data: [{ id: 'first' }, { id: 'second' }] })
        : new Promise<{ ok: boolean; data: Details }>(resolve => {
          expect(name).toBe('query.conversations.details')
          pending.push({ id: input.conversationId!, resolve })
        }),
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    let changes = 0
    catalog.subscribeDetails(() => { changes += 1 })
    const first = catalog.open('first')
    const second = catalog.open('second')
    expect(pending.map(item => item.id)).toEqual(['first', 'second'])
    pending[1]!.resolve({ ok: true, data: detail('second', 'latest') })
    expect((await second)?.messages[0]?.id).toBe('latest')
    pending[0]!.resolve({ ok: true, data: detail('first', 'stale') })
    expect(await first).toBeNull()
    expect(catalog.getDetailsSnapshot().details?.conversation.id).toBe('second')

    onEvent?.({ name: 'records.changed', payload: { module: 'conversations' } })
    await settle()
    expect(pending[2]?.id).toBe('second')
    pending[2]!.resolve({ ok: true, data: detail('second', 'updated') })
    await settle()
    expect(catalog.getDetailsSnapshot().details?.messages[0]?.id).toBe('updated')
    expect(changes).toBe(4)
    cleanup()
    expect(onEvent).toBeUndefined()
  })

  it('clears a deleted active conversation before requesting its details again', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let onEvent: ((event: unknown) => void) | undefined
    let cleanup = () => {}
    let exists = true
    const detailRequests: string[] = []
    let catalog: {
      open: (id: string) => Promise<unknown>
      getDetailsSnapshot: () => { id: string; status: string; error: string }
    } | undefined
    const bridge = {
      request: async (name: string, input: { conversationId?: string }) => {
        if (name === 'query.conversations.list') {
          return { ok: true, data: exists ? [{ id: 'only-chat' }] : [] }
        }
        if (name === 'query.agent.inspect') {
          return { ok: true, data: { conversationId: input.conversationId, active: false } }
        }
        if (name === 'query.conversations.details') {
          detailRequests.push(input.conversationId!)
          return exists
            ? { ok: true, data: { conversation: { id: 'only-chat' }, messages: [] } }
            : { ok: false, error: { message: '找不到对应的聊天存档。' } }
        }
        throw new Error(`Unexpected query: ${name}`)
      },
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    await catalog.open('only-chat')
    expect(catalog.getDetailsSnapshot()).toMatchObject({ id: 'only-chat', status: 'ready', error: '' })

    exists = false
    onEvent?.({ name: 'records.changed', payload: { module: 'conversations' } })
    await settle()
    expect(detailRequests).toEqual(['only-chat'])
    expect(catalog.getDetailsSnapshot()).toMatchObject({ id: '', status: 'idle', error: '' })
    cleanup()
  })

  it('retains loaded history across tail refreshes and clears it after a destructive change', async () => {
    type Details = {
      conversation: { id: string }
      runtimeSessionId: string
      messages: Array<{ id: string; sequence: number }>
      hasMore: boolean
      beforeSequence: number | null
    }
    const detail = (id: string, sequences: number[], hasMore = true): Details => ({
      conversation: { id },
      runtimeSessionId: `runtime-${id}`,
      messages: sequences.map(sequence => ({ id: `${id}-${sequence}`, sequence })),
      hasMore,
      beforeSequence: sequences[0] ?? null
    })
    const responses = [detail('first', [3, 4]), detail('first', [3, 4, 5]), detail('first', [5]), detail('second', [8], false)]
    let resolvePage: ((result: unknown) => void) | undefined
    let onEvent: ((event: unknown) => void) | undefined
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let catalog: {
      getDetailsSnapshot: () => { id: string; details: Details | null; runtimeSessionId?: string }
      open: (id: string) => Promise<Details | null>
      pageOlder: (id: string, beforeSequence: number) => Promise<unknown>
      invalidateDetails: (id: string) => void
      activate: (id: string) => void
    } | undefined
    const bridge = {
      request: (name: string) => {
        if (name === 'query.conversations.list') return Promise.resolve({ ok: true, data: [{ id: 'first' }, { id: 'second' }] })
        if (name === 'query.conversations.details') return Promise.resolve({ ok: true, data: responses.shift() })
        if (name === 'query.conversations.messages') return new Promise(resolve => { resolvePage = resolve })
        throw new Error(`Unexpected query: ${name}`)
      },
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    await catalog.open('first')
    expect(await catalog.pageOlder('second', 3)).toBeNull()
    expect(await catalog.pageOlder('first', 2)).toBeNull()
    const older = catalog.pageOlder('first', 3)
    resolvePage!({ ok: true, data: {
      messages: [1, 2].map(sequence => ({ id: `first-${sequence}`, sequence })),
      hasMore: false, beforeSequence: 1
    } })
    await older
    onEvent?.({ name: 'records.changed', payload: { module: 'conversations' } })
    await settle()
    expect(catalog.getDetailsSnapshot().details?.messages.map(message => message.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(catalog.getDetailsSnapshot().details?.beforeSequence).toBe(1)

    catalog.invalidateDetails('first')
    expect(catalog.getDetailsSnapshot().details).toBeNull()
    expect(catalog.getDetailsSnapshot().runtimeSessionId).toBe('runtime-first')
    await settle()
    expect(catalog.getDetailsSnapshot().details?.messages.map(message => message.sequence)).toEqual([5])
    const stalePage = catalog.pageOlder('first', 5)
    catalog.activate('second')
    expect(catalog.getDetailsSnapshot().runtimeSessionId).toBeUndefined()
    await catalog.open('second')
    resolvePage!({ ok: true, data: { messages: [{ id: 'first-4', sequence: 4 }], hasMore: false, beforeSequence: 4 } })
    expect(await stalePage).toBeNull()
    expect(catalog.getDetailsSnapshot().id).toBe('second')
    expect(catalog.getDetailsSnapshot().details?.messages.map(message => message.sequence)).toEqual([8])
    cleanup()
  })

  it('returns the selected history while another refresh of the same history is pending', async () => {
    type Details = { conversation: { id: string }; messages: Array<{ id: string }> }
    const pending: Array<(result: { ok: boolean; data: Details }) => void> = []
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let catalog: {
      open: (id: string) => Promise<Details | null>
      refreshDetails: () => Promise<Details>
      getDetailsSnapshot: () => { id: string; details: Details | null }
    } | undefined
    let cleanup = () => {}
    runInNewContext(source, {
      window: {
        eleckoi: {
          request: (name: string) => {
            if (name === 'query.conversations.list') return Promise.resolve({ ok: true, data: [] })
            if (name === 'query.agent.inspect') return Promise.resolve({ ok: true, data: { conversationId: 'older-history', active: false } })
            expect(name).toBe('query.conversations.details')
            return new Promise(resolve => pending.push(resolve))
          },
          subscribe: () => () => {}
        },
        __ModuleLoader__: { load: (item: typeof registration) => { registration = item } }
      }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    const opening = catalog.open('older-history')
    const refresh = catalog.refreshDetails()
    const detail = { conversation: { id: 'older-history' }, messages: [{ id: 'older-message' }] }
    pending[0]!({ ok: true, data: detail })
    expect((await opening)?.conversation.id).toBe('older-history')
    pending[1]!({ ok: true, data: detail })
    await refresh
    expect(catalog.getDetailsSnapshot().details?.conversation.id).toBe('older-history')
    cleanup()
  })

  it('refreshes the open variable timeline and drops results after it closes', async () => {
    type Timeline = { floors: Array<{ id: string }> }
    const pending: Array<(result: { ok: boolean; data: Timeline }) => void> = []
    let onEvent: ((event: unknown) => void) | undefined
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let catalog: {
      getTimelineSnapshot: () => { id: string; status: string; timeline: Timeline | null }
      openTimeline: (id: string) => Promise<Timeline | null>
      closeTimeline: (id: string) => void
    } | undefined
    const bridge = {
      request: (name: string) => name === 'query.conversations.variable_timeline'
        ? new Promise<{ ok: boolean; data: Timeline }>(resolve => pending.push(resolve))
        : Promise.resolve({ ok: true, data: [{ id: 'first' }] }),
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    const opened = catalog.openTimeline('first')
    pending[0]!({ ok: true, data: { floors: [{ id: 'floor-1' }] } })
    expect((await opened)?.floors[0]?.id).toBe('floor-1')
    onEvent?.({ name: 'records.changed', payload: { module: 'conversations' } })
    await settle()
    pending[1]!({ ok: true, data: { floors: [{ id: 'floor-2' }] } })
    await settle()
    expect(catalog.getTimelineSnapshot().timeline?.floors[0]?.id).toBe('floor-2')

    const stale = catalog.openTimeline('first')
    catalog.closeTimeline('first')
    pending[2]!({ ok: true, data: { floors: [{ id: 'stale' }] } })
    expect(await stale).toBeNull()
    expect(catalog.getTimelineSnapshot().status).toBe('idle')
    cleanup()
    expect(onEvent).toBeUndefined()
  })

  it('recovers a missing stream delta from the Main baseline and settles the run', async () => {
    type Inspection = { active: boolean; conversationId: string; runId?: string; requestId?: string; messageId?: string; accumulated?: string; sequence?: number }
    const inspections: Array<(result: { ok: boolean; data: Inspection }) => void> = []
    let onEvent: ((event: unknown) => void) | undefined
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let catalog: {
      activate: (id: string) => void
      getStreamSnapshot: () => { id: string; status: string; sequence: number; content: string; process: Array<{ id: string }> }
    } | undefined
    const bridge = {
      request: (name: string) => {
        if (name === 'query.agent.inspect') return new Promise<{ ok: boolean; data: Inspection }>(resolve => inspections.push(resolve))
        if (name === 'query.conversations.details') return Promise.resolve({
          ok: true, data: { conversation: { id: 'first' }, messages: [{ id: 'assistant' }], hasMore: false, beforeSequence: null }
        })
        return Promise.resolve({ ok: true, data: [] })
      },
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    catalog.activate('first')
    inspections[0]!({ ok: true, data: { active: false, conversationId: 'first' } })
    await settle()
    onEvent?.({ name: 'agent.output.delta', payload: {
      conversationId: 'first', runId: 'run-1', messageId: 'assistant', sequence: 1, delta: 'A'
    } })
    expect(catalog.getStreamSnapshot().content).toBe('A')
    onEvent?.({ name: 'agent.output.delta', payload: {
      conversationId: 'first', runId: 'run-1', messageId: 'assistant', sequence: 3, delta: 'C'
    } })
    inspections[1]!({ ok: true, data: {
      active: true, conversationId: 'first', runId: 'run-1', requestId: 'request-1', messageId: 'assistant', accumulated: 'ABC', sequence: 3
    } })
    await settle()
    expect(catalog.getStreamSnapshot().content).toBe('ABC')
    expect(catalog.getStreamSnapshot().sequence).toBe(3)
    onEvent?.({ name: 'agent.output.delta', payload: {
      conversationId: 'first', runId: 'run-1', messageId: 'assistant', sequence: 2, delta: 'B'
    } })
    onEvent?.({ name: 'agent.process.updated', payload: {
      conversationId: 'first', runId: 'run-1', messageId: 'assistant', item: { id: 'step-1' }
    } })
    expect(catalog.getStreamSnapshot().content).toBe('ABC')
    expect(catalog.getStreamSnapshot().process.map(item => item.id)).toEqual(['step-1'])
    onEvent?.({ name: 'agent.run.finished', payload: { conversationId: 'first', runId: 'run-1', message: { id: 'assistant' } } })
    expect(catalog.getStreamSnapshot().status).toBe('idle')
    onEvent?.({ name: 'agent.output.delta', payload: {
      conversationId: 'first', runId: 'run-1', messageId: 'assistant', sequence: 4, delta: 'late'
    } })
    onEvent?.({ name: 'agent.process.updated', payload: {
      conversationId: 'first', runId: 'run-1', messageId: 'assistant', item: { id: 'late-step' }
    } })
    expect(catalog.getStreamSnapshot().status).toBe('idle')
    expect(catalog.getStreamSnapshot().content).toBe('ABC')
    expect(catalog.getStreamSnapshot().process.map(item => item.id)).toEqual(['step-1'])
    cleanup()
  })

  it('ignores a previous conversation stream baseline after switching conversations', async () => {
    type Inspection = { active: boolean; conversationId: string; runId?: string; requestId?: string; messageId?: string; accumulated?: string; sequence?: number }
    const inspections: Array<{ id: string; resolve: (result: { ok: boolean; data: Inspection }) => void }> = []
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    const cancelCalls: Array<{ conversationId?: string; requestId?: string; runId?: string }> = []
    let catalog: {
      activate: (id: string) => void
      getStreamSnapshot: () => { id: string; status: string; runId: string; content: string }
      cancelStream: (runId: string) => Promise<boolean>
    } | undefined
    const bridge = {
      request: (name: string, input: { conversationId?: string }) => name === 'query.agent.inspect'
        ? new Promise<{ ok: boolean; data: Inspection }>(resolve => inspections.push({ id: input.conversationId!, resolve }))
        : name === 'command.agent.cancel'
          ? (cancelCalls.push(input), Promise.resolve({ ok: true, data: { cancelled: true } }))
        : Promise.resolve({ ok: true, data: [] }),
      subscribe: () => () => {}
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    catalog.activate('first')
    catalog.activate('second')
    expect(inspections.map(item => item.id)).toEqual(['first', 'second'])
    inspections[1]!.resolve({ ok: true, data: {
      active: true, conversationId: 'second', runId: 'run-2', requestId: 'request-2', messageId: 'answer-2', accumulated: 'second reply', sequence: 1
    } })
    await settle()
    inspections[0]!.resolve({ ok: true, data: {
      active: true, conversationId: 'first', runId: 'run-1', requestId: 'request-1', messageId: 'answer-1', accumulated: 'first reply', sequence: 1
    } })
    await settle()
    expect(catalog.getStreamSnapshot()).toMatchObject({
      id: 'second', status: 'running', runId: 'run-2', content: 'second reply'
    })
    expect(await catalog.cancelStream('run-1')).toBe(false)
    expect(await catalog.cancelStream('run-2')).toBe(true)
    expect(cancelCalls).toEqual([{ conversationId: 'second', requestId: 'request-2', runId: 'run-2' }])
    cleanup()
  })

  it('settles a model-owned send when its terminal event arrives before command acceptance', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let onEvent: ((event: unknown) => void) | undefined
    let cleanup = () => {}
    let acceptCommand: ((result: unknown) => void) | undefined
    let catalog: {
      activate: (id: string) => void
      run: (command: string, input: unknown) => Promise<{ details: { messages: Array<{ id: string }> }; cancelled: boolean }>
      cancelRequest: (conversationId: string, requestId: string) => Promise<boolean>
    } | undefined
    const calls: Array<{ name: string; input: unknown }> = []
    const bridge = {
      request: (name: string, input: unknown) => {
        calls.push({ name, input })
        if (name === 'query.agent.inspect') return Promise.resolve({ ok: true, data: { active: false, conversationId: 'first' } })
        if (name === 'command.agent.start') return new Promise(resolve => { acceptCommand = resolve })
        if (name === 'command.agent.cancel') return Promise.resolve({ ok: true, data: { cancelled: true } })
        if (name === 'query.conversations.details') return Promise.resolve({
          ok: true, data: { conversation: { id: 'first' }, messages: [{ id: 'answer' }], hasMore: false, beforeSequence: null }
        })
        return Promise.resolve({ ok: true, data: [] })
      },
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: typeof catalog) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Conversation model was not provided')
    catalog.activate('first')
    const reply = catalog.run('command.agent.start', {
      conversationId: 'first', requestId: 'request-1', text: 'hello', images: []
    })
    onEvent?.({ name: 'agent.run.finished', payload: {
      conversationId: 'first', runId: 'run-1', message: { id: 'answer', status: 'complete' }
    } })
    acceptCommand?.({ ok: true, data: {
      accepted: true, conversationId: 'first', runId: 'run-1', messageId: 'answer'
    } })
    expect(await reply).toMatchObject({ cancelled: false, details: { messages: [{ id: 'answer' }] } })
    expect(await catalog.cancelRequest('first', 'request-1')).toBe(true)
    expect(calls.find(call => call.name === 'command.agent.cancel')?.input).toEqual({
      conversationId: 'first', requestId: 'request-1'
    })
    cleanup()
  })
})
