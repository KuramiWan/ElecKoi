import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import type { Message } from '@deepseek-ai/dsh-llm'

export interface RoleplayRequestContextItem {
  order: number
  messageId: string
  role: 'system' | 'user' | 'assistant'
  kind: 'system' | 'prompt' | 'history' | 'user' | 'assistant' | 'tool' | 'context'
  title: string
  source: string
  anchor: string
  content: string
}

export type RoleplayRequestContexts = Record<string, RoleplayRequestContextItem[]>

export interface RoleplayRequestContextState {
  surface: Array<{ seq: number; message: Message | null }>
  pendingSeq: number | null
  contexts: RoleplayRequestContexts
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'eleckoi/request-context': {
      requestSeq: number
      context: RoleplayRequestContextItem[]
    }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'eleckoi/history-restored': { messageIds: string[] }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    eleckoiRequestContexts: RoleplayRequestContexts
    eleckoiHistoryStatsAdjustment: { steps: number; turns: number }
  }
  interface SessionProjectionStateMap {
    eleckoiRequestContexts: RoleplayRequestContextState
  }
}
