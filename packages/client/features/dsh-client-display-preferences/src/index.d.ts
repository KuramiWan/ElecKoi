import type { Context } from '@deepseek-ai/cordis'

export const name: string
export const inject: readonly string[]
export const SETTINGS_NAMESPACE: string
export const Config: unknown
export function apply(ctx: Context, config: {
  ui: { get(): Record<string, unknown> }
  chatDisplay: { get(): Record<string, unknown> }
}): void
