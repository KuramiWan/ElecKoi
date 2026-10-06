import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { ElecKoiConversationLifecycle } from '../packages/dsh-product-api/src/conversationLifecycle'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../packages/dsh-product-data/src/storage/sqlite/SqliteDatabase'
import { ConversationRepository } from '../packages/dsh-product-data/src/domain/conversations/ConversationRepository'
import { VariableStateRepository } from '../packages/dsh-product-data/src/domain/variables/VariableStateRepository'
import { VariableConfigRepository } from '../packages/dsh-product-data/src/domain/variables/VariableConfigRepository'
import { installRoleplaySessionRuntime } from '../packages/dsh-client-roleplay/src/host/session-runtime.mjs'
import { writeSessionSnapshot } from '../packages/dsh-client-roleplay/src/host/session-snapshot.mjs'
import { readDshSessionLog } from '../packages/dsh-runtime/src/trajectory'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-generation-save-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'product.sqlite3')
  for (const [key, value] of Object.entries({ ELECKOI_DATABASE_PATH: path, ELECKOI_MEDIA_ROOT: root,
    ELECKOI_WORKSPACE_ROOT: root, ELECKOI_SESSION_SNAPSHOT_ROOT: root, ELECKOI_PRESET_ROOT: root,
    ELECKOI_PRESET_TEMPLATE_PATH: root, ELECKOI_SESSION_BRIDGE_ROOT: root })) {
    const previous = process.env[key]; process.env[key] = value
    cleanups.push(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const initial = new SqliteDatabase(path)
  initial.open()
  const conversationId = new ConversationRepository(initial).create({ title: '合成聊天' }).conversation.id
  initial.close()
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(productDataPlugin)
  await ctx.plugin(ElecKoiConversationLifecycle)
  await ctx.plugin({ name: 'synthetic-roleplay-services', provide: ['sessionController', 'agentDefaultModel'], apply(owner) {
    owner.provide('sessionController', {})
    owner.provide('agentDefaultModel', {})
  } })
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id } }
    async *stream() {
      const text = '<FINAL>合成正文</FINAL>'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['synthetic'], new Adapter())
  const input = { operationId: 'synthetic-attempt', conversationId, runtimeSessionId: conversationId, turn: 1 }
  ctx.eleckoiConversationLifecycle.begin(input)
  const variableStateFile = join(root, 'variables.json')
  mkdirSync(join(root, conversationId), { recursive: true })
  writeFileSync(variableStateFile, JSON.stringify({ state: { score: 1 } }))
  writeSessionSnapshot(root, conversationId, { conversationId, operationId: input.operationId,
    variablesEnabled: true, variableStateFile,
    generationVariableStateJson: ctx.eleckoiProductData.snapshotConversationRuntime(conversationId).variableStateJson })
  cleanups.push(installRoleplaySessionRuntime(ctx, {}))
  const handle = await ctx.agents.create({ sessionId: SessionId(conversationId), agentOptions: { provider: 'synthetic', model: 'synthetic' } })
  return { ctx, root, path, conversationId, input, handle }
}

function run(f) {
  f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成输入' }], source: { kind: 'user' } }))
  return f.handle.agent.whenIdle()
}

describe('official Session and product save boundary', { timeout: 30_000 }, () => {
  it('flushes the real Session before committing variables, waits for plugins, and retains variables after reopening without a result table', async () => {
    const f = await fixture()
    let release
    const gate = new Promise(resolve => { release = resolve })
    let sawDurableReply = false
    let entered
    const started = new Promise(resolve => { entered = resolve })
    f.ctx.eleckoiConversationLifecycle.register({ id: 'synthetic-memory', async afterSave() {
      sawDurableReply = readDshSessionLog(join(f.root, 'sessions'), f.conversationId).events.some(event => event.type === 'turn/end')
      expect(JSON.parse(f.ctx.eleckoiProductData.snapshotConversationRuntime(f.conversationId).variableStateJson)).toEqual({ score: 1 })
      entered()
      await gate
    } })
    await run(f)
    let finished = false
    const pending = f.ctx.eleckoiConversationLifecycle.wait(f.conversationId, f.input.operationId).then(() => { finished = true })
    await Promise.race([started, pending.then(() => { throw new Error('Save finished before the plugin was called') })])
    expect(sawDurableReply).toBe(true)
    expect(finished).toBe(false)
    release(); await pending
    expect(JSON.parse(f.ctx.eleckoiProductData.snapshotConversationRuntime(f.conversationId).variableStateJson)).toEqual({ score: 1 })
    await f.ctx.fiber.dispose()
    const reopened = new SqliteDatabase(f.path)
    reopened.open()
    try {
      expect(JSON.parse(new VariableStateRepository(reopened, new VariableConfigRepository(reopened)).viewerStates(f.conversationId).currentStateJson)).toEqual({ score: 1 })
      expect(reopened.native.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_generation_results'").get()).toBeUndefined()
    }
    finally { reopened.close() }
  })

  it('reports plugin finalization failure and preserves the already saved variables', async () => {
    const f = await fixture()
    f.ctx.eleckoiConversationLifecycle.register({ id: 'synthetic-failure', afterSave() { throw new Error('synthetic plugin failure') } })
    await run(f)
    await expect(f.ctx.eleckoiConversationLifecycle.wait(f.conversationId, f.input.operationId)).rejects.toThrow('synthetic plugin failure')
    expect(JSON.parse(f.ctx.eleckoiProductData.snapshotConversationRuntime(f.conversationId).variableStateJson)).toEqual({ score: 1 })
  })

  it('does not commit variables or call plugins if the official durability barrier fails', async () => {
    const f = await fixture()
    let called = false
    f.ctx.on('session/flush', () => { throw new Error('synthetic disk failure') })
    f.ctx.eleckoiConversationLifecycle.register({ id: 'synthetic-save', afterSave() { called = true } })
    await run(f)
    await expect(f.ctx.eleckoiConversationLifecycle.wait(f.conversationId, f.input.operationId)).rejects.toThrow('synthetic disk failure')
    expect(called).toBe(false)
    expect(f.ctx.eleckoiProductData.snapshotConversationRuntime(f.conversationId).variableStateJson).toBe('{}')
  })

  it('preserves a manual variable update made while the AI was working', async () => {
    const f = await fixture()
    f.ctx.eleckoiProductData.replaceConversationVariableState(f.conversationId, '{"score":7}')
    await run(f)
    await expect(f.ctx.eleckoiConversationLifecycle.wait(f.conversationId, f.input.operationId)).rejects.toThrow('未覆盖当前变量')
    expect(JSON.parse(f.ctx.eleckoiProductData.snapshotConversationRuntime(f.conversationId).variableStateJson)).toEqual({ score: 7 })
  })
})
