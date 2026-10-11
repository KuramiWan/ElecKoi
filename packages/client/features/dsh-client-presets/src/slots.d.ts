import type { ReactNode } from 'react'

export interface PresetEditorOwner {
  fallback: ReactNode
  presetId: string
  preset: Record<string, unknown>
  active: boolean
  dirty: boolean
  saving: boolean
  error: string
  onChange(preset: Record<string, unknown>): void
  onSave(preset?: Record<string, unknown>): Promise<boolean>
  onDiscard(): void
  onActivate(): Promise<void>
}

export interface PresetProfileEditorOwner extends PresetEditorOwner {
  onClose(): void
}

export interface PresetManagerOwner {
  fallback: ReactNode
  catalog: Record<string, unknown> | null
  selectedGroup: string
  selectedPresetId: string
  importing: boolean
  importError: string
  onSelectGroup(groupId: string): void
  onSelectPreset(presetId: string): void
  onRefresh(preferredId?: string): Promise<unknown>
  onImport(): void
  onExport(format: string): Promise<void>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'eleckoi.preset.editor.profile': {
      kind: 'chain'
      scope: 'root'
      owner: PresetProfileEditorOwner
    }
    'eleckoi.preset.editor.introduction': {
      kind: 'chain'
      scope: 'root'
      owner: PresetEditorOwner
    }
    'eleckoi.preset.editor.prompts': {
      kind: 'chain'
      scope: 'root'
      owner: PresetEditorOwner
    }
    'eleckoi.preset.editor.tools': {
      kind: 'chain'
      scope: 'root'
      owner: PresetEditorOwner
    }
    'eleckoi.preset.editor.regex': {
      kind: 'chain'
      scope: 'root'
      owner: PresetEditorOwner
    }
    'eleckoi.preset.manager': {
      kind: 'chain'
      scope: 'root'
      owner: PresetManagerOwner
    }
  }
}
