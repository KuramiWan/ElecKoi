import { DshSessionRewindUnavailableError, rewindDshSession } from './sessionRewind'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { readDshSessionLog } from './trajectory'

export const name = 'eleckoi-session-edit'
export const inject = ['eleckoiSessionHandles', 'sessionPersistence']

export function apply(ctx: {
  eleckoiSessionHandles: { withClosed<T>(sessionId: string, action: () => T | Promise<T>): Promise<T> }
  sessionPersistence: { open(sessionId: SessionId, access: 'write'): Promise<{ close(): Promise<void> }> }
  provide(key: string, value: unknown): void
}): void {
  const sessionRoot = process.env.DSH_SESSION_ROOT
  if (!sessionRoot) throw new Error('DSH_SESSION_ROOT is required')
  ctx.provide('eleckoiSessionEditor', {
    async rewind(sessionId: string, fromTurn: number): Promise<number | undefined> {
      return ctx.eleckoiSessionHandles.withClosed(sessionId, async () => {
        if (!readDshSessionLog(sessionRoot, sessionId)) return undefined
        const probe = await ctx.sessionPersistence.open(sessionId as SessionId, 'write')
        await probe.close()
        try {
          return rewindDshSession(sessionRoot, sessionId, fromTurn)
        } catch (error) {
          if (error instanceof DshSessionRewindUnavailableError) return undefined
          throw error
        }
      })
    }
  })
}
