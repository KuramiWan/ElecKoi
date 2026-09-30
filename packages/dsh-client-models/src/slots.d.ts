import type { ReactNode } from 'react'

export interface ModelEditorOwner {
  fallback: ReactNode
  configId: string
  providerId: string
  form: Record<string, unknown>
  provider: Record<string, unknown>
  isImageProvider: boolean
  dirty: boolean
  saving: boolean
  error: string
  onChange(patch: Record<string, unknown>): void
  onCancel(): void
  onSave(): Promise<boolean>
  onFetchModels(): Promise<void>
  onTestConnection(): Promise<unknown>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'eleckoi.model.editor': {
      kind: 'chain'
      scope: 'root'
      owner: ModelEditorOwner
    }
  }
}
