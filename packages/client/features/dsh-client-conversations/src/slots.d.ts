import type { ReactNode } from 'react'

export interface ConversationListOwner {
  fallback: ReactNode
  keyword: string
  setKeyword(keyword: string): void
  sessions: unknown[]
  sessionId: string
  pinnedIds: unknown
  characters: Record<string, unknown>
  artworkMode: string
  onLoadChat(conversationId: string): void
  onOpenCharacterChat(characterId: string): void
  onGoCharacterSettings(): void
  onTogglePinChat(conversationId: string): unknown
  onOpenChatWindow(conversationId: string): unknown
  onHideChat(conversationId: string): unknown
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'eleckoi.conversation.list': {
      kind: 'chain'
      scope: 'root'
      owner: ConversationListOwner
    }
  }
}
