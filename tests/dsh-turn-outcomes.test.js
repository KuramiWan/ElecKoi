import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { turnOutcomesProjection } from '../packages/dsh-client-roleplay/src/host/turn-outcomes-projection.mjs'

describe('DSH turn outcome projection', () => {
  it('exposes user-aborted turns without classifying completed or failed turns as cancelled', async () => {
    const ctx = new Context()
    try {
      const registry = new SessionProjectionRegistry(ctx)
      registry.register(turnOutcomesProjection)
      const session = Session.create('synthetic-session')
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
      session.append('turn/start', { turn: 2 })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

      expect(registry.snapshot(session).values.eleckoiTurnOutcomes).toEqual({ abortedTurns: [1] })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
