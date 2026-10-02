import { z } from 'zod'

export const HISTORY_RESTORED_EVENT = 'eleckoi/history-restored'
export const HISTORY_STATS_PROJECTION = 'eleckoiHistoryStatsAdjustment'
export const historyRestoredSchema = z.object({ messageIds: z.array(z.string().min(1)).min(1) }).strict()

/** Presentation-only discounts for retained historical setup without a model request. */
export const historyStatsProjection = {
  key: HISTORY_STATS_PROJECTION,
  stateVersion: 1,
  stateSchema: z.object({
    messageIds: z.array(z.string()),
    step: z.object({ turn: z.number().int().positive(), historical: z.boolean(), requested: z.boolean() }).nullable(),
    steps: z.number().int().nonnegative(),
    candidateTurns: z.array(z.number().int().positive()),
    requestedTurns: z.array(z.number().int().positive())
  }).strict(),
  init: () => ({ messageIds: [], step: null, steps: 0, candidateTurns: [], requestedTurns: [] }),
  apply(state, event) {
    if (event.type === HISTORY_RESTORED_EVENT) {
      const { messageIds } = historyRestoredSchema.parse(event.data)
      return { ...state, messageIds: [...new Set([...state.messageIds, ...messageIds])] }
    }
    if (event.type === 'step/start') return { ...state, step: { turn: event.data.turn, historical: false, requested: false } }
    if (!state.step) return state
    if (event.type === 'user/message' && state.messageIds.includes(event.data.id)) {
      return { ...state, step: { ...state.step, historical: true } }
    }
    if (['request/header', 'request/context', 'assistant/message', 'assistant/attempt', 'eleckoi/request-context'].includes(event.type)) {
      return { ...state, step: { ...state.step, requested: true },
        requestedTurns: [...new Set([...state.requestedTurns, state.step.turn])] }
    }
    if (event.type === 'step/end') {
      const excluded = state.step.historical && !state.step.requested
      return { ...state, step: null, steps: state.steps + Number(excluded),
        candidateTurns: excluded ? [...new Set([...state.candidateTurns, state.step.turn])] : state.candidateTurns }
    }
    if (event.type === 'turn/end') return { ...state, step: null }
    return state
  },
  wire: {
    viewSchema: z.object({ steps: z.number().int().nonnegative(), turns: z.number().int().nonnegative() }).strict(),
    view: state => ({ steps: state.steps,
      turns: state.candidateTurns.filter(turn => !state.requestedTurns.includes(turn)).length })
  }
}
