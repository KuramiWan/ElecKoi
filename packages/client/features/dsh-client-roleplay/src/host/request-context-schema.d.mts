import type { z } from 'zod'

export interface RequestContextItem {
  order: number
  messageId: string
  role: 'system' | 'user' | 'assistant'
  kind: 'system' | 'prompt' | 'history' | 'user' | 'assistant' | 'tool' | 'context'
  title: string
  source: string
  anchor: string
  content: string
}
export const requestContextItemSchema: z.ZodType<RequestContextItem>
export const requestContextRecordSchema: z.ZodType<{ requestSeq: number; context: RequestContextItem[] }>
