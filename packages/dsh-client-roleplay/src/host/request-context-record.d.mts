import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { RequestContextItem } from './request-context-schema.mjs'

export const REQUEST_CONTEXT_EVENT: 'eleckoi/request-context'
export const REQUEST_CONTEXT_PROJECTION: 'eleckoiRequestContexts'
export function recordRequestContext(registry: SessionProjectionRegistry, session: Session, context: RequestContextItem[]): void
