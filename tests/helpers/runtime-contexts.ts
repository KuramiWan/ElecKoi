import { RuntimeContexts } from '../../packages/client/features/dsh-client-roleplay/src/host/runtime-contexts.mjs'

/** Shared tool fixture using the same Host state owner as the product plugin. */
export function runtimeContextsFor(sessionId: string, state: Record<string, unknown> = {}) {
  const contexts = new RuntimeContexts()
  contexts.set(sessionId, {
    rootSessionId: sessionId,
    conversationId: 'synthetic-chat',
    conversationContext: {},
    settings: { enabled: false, library: null, frozenLibrary: null, history: [] },
    variables: { enabled: false, config: null, state: {} },
    ...state
  })
  return contexts
}
