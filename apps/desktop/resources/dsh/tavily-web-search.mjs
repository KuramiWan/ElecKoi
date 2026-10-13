// 边界④ 的出口：`apply()` 抛出（含注册失败）时先产出带码的可记录对象并写诊断出口。
import { Config, apply as applyTavilyWebSearch, inject, name } from '@eleckoi/dsh-web-search-tavily'
import { runRuntimePluginApply } from './runtime-plugin-failure.mjs'

export { Config, inject, name }

export function apply(ctx, config) {
  return runRuntimePluginApply('web-search-tavily', () => applyTavilyWebSearch(ctx, config))
}
