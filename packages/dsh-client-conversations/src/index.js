import z from '@deepseek-ai/schemastery'

export const name = 'eleckoi-client-conversations'
export const inject = ['settings']
export const SETTINGS_NAMESPACE = 'eleckoi-client-conversations'

export const Config = z.object({
  selection: z.any().default({ active_conversation_id: '', preferred_sessions: {} }).volatile()
})

export function apply(ctx) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
}
