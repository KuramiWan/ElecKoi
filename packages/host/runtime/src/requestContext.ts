export type DshRequestContextRole = 'system' | 'user' | 'assistant'
export type DshRequestContextKind = 'system' | 'prompt' | 'history' | 'user' | 'assistant' | 'tool' | 'context'

export interface DshRequestContextItem {
  order: number
  messageId: string
  role: DshRequestContextRole
  kind: DshRequestContextKind
  title: string
  source: string
  anchor: string
  content: string
}
