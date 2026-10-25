import { Peer } from '@deepseek-ai/dsh-client-connection'
/** @type {WeakMap<import('@deepseek-ai/cordis').Context, Peer>} */
const owners = new WeakMap()
/** Explicit owner identity for in-process Remote regression callers.
 * @param {import('@deepseek-ai/cordis').Context} ctx */
export function ownerPeer(ctx) {
  let peer = owners.get(ctx.root)
  if (!peer) { peer = new Peer(ctx.root, { principal: { kind: 'owner' } }); owners.set(ctx.root, peer) }
  return peer
}
