import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { requestContextProjection } from '../packages/dsh-client-roleplay/src/host/request-context-projection.mjs'
import { recordRequestContext, REQUEST_CONTEXT_PROJECTION } from '../packages/dsh-client-roleplay/src/host/request-context-record.mjs'
import { requestContextItems } from '../apps/desktop/resources/dsh/conversation-context.mjs'

describe('roleplay request context projection', () => {
  it('records actual input outside the model surface and replays only retained requests under the same Session id', async () => {
    const ctx = new Context()
    const registry = new SessionProjectionRegistry(ctx)
    const dispose = registry.register(requestContextProjection)
    const session = Session.create(SessionId('request-context-test'))
    const events = []
    const append = (type, data, ...options) => {
      const event = session.append(type, data, ...options)
      events.push(event)
      return event
    }
    const capture = (text) => {
      const input = requestContextItems([createUserMessage({
        content: [{ type: 'text', text }], source: { kind: 'user' }
      })])
      recordRequestContext(registry, session, input)
      return input
    }
    try {
      const input = createUserMessage({ content: [{ type: 'text', text: '原始输入' }], source: { kind: 'user' } })
      append('user/message', input, { surfaceOp: 'append' })
      append('turn/start', { turn: 1 })
      const first = append('step/start', { turn: 1, step: 1 })
      const firstContext = capture('处理后的模型输入')
      append('step/end', { turn: 1, step: 1 })
      append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const retainedLength = session.seq
      const retained = [...events]
      // The plugin marker is returned through the standard projection, never through model messages.
      expect(registry.snapshot(session).values[REQUEST_CONTEXT_PROJECTION][first.seq]).toEqual(firstContext)
      expect(session.deriveMessages()).toEqual([input])

      append('user/message', createUserMessage({ content: [{ type: 'text', text: '待删除输入' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      append('turn/start', { turn: 2 })
      const second = append('step/start', { turn: 2, step: 1 })
      capture('待删除请求上下文')
      const oldProjection = registry.snapshot(session).values[REQUEST_CONTEXT_PROJECTION]
      expect(oldProjection[second.seq][0].content).toBe('待删除请求上下文')

      // Keep exactly the first turn including its plugin-owned committed record.
      const all = session.snapshotEvents()
      const restored = Session.create(session.id, all.slice(0, retainedLength), session.header)
      const projection = registry.snapshot(restored).values[REQUEST_CONTEXT_PROJECTION]
      expect(restored.id).toBe(session.id)
      expect(projection).toEqual({ [first.seq]: firstContext })
      restored.append('user/message', createUserMessage({ content: [{ type: 'text', text: '重新生成输入' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      restored.append('turn/start', { turn: 2 })
      const next = restored.append('step/start', { turn: 2, step: 1 })
      const nextContext = requestContextItems([createUserMessage({ content: [{ type: 'text', text: '重新生成上下文' }], source: { kind: 'user' } })])
      recordRequestContext(registry, restored, nextContext)
      expect(next.seq).toBeGreaterThanOrEqual(second.seq)
      expect(registry.snapshot(restored).values[REQUEST_CONTEXT_PROJECTION]).toEqual({
        [first.seq]: firstContext, [next.seq]: nextContext
      })
      expect(JSON.stringify(registry.snapshot(restored))).not.toContain('待删除请求上下文')
      expect(retained).toHaveLength(5)
      dispose()
      expect(registry.snapshot(restored).values[REQUEST_CONTEXT_PROJECTION]).toBeUndefined()
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('reconstructs earlier logs and preserves the wire snapshot across unrelated surface events', () => {
    let state = requestContextProjection.init()
    const fold = event => { state = requestContextProjection.apply(state, event) }
    fold({ type: 'user/message', seq: 0, surfaceOp: 'append', data: createUserMessage({
      content: [{ type: 'text', text: '历史输入' }], source: { kind: 'user' }
    }) })
    fold({ type: 'step/start', seq: 1, data: { turn: 1, step: 1 } })
    fold({ type: 'request/context', seq: 2, data: {} })
    fold({ type: 'step/end', seq: 2, data: { turn: 1, step: 1 } })
    expect(state.contexts[1][0].content).toBe('历史输入')
    const wire = requestContextProjection.wire.view(state)
    fold({ type: 'user/message', seq: 3, surfaceOp: 'append', data: createUserMessage({
      content: [{ type: 'text', text: '新输入' }], source: { kind: 'user' }
    }) })
    expect(requestContextProjection.wire.view(state)).toBe(wire)
    const before = state
    fold({ type: 'tool/heartbeat', seq: 4, data: {} })
    expect(state).toBe(before)
    expect(requestContextProjection.stateSchema.safeParse(state).success).toBe(true)
  })

  it('replays prefix history without dropping prior user and final assistant messages', () => {
    let state = requestContextProjection.init()
    const fold = event => { state = requestContextProjection.apply(state, event) }
    const envelope = createUserMessage({
      id: 'eleckoi-request-projection:v2',
      content: [{ type: 'text', text: 'ELECKOI_REQUEST_PROJECTION_V2\n{"historyMode":"prefix","history":[{"role":"assistant","content":"开场白"}],"plan":[]}' }],
      source: { kind: 'plugin:eleckoi-request-projection', form: 'snapshot' }
    })
    fold({ type: 'user/message', seq: 0, surfaceOp: 'append', data: createUserMessage({
      content: [{ type: 'text', text: '上一问' }], source: { kind: 'user' }
    }) })
    fold({ type: 'assistant/message', seq: 1, surfaceOp: 'append', data: {
      turn: 1, step: 1, message: {
        id: 'reply', role: 'assistant', content: [{ type: 'text', text: '<FINAL>上一答</FINAL>' }],
        source: { kind: 'model', provider: 'test', model: 'test' }
      }
    } })
    fold({ type: 'user/message', seq: 2, surfaceOp: 'append', data: envelope })
    fold({ type: 'user/message', seq: 3, surfaceOp: 'append', data: createUserMessage({
      content: [{ type: 'text', text: '当前问题' }], source: { kind: 'user' }
    }) })
    fold({ type: 'step/start', seq: 4, data: { turn: 2, step: 1 } })
    fold({ type: 'request/context', seq: 5, data: {} })
    fold({ type: 'step/end', seq: 5, data: { turn: 2, step: 1 } })
    expect(state.contexts[4].map(item => item.content)).toEqual(['开场白', '上一问', '上一答', '当前问题'])
  })

  it('does not invent a model request for a retained configuration step', () => {
    let state = requestContextProjection.init()
    for (const event of [
      { type: 'step/start', seq: 0, data: { turn: 1, step: 1 } },
      { type: 'user/message', seq: 1, surfaceOp: 'append', data: createUserMessage({
        content: [{ type: 'text', text: '合成保留输入' }], source: { kind: 'user' }
      }) },
      { type: 'step/end', seq: 2, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 3, data: { turn: 1 } }
    ]) state = requestContextProjection.apply(state, event)
    expect(requestContextProjection.wire.view(state)).toEqual({})
    expect(state.pendingSeq).toBeNull()
  })
})
