import { z } from 'zod'

export const TURN_OUTCOMES_PROJECTION = 'eleckoiTurnOutcomes'

const viewSchema = z.object({ abortedTurns: z.array(z.number().int().positive()) }).strict()

/** Turn cancellation facts omitted by the official Trajectory snapshot. */
export const turnOutcomesProjection = {
  key: TURN_OUTCOMES_PROJECTION,
  stateVersion: 1,
  stateSchema: viewSchema,
  init: () => ({ abortedTurns: [] }),
  apply(state, event) {
    if (event.type !== 'turn/end' || event.data.reason?.kind !== 'aborted') return state
    return { abortedTurns: [...new Set([...state.abortedTurns, event.data.turn])] }
  },
  wire: { viewSchema, view: state => state }
}
