import { z } from 'zod'

export const requestContextItemSchema = z.object({
  order: z.number().int().positive(),
  messageId: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  kind: z.enum(['system', 'prompt', 'history', 'user', 'assistant', 'tool', 'context']),
  title: z.string(), source: z.string(), anchor: z.string(), content: z.string()
}).strict()

export const requestContextRecordSchema = z.object({
  requestSeq: z.number().int().nonnegative(),
  context: z.array(requestContextItemSchema)
}).strict()
