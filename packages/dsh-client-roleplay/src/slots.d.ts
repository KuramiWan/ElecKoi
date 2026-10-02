import type { ComponentType, ReactNode } from 'react'
import type {
  ComposerAttachmentsOwnerProps,
  ComposerBarOwnerProps,
  ComposerChainProps,
  ConvViewOwnerProps,
  InputActivityOwnerProps,
  InputControlOwnerProps,
  InputZone,
  MessageImagesOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

type BridgeSlotRenderer = (name: string, owner: unknown, options?: unknown) => ReactNode

export interface RoleplaySessionOwner {
  matched: {
    component: ComponentType<any>
    props: Record<string, unknown>
  }
}

export interface ComposerBridgeOwner {
  renderBridgeSlot?: BridgeSlotRenderer
}

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

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'eleckoi.roleplay.session': {
      kind: 'single'
      scope: 'session'
      owner: RoleplaySessionOwner
    }
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
    'eleckoi.roleplay.conversation.header.corner': {
      kind: 'single'
      scope: 'session'
      owner: Record<string, never>
    }
    'eleckoi.roleplay.conversation.input.right': {
      kind: 'list'
      scope: 'session'
      owner: Record<string, never>
    }
    'eleckoi.roleplay.conversation.input.left': {
      kind: 'list'
      scope: 'session'
      owner: Record<string, never>
    }
    'eleckoi.roleplay.conversation.input.overlay': {
      kind: 'list'
      scope: 'session'
      owner: Record<string, never>
    }
    'eleckoi.roleplay.conversation.input.dock': {
      kind: 'list'
      scope: 'session'
      owner: InputZone
    }
    'eleckoi.roleplay.conversation.input.attachments': {
      kind: 'single'
      scope: 'session-maybe'
      owner: ComposerAttachmentsOwnerProps
    }
    'eleckoi.roleplay.conversation.input.permission': {
      kind: 'single'
      scope: 'session'
      owner: InputControlOwnerProps
    }
    'eleckoi.roleplay.conversation.input.plan': {
      kind: 'single'
      scope: 'session'
      owner: InputControlOwnerProps
    }
    'eleckoi.roleplay.conversation.input.model': {
      kind: 'single'
      scope: 'session'
      owner: InputControlOwnerProps
    }
    'eleckoi.roleplay.conversation.input.activity': {
      kind: 'single'
      scope: 'session'
      owner: InputActivityOwnerProps
    }
    'eleckoi.roleplay.conversation.composer.dock': {
      kind: 'list'
      scope: 'session'
      owner: Record<string, never>
    }
    'eleckoi.roleplay.conversation.composer': {
      kind: 'chain'
      scope: 'session'
      owner: ComposerChainProps & ComposerBridgeOwner
    }
    'eleckoi.roleplay.conversation.composer.bar': {
      kind: 'single'
      scope: 'session-maybe'
      owner: ComposerBarOwnerProps & ComposerBridgeOwner
    }
    'eleckoi.roleplay.conversation.approval.detail': {
      kind: 'single'
      scope: 'session'
      owner: Record<string, unknown>
    }
    'eleckoi.roleplay.conversation.plan-review.actions': {
      kind: 'list'
      scope: 'session'
      owner: Record<string, unknown>
    }
    'eleckoi.roleplay.trajectory.images': {
      kind: 'single'
      scope: 'session'
      owner: MessageImagesOwnerProps
    }
    'eleckoi.roleplay.trajectory': {
      kind: 'single'
      scope: 'session'
      owner: ConvViewOwnerProps & { component?: ComponentType<any> }
    }
  }
}
