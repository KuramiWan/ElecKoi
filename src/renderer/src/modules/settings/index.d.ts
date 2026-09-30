import type { ComponentType } from 'react'

export interface UiPreferences {
  conversation_content_width?: number
  [key: string]: unknown
}

export const SettingsPanel: ComponentType<Record<string, unknown>>
export function getUiPreferences(): Promise<UiPreferences | null>
export function saveUiPreferences(payload: Partial<UiPreferences>): Promise<UiPreferences>
export function updateUiPreferences(
  update: (current: UiPreferences) => UiPreferences
): Promise<UiPreferences>
export function emitUiPreferencesChanged(payload: UiPreferences): void
export function listenUiPreferencesChanged(
  handler: (payload: UiPreferences) => void
): Promise<() => void>
