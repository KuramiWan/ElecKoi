import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import eleckoiRemote from '@eleckoi/dsh-product-api/remote'
export type {} from '@eleckoi/dsh-product-api/remote'

export const inject = ['remote']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(eleckoiRemote)
  const verifier = ctx.inject(['remote.eleckoiSystem'], async (scope) => {
    const status = await scope.remote.eleckoiSystem.status()
    if (!status.ok || status.value.architecture !== 'dsh-remote' || status.value.protocolVersion !== 1) {
      throw new Error(status.ok ? 'ElecKoi DSH Remote 协议版本不兼容。' : status.error.message)
    }
  })
  try {
    await verifier
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await verifier.dispose()
    await disposeRemote()
  }
}
