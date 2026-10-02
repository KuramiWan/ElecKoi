import z from '@deepseek-ai/schemastery'

export const name = 'eleckoi-display-preferences'
export const inject = ['settings', 'eleckoiProductData']
export const SETTINGS_NAMESPACE = 'eleckoi-display-preferences'

export const Config = z.object({
  ui: z.any().default({}).volatile(),
  chatDisplay: z.any().default({}).volatile()
})

export function apply(ctx, config) {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  const data = ctx.eleckoiProductData
  const adopt = () => data.setDisplayPreferences(config.ui.get())
  adopt()
  ctx.on('loader/volatile-update', changed => {
    if (changed.some(path => path[0] === 'ui')) adopt()
  })
}
