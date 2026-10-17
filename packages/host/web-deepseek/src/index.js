import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DEEPSEEK_API_PROVIDER, DEEPSEEK_WEB_KEY_REF, searchDeepSeek, fetchDeepSeek } from './api.js'

export const name = 'eleckoi-web-deepseek'
export const inject = ['web', 'credentials']
export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEEPSEEK_WEB_KEY_REF).volatile(),
  count: z.number().step(1).min(1).max(50).default(10).volatile(),
  needContent: z.boolean().default(false).volatile(),
  localization: z.string().default('').volatile()
})

export function apply(ctx, config) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'DeepSeek web requests')
  async function run(signal, action) {
    const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])])
    combined.throwIfAborted()
    const key = (await ctx.credentials.resolve(credentialRef(config.apiKeyEnv.get())))?.value ?? ''
    combined.throwIfAborted()
    return action(key, combined)
  }
  ctx.web.registerSearchProvider({
    id: DEEPSEEK_API_PROVIDER,
    available: () => true,
    search: (request, signal) => run(signal, (key, combined) => searchDeepSeek(key, {
      query: request.query,
      count: request.maxResults === undefined ? config.count.get() : Math.min(request.maxResults, config.count.get()),
      need_content: config.needContent.get(), localization: config.localization.get()
    }, combined))
  })
  ctx.web.registerFetchProvider({
    id: DEEPSEEK_API_PROVIDER,
    available: () => true,
    fetch: (request, signal) => run(signal, (key, combined) => fetchDeepSeek(key, request, combined))
  })
}
