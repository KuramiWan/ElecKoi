import type { Context } from '@deepseek-ai/cordis'
import type { CreatorStudioSession } from '@eleckoi/dsh-product-api/types'
import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'eleckoi/creator-studio': Omit<CreatorStudioSession, 'sessionId'>
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { eleckoiCreatorStudio: Omit<CreatorStudioSession, 'sessionId'> | null }
  interface SessionProjectionMap { eleckoiCreatorStudio: Omit<CreatorStudioSession, 'sessionId'> | null }
}
export const inject: readonly string[]
export function apply(ctx: Context): Promise<() => Promise<void>>
