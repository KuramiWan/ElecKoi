import { z } from 'zod'
import { deriveEventMessage } from '@deepseek-ai/dsh-session/surface'
import { replayRequestContext } from './conversation-context.mjs'
import { REQUEST_CONTEXT_EVENT, REQUEST_CONTEXT_PROJECTION } from './request-context-record.mjs'
import { requestContextItemSchema, requestContextRecordSchema } from './request-context-schema.mjs'

export { requestContextItemSchema } from './request-context-schema.mjs'

const contextSchema = z.array(requestContextItemSchema)
const viewSchema = z.record(z.string(), contextSchema)
const surfaceSchema = z.array(z.object({
  seq: z.number().int().nonnegative(),
  message: z.object({ id: z.string(), role: z.string(), content: z.array(z.unknown()) }).passthrough().nullable()
}).strict())

/** Whole-log request context, delivered by the official projection protocol. */
export const requestContextProjection = {
  key: REQUEST_CONTEXT_PROJECTION,
  stateVersion: 1,
  stateSchema: z.object({
    surface: surfaceSchema,
    pendingSeq: z.number().int().nonnegative().nullable(),
    contexts: viewSchema
  }).strict(),
  init: () => ({ surface: [], pendingSeq: null, contexts: {} }),
  apply(state, event) {
    if (event.type === REQUEST_CONTEXT_EVENT) {
      const { context, requestSeq } = requestContextRecordSchema.parse(event.data)
      return { ...state, contexts: { ...state.contexts, [requestSeq]: context } }
    }
    if (event.type === 'step/start') return { ...state, pendingSeq: event.seq }
    let next = state
    if (state.pendingSeq !== null && state.contexts[state.pendingSeq] === undefined
      && ['request/header', 'request/context', 'assistant/message', 'assistant/attempt', 'tool/call'].includes(event.type)) {
      next = { ...state, contexts: {
        ...state.contexts,
        [state.pendingSeq]: replayRequestContext(state.surface.flatMap(item => item.message ? [item.message] : []))
      } }
    }
    if (event.type === 'step/end' || event.type === 'turn/end') next = { ...next, pendingSeq: null }
    if (event.surfaceOp === 'append') {
      return { ...next, surface: [...next.surface, { seq: event.seq, message: deriveEventMessage(event) }] }
    }
    if (event.surfaceOp?.op === 'replace') {
      const start = next.surface.findIndex(item => item.seq === event.surfaceOp.startSeq)
      const end = next.surface.findIndex(item => item.seq === event.surfaceOp.endSeq)
      if (start < 0 || end < start) throw new Error('请求上下文的 Session surface 范围无效。')
      const surface = [...next.surface]
      surface.splice(start, end - start + 1, { seq: event.seq, message: deriveEventMessage(event) })
      return { ...next, surface }
    }
    return next
  },
  wire: { viewSchema, view: state => state.contexts }
}
