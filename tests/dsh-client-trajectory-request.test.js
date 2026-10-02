import { describe, expect, it } from 'vitest'
import { trajectoryAssistantDefinition } from '../packages/dsh-client-trajectory/src/client/trajectory-assistant-definition.ts'
import { adaptTrajectorySnapshot } from '../src/renderer/src/modules/chat/model/trajectorySnapshotAdapter.js'

function event(type, seq, data) {
  return { type, seq, time: seq * 10, data }
}

function match(value) {
  return {
    event: value,
    location: {
      kind: 'step',
      turn: { turn: 1, status: 'open' },
      step: { step: 1, status: 'open' }
    }
  }
}

function context(state, matches, start) {
  return {
    key: 'trajectory-assistant-step\u00001:1',
    kind: 'trajectory-assistant-step',
    id: '1:1',
    matches,
    start,
    state,
    current: new Map()
  }
}

describe('DSH trajectory assistant request evidence', () => {
  it('does not invent a failed request for a closed bootstrap-only step', () => {
    const start = match(event('step/start', 1, { turn: 1, step: 1 }))
    const initial = trajectoryAssistantDefinition.start(
      context(undefined, [start], start),
      start,
      { previous: () => undefined }
    )
    const end = match(event('step/end', 2, { turn: 1, step: 1 }))
    const settled = trajectoryAssistantDefinition.update(
      context(initial, [start, end], start),
      end
    )

    expect(trajectoryAssistantDefinition.buildViewNode(
      context(settled, [start, end], start)
    )).toBeNull()
  })

  it('keeps a real failed model attempt visible', () => {
    const start = match(event('step/start', 1, { turn: 1, step: 1 }))
    const initial = trajectoryAssistantDefinition.start(
      context(undefined, [start], start),
      start,
      { previous: () => undefined }
    )
    const attempt = match(event('assistant/attempt', 2, { turn: 1, step: 1, stream: [] }))
    const attempted = trajectoryAssistantDefinition.update(
      context(initial, [start, attempt], start),
      attempt
    )
    const end = match(event('step/end', 3, { turn: 1, step: 1 }))
    const settled = trajectoryAssistantDefinition.update(
      context(attempted, [start, attempt, end], start),
      end
    )
    const node = trajectoryAssistantDefinition.buildViewNode(
      context(settled, [start, attempt, end], start)
    )

    expect(node?.data?.request).toMatchObject({ purpose: 'assistant', status: 'error' })
  })

  it('does not present a user-cancelled attempt as a failed request', () => {
    const completed = { purpose: 'assistant', startSeq: 20, turn: 2, step: 1, status: 'complete' }
    const cancelled = { purpose: 'assistant', startSeq: 5, turn: 1, step: 1, status: 'error' }
    const actualFailure = { purpose: 'assistant', startSeq: 30, turn: 3, step: 1, status: 'error' }
    const official = {
      eventNodes: [{ seq: 1, source: { kind: 'user' } }],
      eventLocations: new Map(),
      requests: [cancelled, completed, actualFailure],
      callSchemas: new Map(),
      partial: null,
      runningCalls: []
    }

    const adapted = adaptTrajectorySnapshot(official, { 20: [{ title: '上下文' }] }, {
      abortedTurns: [1]
    })

    expect(adapted.requests).toEqual([
      { ...completed, context: [{ title: '上下文' }] },
      { ...actualFailure, context: [] }
    ])
  })
})
