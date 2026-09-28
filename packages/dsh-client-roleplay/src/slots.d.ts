import type { Dispatch, SetStateAction } from 'react'

export interface RoleplayMessageOwner {
  conversationId: string
  productMessageId: string
  messageId: string | null
  role: 'user' | 'assistant'
}

export interface RoleplayMessageContentOwner extends RoleplayMessageOwner {
  content: string
  streaming: boolean
}

export interface RoleplayInputOwner {
  conversationId: string
  input: string
  setInput: Dispatch<SetStateAction<string>>
  isSending: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'eleckoi.roleplay.message.content': {
      kind: 'chain'
      scope: 'session'
      owner: RoleplayMessageContentOwner
    }
    'eleckoi.roleplay.message.actions': {
      kind: 'list'
      scope: 'session'
      owner: RoleplayMessageOwner & { messageId: string }
    }
    'eleckoi.roleplay.message.after': {
      kind: 'list'
      scope: 'session'
      owner: RoleplayMessageOwner
    }
    'eleckoi.roleplay.input.left': {
      kind: 'list'
      scope: 'session'
      owner: RoleplayInputOwner
    }
    'eleckoi.roleplay.input.right': {
      kind: 'list'
      scope: 'session'
      owner: RoleplayInputOwner
    }
    'eleckoi.roleplay.input.overlay': {
      kind: 'list'
      scope: 'session'
      owner: RoleplayInputOwner
    }
    'eleckoi.roleplay.composer.dock': {
      kind: 'list'
      scope: 'session'
      owner: { conversationId: string }
    }
  }
}
