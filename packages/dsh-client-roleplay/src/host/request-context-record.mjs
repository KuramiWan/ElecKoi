import { requestContextRecordSchema } from './request-context-schema.mjs'

export const REQUEST_CONTEXT_EVENT = 'eleckoi/request-context'
export const REQUEST_CONTEXT_PROJECTION = 'eleckoiRequestContexts'

/** Persist the actual provider input without adding it to the model-visible surface. */
export function recordRequestContext(registry, session, context) {
  const requestSeq = registry.stateOf(session, REQUEST_CONTEXT_PROJECTION)?.pendingSeq
  if (requestSeq == null) return
  session.append(REQUEST_CONTEXT_EVENT, requestContextRecordSchema.parse({ requestSeq, context }), { ignorable: true })
}
