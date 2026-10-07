import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ElecKoiConversationLifecycle } from '@eleckoi/dsh-product-api'
import type { ConversationPreparation, ConversationRestore } from '@eleckoi/dsh-product-api'

const preparation = { operationId: 'attempt-a', conversationId: 'chat-a', runtimeSessionId: 'session-a',
  turn: 1, text: '合成输入', model: { provider: 'synthetic', model: 'synthetic-model' },
  runtime: { conversationContext: { settingLibrary: { entries: [{ content: '合成设定', agentReadStrategy: 'required', position: 'instructions' }] } } }
} as unknown as ConversationPreparation
const restore = { operationId: 'rewind-a', conversationId: 'chat-a', runtimeSessionId: 'session-a',
  reason: 'regenerate', fromTurn: 1, fromEventSeq: 3, state: { variableStateJson: '{}', settingLibraryStateJson: '[]' }
} as ConversationRestore

async function fixture() {
  const ctx = new Context()
  await ctx.plugin({ name: 'synthetic-product-data', provide: 'eleckoiProductData', apply(owner) {
    owner.provide('eleckoiProductData', {} as any)
  } })
  await ctx.plugin(ElecKoiConversationLifecycle)
  return ctx
}

describe('Cordis conversation lifecycle', () => {
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

  it('awaits preparation in order, preserves full setting configuration, and removes unloaded participants', async () => {
    const ctx = await fixture()
    try {
      const calls: string[] = []
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const plugin = await ctx.plugin({ name: 'synthetic-participant', inject: ['eleckoiConversationLifecycle'], apply(owner) {
        owner.eleckoiConversationLifecycle.register({ id: 'first', async prepare(input) {
          expect(input.runtime.conversationContext.settingLibrary?.entries[0]).toMatchObject({ agentReadStrategy: 'required', position: 'instructions' })
          calls.push('first'); await gate; calls.push('finished')
        } })
      } })
      ctx.eleckoiConversationLifecycle.register({ id: 'second', prepare() { calls.push('second') } })
      const pending = ctx.eleckoiConversationLifecycle.prepare(preparation)
      await Promise.resolve(); await Promise.resolve()
      expect(calls).toEqual(['first'])
      release(); await pending
      expect(calls).toEqual(['first', 'finished', 'second'])
      await plugin.dispose()
      calls.length = 0
      await ctx.eleckoiConversationLifecycle.prepare(preparation)
      expect(calls).toEqual(['second'])
    } finally { await ctx.fiber.dispose() }
  })

  it('propagates request cancellation to preparation and stops later participants', async () => {
    const ctx = await fixture()
    try {
      const abort = new AbortController()
      const calls: string[] = []
      ctx.eleckoiConversationLifecycle.register({ id: 'first', async prepare(_input, signal) {
        calls.push('first'); abort.abort(new Error('synthetic cancellation')); signal.throwIfAborted()
      } })
      ctx.eleckoiConversationLifecycle.register({ id: 'second', prepare() { calls.push('second') } })
      await expect(ctx.eleckoiConversationLifecycle.prepare(preparation, abort.signal)).rejects.toThrow('synthetic cancellation')
      expect(calls).toEqual(['first'])
    } finally { await ctx.fiber.dispose() }
  })

  it('cancels and drains an active callback when its owning Cordis plugin unloads', async () => {
    const ctx = await fixture()
    try {
      let entered!: () => void
      const started = new Promise<void>(resolve => { entered = resolve })
      let completed = false
      const plugin = await ctx.plugin({ name: 'synthetic-unload', inject: ['eleckoiConversationLifecycle'], apply(owner) {
        owner.eleckoiConversationLifecycle.register({ id: 'unload', async prepare(_input, signal) {
          entered()
          await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
          completed = true
        } })
      } })
      const pending = ctx.eleckoiConversationLifecycle.prepare(preparation)
      const rejected = expect(pending).rejects.toThrow('已停用')
      await started; await plugin.dispose(); await rejected
      expect(completed).toBe(true)
      await ctx.eleckoiConversationLifecycle.prepare(preparation)
    } finally { await ctx.fiber.dispose() }
  })

  it('rolls back every prepared participant in reverse order when one apply fails', async () => {
    const ctx = await fixture()
    try {
      const calls: string[] = []
      for (const id of ['one', 'two']) ctx.eleckoiConversationLifecycle.register({ id, prepareRestore() {
        calls.push(`prepare:${id}`)
        return { apply() { calls.push(`apply:${id}`); if (id === 'two') throw new Error('synthetic restore failure') },
          rollback() { calls.push(`rollback:${id}`) } }
      } })
      await expect(ctx.eleckoiConversationLifecycle.restore(restore, async () => { calls.push('edit') })).rejects.toThrow('synthetic restore failure')
      expect(calls).toEqual(['prepare:one', 'prepare:two', 'apply:one', 'apply:two', 'rollback:two', 'rollback:one'])
    } finally { await ctx.fiber.dispose() }
  })

  it('restores plugin state when the existing Session edit rejects, and keeps other chats independent', async () => {
    const ctx = await fixture()
    try {
      let state = 'old'
      ctx.eleckoiConversationLifecycle.register({ id: 'memory', prepareRestore() {
        return { apply() { state = 'rewound' }, rollback() { state = 'old' } }
      } })
      await expect(ctx.eleckoiConversationLifecycle.restore(restore, async () => {
        expect(state).toBe('rewound'); throw new Error('synthetic session error')
      })).rejects.toThrow('synthetic session error')
      expect(state).toBe('old')
      let release!: () => void
      const pending = ctx.eleckoiConversationLifecycle.exclusive('chat-a', () => new Promise<void>(resolve => { release = resolve }))
      await expect(ctx.eleckoiConversationLifecycle.exclusive('chat-a', async () => {})).rejects.toThrow('当前聊天')
      await expect(ctx.eleckoiConversationLifecycle.exclusive('chat-b', async () => 'ready')).resolves.toBe('ready')
      release(); await pending
    } finally { await ctx.fiber.dispose() }
  })
})
