import { z } from 'zod'
import { IMAGE_EVENT } from './generated-image-result.mjs'

const attachment = z.object({ attachmentId: z.string(), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number(), width: z.number(), height: z.number(), name: z.string().optional() }).passthrough()
const frame = z.object({ id: z.number().int().positive(), width: z.number(), height: z.number(),
  status: z.enum(['generating', 'ready', 'failed']), attachment: attachment.optional(), seed: z.number().optional(), error: z.string().optional() })
export const illustrationSchema = z.object({ batchId: z.string(), turn: z.number().int().positive(), step: z.number().int().positive(),
  status: z.enum(['generating', 'complete', 'partial', 'failed']), frames: z.array(frame), error: z.string().optional() })
const schema = z.array(illustrationSchema)

/** One current outcome per image command; the original assistant message owns its prompts. */
export const illustrationProjection = {
  key: 'eleckoiIllustrations', stateVersion: 1, stateSchema: schema, init: () => [],
  apply(state, event) {
    if (event.type !== IMAGE_EVENT) return state
    const value = illustrationSchema.parse(event.data)
    const index = state.findIndex(item => item.batchId === value.batchId)
    if (index < 0) return [...state, value]
    return state.map((item, position) => position === index ? value : item)
  },
  wire: { viewSchema: schema, view: state => state }
}
