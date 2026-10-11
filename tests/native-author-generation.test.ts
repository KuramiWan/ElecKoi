import { describe, expect, it, vi } from 'vitest'
import type { ConversationGenerationChange, ElecKoiConversations } from '@eleckoi/dsh-client-conversations/client'
import { NativeGenerationEvents } from '../packages/client/features/dsh-client-author/src/generation'

function harness() {
  const source = new Set<(change: ConversationGenerationChange) => void>(), details = new Set<() => void>(),
    streams = new Set<() => void>(), statistics = new Set<() => void>()
  let selected: any = { id: 'synthetic-chat', status: 'ready', details: { runtimeSessionId: 'synthetic-session', messages: [] } }
  let stream: any = { id: selected.id, status: 'idle', runId: 'synthetic-session', dshTurn: 1, messageId: '', content: '', process: [] }
  let stats: any = { id: selected.id, stats: null }, count = 0
  const subscribe = <T>(items: Set<T>) => (listener: T) => { items.add(listener); return () => items.delete(listener) }
  const conversations = { getDetailsSnapshot: () => selected, getStreamSnapshot: () => stream, getStatsSnapshot: () => stats,
    getGenerationReply: vi.fn((session: string, turn: number, seq: number): any => {
      const matches = selected.details.messages.filter((item: any) => item.runtimeSessionId === session && item.dshTurn === turn
        && item.sessionEventSeq === seq && item.status === 'complete')
      return matches.length === 1 ? { status: 'ready', message: matches[0] } : { status: 'pending' }
    }),
    subscribeGeneration: subscribe(source), subscribeDetails: subscribe(details), subscribeStream: subscribe(streams), subscribeStats: subscribe(statistics),
    readImage: vi.fn(async () => 'blob:synthetic-image') } as unknown as ElecKoiConversations
  const events: Array<{ name: string; payload: any }> = [], report = vi.fn()
  const observer = new NativeGenerationEvents(conversations, () => `synthetic-generation-${++count}`,
    (name, payload) => events.push({ name, payload: structuredClone(payload) }), report)
  observer.start()
  const feed = (events: any[], kind: ConversationGenerationChange['kind'] = 'live', running = true) => {
    for (const listener of source) listener({ conversationId: 'synthetic-chat', runtimeSessionId: 'synthetic-session', kind, running, events })
  }
  return { observer, events, report, conversations, source, details, streams, statistics, feed,
    get selected() { return selected }, set selected(value: any) { selected = value },
    get stream() { return stream }, set stream(value: any) { stream = value; for (const listener of streams) listener() },
    set stats(value: any) { stats = value; for (const listener of statistics) listener() },
    changed() { for (const listener of details) listener() },
  }
}
const start = (turn = 1, seq = 1) => ({ type: 'turn/start', seq, data: { turn } })
const assistant = (turn = 1, seq = 5) => ({ type: 'assistant/message', seq, data: { turn, step: 1 } })
const end = (turn = 1, reason = { kind: 'completed' }, seq = 6) => ({ type: 'turn/end', seq, data: { turn, reason } })
const message = (turn = 1, seq = 5) => ({ id: `synthetic-reply-${turn}`, role: 'assistant', status: 'complete',
  runtimeSessionId: 'synthetic-session', dshTurn: turn, sessionEventSeq: seq, content: 'Synthetic body',
  nativeVariableStateJson: '{"score":3}', variableStateJson: '{"score":999}', createdAt: '', process: [] })

