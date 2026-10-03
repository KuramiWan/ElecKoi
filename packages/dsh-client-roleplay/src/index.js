import { apply as applyBridge } from './host/agent-preset-bridge.mjs'
import { requestContextProjection } from './host/request-context-projection.mjs'
import { migrateLegacyGlobalModelSelection } from './host/model-selection-migration.mjs'

export const name = 'eleckoi-roleplay'
export const inject = [
  'agents',
  'agentPresets',
  'agentDefaultModel',
  'eleckoiProductData',
  'llm',
  'settings',
  'sessionController',
  'sessionProjections'
]

export async function apply(ctx) {
  await migrateLegacyGlobalModelSelection(ctx)
  ctx.sessionProjections.register(requestContextProjection)
  return applyBridge(ctx)
}
