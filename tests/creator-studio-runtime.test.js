import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { CharacterConfigurationChangeFeed, ProductRecordChangeFeed } from '../packages/host/product-api/src/index'
import * as studioAgent from '../packages/client/features/dsh-client-creator-studio/src/host/agent.mjs'
import { creatorStudioProjection, CREATOR_STUDIO_EVENT } from '../packages/client/features/dsh-client-creator-studio/src/host/projection.mjs'
import { installCreatorStudioRuntime } from '../packages/client/features/dsh-client-creator-studio/src/host/runtime.mjs'
import { readDshSessionLog, rewindDshSession } from '@eleckoi/dsh-runtime'
import { officialChatFixture } from './helpers/officialTrajectory.js'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(stream) {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-studio-'))
  cleanups.push(() => { const child = relative(tmpdir(), root); if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected cleanup path'); rmSync(root, { recursive: true, force: true }) })
  for (const [key, value] of Object.entries({ ELECKOI_DATABASE_PATH: join(root, 'product.sqlite'), ELECKOI_MEDIA_ROOT: join(root, 'media') })) {
    const previous = process.env[key]; process.env[key] = value
    cleanups.push(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  mkdirSync(join(root, 'media'))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(productDataPlugin)
  await ctx.plugin({ name: 'synthetic-studio-notifications', provide: ['eleckoiCharacterConfigurationChanges', 'eleckoiProductRecordChanges'], apply(owner) {
    const configuration = new CharacterConfigurationChangeFeed(), records = new ProductRecordChangeFeed()
    owner.provide('eleckoiCharacterConfigurationChanges', configuration); owner.provide('eleckoiProductRecordChanges', records)
    owner.on('dispose', () => { configuration.close(); records.close() })
  } })
  ctx.sessionProjections.register(creatorStudioProjection)
  await ctx.plugin(Loader)
  ctx.loader.builtins['synthetic-studio-agent'] = studioAgent
  await ctx.plugin(AgentPresetRegistry, { default: 'synthetic-studio-preset' })
  const requests = []
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id } }
    async *stream(options) { requests.push(options); yield* stream(options, requests.length) }
  }
  ctx.llm.registerAdapter(['synthetic'], new Adapter())
  const character = ctx.eleckoiProductData.createCharacter({ id: 'synthetic-character', name: '合成编辑目标', group: '', persona: { assistant_name: '合成角色', assistant_avatar: '', assistant_cover: '' } }).items[0]
  const config = { presetId: 'agent-preset-creator', creatorTools: true }
  const agentOptions = { provider: 'synthetic', model: 'synthetic' }
  await ctx.agentPresets.register({ id: 'synthetic-studio-preset', plugins: [{ id: 'creator', name: 'cordis:synthetic-studio-agent', config }] })
  const setup = async owner => { await ctx.agentPresets.mount(owner, 'synthetic-studio-preset') }
  let handle = await ctx.agents.create({ sessionId: SessionId('synthetic-studio-session'), meta: { agentPreset: 'synthetic-studio-preset' }, agentOptions, setup })
  handle.agent.session.append(CREATOR_STUDIO_EVENT, { presetId: config.presetId, characterId: character.id }, { ignorable: true })
  cleanups.push(() => handle.dispose())
  return { ctx, root, get handle() { return handle }, character, requests,
    async close() { await handle.dispose() },
    async reopen() {
      await handle.dispose()
      handle = await ctx.agents.resume({ resumeSessionId: SessionId('synthetic-studio-session'), agentOptions, setup })
    } }
}
async function* text(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
describe('AI creator studio official Agent integration', { timeout: 30_000 }, () => {
  it('leaves roleplay requests and tools unchanged while a standing studio preset is active', async () => {
    const f = await fixture(async function* () { yield* text('合成回复') })
    await f.ctx.agentPresets.register({ id: 'synthetic-roleplay-preset', plugins: [] })
    const roleplay = await f.ctx.agents.create({ sessionId: SessionId('synthetic-roleplay-session'),
      meta: { agentPreset: 'synthetic-roleplay-preset' }, agentOptions: { provider: 'synthetic', model: 'synthetic' },
      async setup(owner) {
        await f.ctx.agentPresets.mount(owner, 'synthetic-roleplay-preset')
        owner.tools.register(defineTool({ name: 'eleckoi_read_variables', description: '合成角色变量读取', parameters: {},
          output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: () => ({}) }))
      } })
    cleanups.push(() => roleplay.dispose())
    for (const handle of [f.handle, roleplay]) handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成输入' }], source: { kind: 'user' } }))
    await Promise.all([f.handle.agent.whenIdle(), roleplay.agent.whenIdle()])
    const request = f.requests.find(item => item.sessionId === roleplay.agent.id)
    expect(request).toBeDefined()
    expect(request.tools.map(item => item.name)).toEqual(['eleckoi_read_variables'])
    expect(request.messages).toEqual(roleplay.agent.session.deriveMessages().filter(message => message.role !== 'assistant'))
    expect(JSON.stringify(request.messages)).not.toContain('当前编辑目标')
    expect(roleplay.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data.reason).toEqual({ kind: 'completed' })
    expect(f.requests.find(item => item.sessionId === f.handle.agent.id).tools.map(item => item.name)).toEqual(expect.arrayContaining(['eleckoi_call_capability']))
  })
  it('keeps concurrently mounted studio presets and their editing targets separate after resume', async () => {
    const counts = new Map()
    const f = await fixture(async function* (options) {
      const count = (counts.get(options.sessionId) ?? 0) + 1
      counts.set(options.sessionId, count)
      if (count === 1) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `synthetic-read-${options.sessionId}`, name: 'eleckoi_call_capability',
          arguments: JSON.stringify({ capability_id: 'character.read', arguments: {} }) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* text('合成回复')
    })
    const preset = f.ctx.eleckoiProductData.createAgentPreset('合成另一创作预设', '', 'creator')
    const target = f.ctx.eleckoiProductData.createCharacter({ id: 'synthetic-peer-character', name: '合成另一编辑目标' }).items.find(item => item.id === 'synthetic-peer-character')
    await f.ctx.agentPresets.register({ id: 'synthetic-peer-preset', plugins: [{ id: 'creator', name: 'cordis:synthetic-studio-agent', config: { presetId: preset.id, creatorTools: true } }] })
    const peer = await f.ctx.agents.create({ sessionId: SessionId('synthetic-peer-session'), meta: { agentPreset: 'synthetic-peer-preset' },
      agentOptions: { provider: 'synthetic', model: 'synthetic' }, setup: owner => f.ctx.agentPresets.mount(owner, 'synthetic-peer-preset').then(() => {}) })
    cleanups.push(() => peer.dispose())
    peer.agent.session.append(CREATOR_STUDIO_EVENT, { presetId: preset.id, characterId: target.id }, { ignorable: true })
    for (const handle of [f.handle, peer]) handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成读取请求' }], source: { kind: 'user' } }))
    await Promise.all([f.handle.agent.whenIdle(), peer.agent.whenIdle()])
    for (const [agent, character, other] of [[f.handle.agent, f.character, target], [peer.agent, target, f.character]]) {
      const request = f.requests.find(item => item.sessionId === agent.id)
      expect(request).toBeDefined()
      const instructions = JSON.stringify(request.messages)
      expect(instructions).toContain(character.name)
      expect(instructions).not.toContain(other.name)
      const result = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
      expect(result.data.isError).not.toBe(true)
      expect(JSON.stringify(result.data)).toContain(character.name)
      expect(JSON.stringify(result.data)).not.toContain(other.name)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data.reason).toEqual({ kind: 'completed' })
    }
    await f.reopen()
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成恢复后输入' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    expect(JSON.stringify(f.requests.at(-1).messages)).toContain(f.character.name)
    expect(JSON.stringify(f.requests.at(-1).messages)).not.toContain(target.name)
  })
  it('reports invalid bindings in its own studio scope without failing roleplay requests', async () => {
    const f = await fixture(async function* () { yield* text('合成回复') })
    f.handle.agent.session.append(CREATOR_STUDIO_EVENT, { presetId: 'synthetic-wrong-binding', characterId: f.character.id }, { ignorable: true })
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成输入' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    expect(f.requests).toHaveLength(0)
    expect(JSON.stringify(f.handle.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data)).toContain('缺少正式预设绑定')
    const roleplay = await f.ctx.agents.create({ sessionId: SessionId('synthetic-unbound-roleplay'), agentOptions: { provider: 'synthetic', model: 'synthetic' } })
    cleanups.push(() => roleplay.dispose())
    roleplay.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成角色输入' }], source: { kind: 'user' } }))
    await roleplay.agent.whenIdle()
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].sessionId).toBe(roleplay.agent.id)
  })
  it('regenerates repeatedly on the same Session without retaining an empty completed turn', async () => {
    const f = await fixture(async function* (_options, request) {
      if (request === 1) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'synthetic-delete-list-call', name: 'eleckoi_call_capability',
          arguments: JSON.stringify({ capability_id: 'character.read', arguments: {} }) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* text(`合成回复 ${request}`)
    })
    const first = createUserMessage({ content: [{ type: 'text', text: '合成前一轮' }], source: { kind: 'user' } })
    const last = createUserMessage({ content: [{ type: 'text', text: '合成待重新生成输入' }], source: { kind: 'user' } })
    for (const input of [first, last]) { f.handle.agent.followup(input); await f.handle.agent.whenIdle() }
    const previous = {}
    for (const [key, value] of Object.entries({ ELECKOI_PRESET_ROOT: join(f.root, 'presets'), ELECKOI_PRESET_TEMPLATE_PATH: join(f.root, 'template'), ELECKOI_WORKSPACE_ROOT: f.root })) {
      previous[key] = process.env[key]; process.env[key] = value
    }
    cleanups.push(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
    let service
    const dispose = await installCreatorStudioRuntime({
      agents: f.ctx.agents, eleckoiProductData: f.ctx.eleckoiProductData,
      provide: (_key, value) => { service = value },
      sessionController: {
        inspect: async () => ({ meta: f.handle.agent.session.header, events: f.handle.agent.session.snapshotEvents() }),
        create: async () => { await f.reopen() }, resolveAgent: async () => ({ agent: f.handle.agent }),
      },
      eleckoiSessionEditor: { transaction: async (_id, run) => run(), rewind: async (id, turn, seq, retain) => {
        await f.close(); return rewindDshSession(join(f.root, 'sessions'), id, turn, seq, retain)
      } },
    })
    cleanups.push(dispose)
    for (let attempt = 0; attempt < 2; attempt++) {
      await service.regenerate('synthetic-studio-session')
      await f.handle.agent.whenIdle()
      const events = f.handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/end').map(event => event.data)).toEqual([
        { turn: 1, reason: { kind: 'completed' } }, { turn: 2, reason: { kind: 'completed' } },
      ])
      expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').map(event => event.data.id)).toEqual([first.id, last.id])
      expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(3)
      const chat = officialChatFixture().replace(events)
      const processes = [...chat.nodes.values()].filter(node => node.kind === 'turn-process')
      expect(processes.filter(node => node.data.turn === 2)).toHaveLength(1)
      expect(processes.every(node => node.data.turn === 1 || node.data.turn === 2)).toBe(true)
      const deletionList = await service.messages('synthetic-studio-session')
      expect(deletionList).toHaveLength(4)
      expect(deletionList.every(message => message.text.trim())).toBe(true)
      expect(f.requests.at(-1).messages.some(message => message.id === first.id)).toBe(true)
    }
    await f.close()
    expect(readDshSessionLog(join(f.root, 'sessions'), 'synthetic-studio-session').header.id).toBe('synthetic-studio-session')
  })
  it.each([false, true])('keeps complete native history in later requests after reopen=%s', async reopen => {
    const f = await fixture(async function* (_options, request) {
      if (request === 1) {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' }
        yield { type: 'reasoning-delta', index: 0, text: '合成创作分析' }
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '合成创作分析' } }
        yield { type: 'block-start', index: 1, blockType: 'tool-call' }
        yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'synthetic-history-call', name: 'eleckoi_call_capability',
          arguments: JSON.stringify({ capability_id: 'character.read', arguments: {} }) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' }, replayState: {
          response: { id: 'synthetic-response' }, blocks: [{ id: 'synthetic-reasoning' }, { id: 'synthetic-tool' }] } }
      } else yield* text('合成创作回复')
    })
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成第一轮需求' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    const previous = f.handle.agent.session.deriveMessages().filter(message => message.role !== 'system')
    expect(previous.some(message => message.content.some(block => block.type === 'reasoning'))).toBe(true)
    expect(previous.some(message => message.source?.kind === 'tool')).toBe(true)
    if (reopen) await f.reopen()
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续合成需求' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    expect(f.requests).toHaveLength(3)
    for (const message of previous) expect(f.requests[2].messages.find(item => item.id === message.id)).toEqual(message)
    expect(f.handle.agent.session.id).toBe('synthetic-studio-session')
  })
  it('executes a character setting edit through the Agent loop and retains native tool events', async () => {
    const f = await fixture(async function* (options, request) {
      if (request === 1) {
        const call = { type: 'tool-call', id: 'synthetic-call', name: 'eleckoi_call_capability', arguments: JSON.stringify({ capability_id: 'settings.create', arguments: { title: '合成设定', content: '合成正文' } }) }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: call }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* text('已经保存合成设定。')
    })
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '创建合成设定' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    expect(f.requests).toHaveLength(2)
    expect(f.requests[0].tools.map(item => item.name).sort()).toEqual(['eleckoi_call_capability', 'eleckoi_describe_toolset', 'eleckoi_list_toolsets'])
    expect(JSON.stringify(f.requests[0].messages)).toContain('当前编辑目标')
    expect(JSON.stringify(f.requests[0].messages)).not.toContain('<FINAL>')
    expect(f.ctx.eleckoiProductData.readSettingLibrary(f.character.id).entries).toEqual(expect.arrayContaining([expect.objectContaining({ title: '合成设定', content: '合成正文' })]))
    const events = f.handle.agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'tool/result' && !event.data.isError)).toBe(true)
    expect(events.some(event => event.type === 'assistant/message' && JSON.stringify(event.data).includes('已经保存合成设定'))).toBe(true)
  })
  it('diagnoses missing targets and invalid operations without writing another character', async () => {
    const f = await fixture(async function* () { yield* text('合成回复') })
    const execute = args => f.handle.agent.ctx.tools.execute({ callId: 'synthetic-direct', name: 'eleckoi_call_capability', arguments: args, agent: f.handle.agent, signal: new AbortController().signal })
    const describe = await f.handle.agent.ctx.tools.execute({ callId: 'synthetic-guide', name: 'eleckoi_describe_toolset', arguments: { toolset_id: 'scripts', operation_ids: ['scripts.create'], include_schema: true }, agent: f.handle.agent, signal: new AbortController().signal })
    expect(describe.isError, JSON.stringify(describe)).not.toBe(true)
    expect(JSON.stringify(describe)).toContain('api.ui.registerButton')
    expect(JSON.stringify(describe)).toContain('expectedRevision')
    expect(JSON.stringify(describe)).toContain('eleckoi-module')
    f.handle.agent.session.append(CREATOR_STUDIO_EVENT, { presetId: 'agent-preset-creator', characterId: '' }, { ignorable: true })
    const initial = f.ctx.eleckoiProductData.readSettingLibrary(f.character.id)
    const before = f.ctx.eleckoiProductData.saveSettingLibrary(f.character.id, initial)
    const missing = await execute({ capability_id: 'settings.create', arguments: { title: '不能保存', content: '合成内容' } })
    expect(missing.isError).toBe(true)
    expect(JSON.stringify(missing)).toContain('选择角色')
    f.handle.agent.session.append(CREATOR_STUDIO_EVENT, { presetId: 'agent-preset-creator', characterId: f.character.id }, { ignorable: true })
    const invalid = await execute({ capability_id: 'settings.unknown', arguments: {} })
    expect(invalid.isError).toBe(true)
    expect(JSON.stringify(invalid)).toContain('未知创作操作')
    expect(f.ctx.eleckoiProductData.readSettingLibrary(f.character.id)).toEqual(before)
  })
})