describe('native generation observation', () => {
  it('waits for the exact completed message, including a delayed final projection, without using idle as success', async () => {
    const r = harness(); r.feed([start()]); r.stream = { ...r.stream, status: 'running', content: 'Synthetic' }
    r.stream = { ...r.stream, status: 'idle' }
    expect(r.events.some(event => event.name === 'agent.run.finished')).toBe(false)
    r.feed([assistant(), end()]); expect(r.events.some(event => event.name === 'agent.run.finished')).toBe(false)
    r.selected.details.messages = [message(2), message(1, 4)]; r.changed()
    expect(r.events.some(event => event.name === 'agent.run.finished')).toBe(false)
    r.selected.details.messages = [message(2), message(1, 4), message()]; r.changed()
    await vi.waitFor(() => expect(r.events.filter(event => event.name === 'agent.run.finished')).toHaveLength(1))
    expect(r.events.find(event => event.name === 'agent.run.finished')!.payload).toMatchObject({ turn: 1, reason: 'completed',
      message: { id: 'synthetic-reply-1', variableState: { score: 3 } } })
    r.changed(); r.feed([end()]); expect(r.events.filter(event => event.name === 'agent.run.finished')).toHaveLength(1)
    r.observer.dispose(); expect(r.source.size + r.details.size + r.streams.size + r.statistics.size).toBe(0)
  })

  it('distinguishes live changes from historical baselines and reconciles an observed run after a rebase', async () => {
    const r = harness(); r.feed([start(), assistant(), end()], 'baseline', false)
    expect(r.events).toEqual([])
    r.feed([start(2, 9)]); r.feed([start(), assistant(), end(), start(2, 9), end(2)], 'baseline', false)
    expect(r.events.filter(event => event.name === 'agent.run.finished').map(event => event.payload.turn)).toEqual([2])
    r.feed([start(), end(), start(2, 9), end(2)], 'baseline', false)
    expect(r.events.filter(event => event.name === 'agent.run.finished')).toHaveLength(1)
    r.observer.dispose()
  })

  it('attaches to an actually open running turn, without starting any loaded completed turn', () => {
    const r = harness(); r.stream = { ...r.stream, status: 'running', dshTurn: 2, content: 'Synthetic live body' }
    r.feed([start(), assistant(), end(), start(2, 9)], 'baseline', true)
    expect(r.observer.identity()).toEqual({ generationId: 'synthetic-generation-1', turn: 2, sequence: 1 })
    expect(r.events.filter(event => event.name === 'agent.state.changed').map(event => event.payload.turn)).toEqual([2, 2])
    r.observer.dispose()
  })

  it('reports cancellation, structured failure, output limit and zero-step blocking distinctly', () => {
    const r = harness()
    r.feed([start(), end(1, { kind: 'aborted', reason: 'user' } as any)])
    expect(r.events.find(event => event.name === 'agent.run.cancelled')!.payload.reason).toBe('cancelled')
    r.feed([start(2, 10), end(2, { kind: 'error', error: { code: 'SYNTHETIC_ERROR', message: 'Synthetic failure' } } as any)])
    expect(r.events.find(event => event.name === 'agent.run.failed')!.payload).toMatchObject({ code: 'SYNTHETIC_ERROR', message: 'Synthetic failure', turn: 2 })
    r.feed([start(3, 20), end(3, { kind: 'max-tokens' })]); r.feed([start(4, 30), end(4, { kind: 'blocked' })])
    expect(r.events.filter(event => event.name === 'agent.run.finished').map(event => event.payload.reason)).toEqual(['output-limit', 'blocked'])
    expect(r.events.filter(event => event.name === 'agent.run.finished').every(event => event.payload.message === null)).toBe(true)
    expect(r.report).not.toHaveBeenCalled(); r.observer.dispose()
  })

  it('uses distinct observation IDs for consecutive turns and same-turn regeneration after a rebind', () => {
    const r = harness(); r.feed([start(), end()]); r.feed([start(2, 10), end(2)])
    r.feed([], 'released', false); r.feed([start(), end()])
    const finished = r.events.filter(event => event.name === 'agent.run.finished')
    expect(finished.map(event => event.payload.runId)).toEqual(['synthetic-session', 'synthetic-session', 'synthetic-session'])
    expect(new Set(finished.map(event => event.payload.generationId)).size).toBe(3)
    expect(r.observer.identity()).toBeNull(); r.observer.dispose()
  })

  it('publishes replacement output explicitly and deduplicates unchanged process and statistics', () => {
    const r = harness(); r.feed([start()])
    const item = { id: 'synthetic-tool', kind: 'tool', status: 'running', toolName: 'synthetic_tool', arguments: '{}',
      summary: 'Synthetic process', detail: '', startedAtMillis: 1 }
    r.stream = { ...r.stream, status: 'running', content: 'Synthetic first', process: [item] }
    r.stats = { id: 'synthetic-chat', stats: { sessionStats: { steps: 1, turns: 1 } } }
    r.stream = { ...r.stream, content: 'Synthetic first append' }; r.changed(); r.changed()
    r.stats = { id: 'synthetic-chat', stats: { sessionStats: { steps: 1, turns: 1 } } }
    r.stream = { ...r.stream, content: 'Replaced body', process: [{ ...item, status: 'complete' }] }
    expect(r.events.filter(event => event.name === 'agent.output.delta').map(event => [event.payload.operation, event.payload.delta, event.payload.accumulated]))
      .toEqual([['append', 'Synthetic first', 'Synthetic first'], ['append', ' append', 'Synthetic first append'], ['replace', 'Replaced body', 'Replaced body']])
    expect(r.events.filter(event => event.name === 'agent.process.updated')).toHaveLength(2)
    expect(r.events.filter(event => event.name === 'agent.generation.stats')).toHaveLength(1)
    r.observer.dispose()
  })

  it('does not let a late older message completion set a newer run idle', async () => {
    const r = harness(); r.feed([start(), assistant(), end()]); r.selected.details.messages = [message()]; r.changed()
    r.feed([start(2, 10)]); r.stream = { ...r.stream, status: 'running', dshTurn: 2 }
    await vi.waitFor(() => expect(r.events.some(event => event.name === 'agent.run.finished')).toBe(true))
    expect(r.events.filter(event => event.name === 'agent.state.changed').some(event => event.payload.state === 'idle')).toBe(false)
    expect(r.observer.identity()?.turn).toBe(2); r.observer.dispose()
  })

  it('drops late asynchronous mapping on chat switch or binding release', async () => {
    for (const release of [false, true]) {
      const r = harness(); let resolve!: (url: string) => void
      vi.mocked(r.conversations.readImage).mockImplementationOnce(() => new Promise(done => { resolve = done }))
      r.feed([start(), assistant(), end()]); r.selected.details.messages = [{ ...message(), inputImageAttachments: [
        { attachmentId: 'synthetic-image', mediaType: 'image/png', bytes: 1, name: '' },
      ] }]; r.changed()
      if (release) r.feed([], 'released', false)
      else r.selected = { id: 'synthetic-other', status: 'ready', details: { runtimeSessionId: 'synthetic-other-session', messages: [] } }
      resolve('blob:synthetic-image'); await new Promise(done => setImmediate(done))
      expect(r.events.some(event => event.name === 'agent.run.finished')).toBe(false); r.observer.dispose()
    }
  })

  it('clears completed observations throughout repeated runs', () => {
    const r = harness()
    for (let turn = 1; turn <= 200; turn++) r.feed([start(turn, turn * 10), end(turn)])
    expect((r.observer as any).observations.size).toBe(0)
    expect(r.events.filter(event => event.name === 'agent.run.finished')).toHaveLength(200)
    r.observer.dispose()
  })

  it('does not advertise a retained unchanged statistics baseline as a new generation update', () => {
    const r = harness(); r.stats = { id: 'synthetic-chat', stats: { sessionStats: { turns: 3, steps: 5 } } }
    r.feed([start()]); r.stream = { ...r.stream, status: 'running', content: 'Synthetic body' }; r.changed()
    expect(r.events.some(event => event.name === 'agent.generation.stats')).toBe(false)
    r.stats = { id: 'synthetic-chat', stats: { sessionStats: { turns: 4, steps: 6 } } }
    expect(r.events.filter(event => event.name === 'agent.generation.stats')).toHaveLength(1)
    r.observer.dispose()
  })

  it('reports an unavailable settled message without pretending generation is still pending', () => {
    const r = harness()
    vi.mocked(r.conversations.getGenerationReply).mockReturnValue({ status: 'unavailable', reason: 'Synthetic ambiguous reply identity' })
    r.feed([start(), assistant(), end()])
    expect(r.events.find(event => event.name === 'agent.run.failed')!.payload).toMatchObject({ code: 'GENERATION_MESSAGE_UNAVAILABLE', message: 'Synthetic ambiguous reply identity' })
    expect((r.observer as any).observations.size).toBe(0); r.observer.dispose()
  })
})
