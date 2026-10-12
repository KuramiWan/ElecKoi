import { z } from 'zod'

export const CREATOR_STUDIO_EVENT = 'eleckoi/creator-studio'
export const creatorStudioStateSchema = z.object({ presetId: z.string().min(1), characterId: z.string() }).strict()
const state = creatorStudioStateSchema.nullable()
export const creatorStudioProjection = {
  key: 'eleckoiCreatorStudio', stateVersion: 1, stateSchema: state, init: () => null,
  apply(previous, event) { return event.type === CREATOR_STUDIO_EVENT ? creatorStudioStateSchema.parse(event.data) : previous },
  wire: { viewSchema: state, view: value => value }
}
