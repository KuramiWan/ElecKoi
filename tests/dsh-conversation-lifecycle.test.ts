import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ElecKoiConversationLifecycle } from '../packages/host/product-api/lib/types/conversationLifecycle.js'

const preparation = { operationId: 'attempt-a', conversationId: 'chat-a', runtimeSessionId: 'session-a', turn: 1 }

async function fixture() {
  const ctx = new Context()
  await ctx.plugin({ name: 'synthetic-product-data', provide: 'eleckoiProductData', apply(owner) {
    owner.provide('eleckoiProductData', {} as any)
  } })
  await ctx.plugin(ElecKoiConversationLifecycle)
  return ctx
}

describe('internal conversation save coordination', () => {
  it('keeps only the current wait, reports late failures, and releases waits on deletion or replacement', async () => {
    const ctx = await fixture()
    const service = ctx.eleckoiConversationLifecycle
    try {
      service.begin(preparation)
      await expect(service.wait('chat-a', 'attempt-a')).rejects.toThrow('尚未进入保存')
      let calls = 0
      service.track('chat-a', 'attempt-a', async () => { calls++; throw new Error('synthetic save failure') })
      await expect(service.wait('chat-a', 'attempt-a')).rejects.toThrow('synthetic save failure')
      service.track('chat-a', 'attempt-a', async () => { calls++ })
      expect(calls).toBe(1)
      await service.drain('chat-a')
      service.begin({ ...preparation, operationId: 'attempt-b' })
      await expect(service.wait('chat-a', 'attempt-a')).rejects.toThrow('等待信息已不存在')
      service.track('chat-a', 'attempt-b', async () => {})
      await expect(service.wait('chat-a', 'attempt-b')).resolves.toBeUndefined()
      service.forget('chat-a')
      await expect(service.wait('chat-a', 'attempt-b')).rejects.toThrow('等待信息已不存在')
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps preparation and editing exclusive within a chat while allowing other chats', async () => {
    const ctx = await fixture()
    try {
      let release!: () => void
      const pending = ctx.eleckoiConversationLifecycle.exclusive('chat-a', () => new Promise<void>(resolve => { release = resolve }))
      await expect(ctx.eleckoiConversationLifecycle.exclusive('chat-a', async () => {})).rejects.toThrow('当前聊天')
      await expect(ctx.eleckoiConversationLifecycle.exclusive('chat-b', async () => 'ready')).resolves.toBe('ready')
      release(); await pending
    } finally { await ctx.fiber.dispose() }
  })
})
