// 边界④ 的出口：`apply()` 抛出（含注册失败）时先产出带码的可记录对象并写诊断出口。
// 显式导出 `apply` 会盖住 `export *` 里的同名导出（ESM：显式导出优先于星号导出），
// 其余名字仍走星号，所以这个壳的公开面不变。
import { apply as applyAgentPresetBridge } from '@eleckoi/dsh-client-roleplay/host/agent-preset-bridge.mjs'
import { runRuntimePluginApply } from './runtime-plugin-failure.mjs'

export * from '@eleckoi/dsh-client-roleplay/host/agent-preset-bridge.mjs'

export function apply(ctx, config) {
  return runRuntimePluginApply('agent-preset-bridge', () => applyAgentPresetBridge(ctx, config))
}
