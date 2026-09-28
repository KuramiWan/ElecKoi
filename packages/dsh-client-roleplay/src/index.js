import { pathToFileURL } from 'node:url'

export const name = 'eleckoi-roleplay'
export const inject = ['agents', 'agentPresets']

export async function apply(ctx) {
  const bridgeEntry = process.env.ELECKOI_ROLEPLAY_BRIDGE_ENTRY
  if (!bridgeEntry) throw new Error('ELECKOI_ROLEPLAY_BRIDGE_ENTRY is required')
  const bridge = await import(pathToFileURL(bridgeEntry).href)
  return bridge.apply(ctx)
}
