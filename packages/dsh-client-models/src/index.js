import z from '@deepseek-ai/schemastery'

export const name = 'eleckoi-client-models'
export const inject = ['settings']
export const Config = z.object({ entries: z.any().default({}).volatile() })

export function apply(ctx) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
}
