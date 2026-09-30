import type { ReactNode } from 'react'

export interface PersonaEditorOwner {
  fallback: ReactNode
  persona: Record<string, unknown>
  profile: {
    name: string
    avatars: Record<string, string>
  }
  saving: boolean
  message: string
  onChange(patch: { name?: string; avatars?: Record<string, string> }): void
  onSave(profile?: { name: string; avatars: Record<string, string> }): Promise<boolean>
  onManageAvatars(): void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'eleckoi.persona.editor': {
      kind: 'chain'
      scope: 'root'
      owner: PersonaEditorOwner
    }
  }
}
