import { apply as applyBridge } from './host/agent-preset-bridge.mjs'

export const name = 'eleckoi-roleplay'
export const inject = ['agents', 'agentPresets']

export async function apply(ctx) {
  return applyBridge(ctx)
}
