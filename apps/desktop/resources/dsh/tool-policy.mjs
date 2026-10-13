// 边界④ 的出口：`apply()` 抛出（含注册失败）时先产出带码的可记录对象并写诊断出口。
// 显式导出 `apply` 会盖住 `export *` 里的同名导出（ESM：显式导出优先于星号导出），
// 其余名字仍走星号，所以这个壳的公开面不变。
import { apply as applyToolPolicy } from '@eleckoi/dsh-client-roleplay/host/tool-policy.mjs'
import { runRuntimePluginApply } from './runtime-plugin-failure.mjs'

export * from '@eleckoi/dsh-client-roleplay/host/tool-policy.mjs'

export function apply(ctx) {
  return runRuntimePluginApply('tool-policy', () => applyToolPolicy(ctx))
}
