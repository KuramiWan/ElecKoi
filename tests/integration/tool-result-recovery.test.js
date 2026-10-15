import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as spillPolicy from '@deepseek-ai/dsh-spill-policy'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import ToolResultStore from '../../packages/client/features/dsh-client-roleplay/src/host/tool-result-store.mjs'
import * as settingTools from '../../apps/desktop/resources/dsh/setting-library-tools.mjs'
import * as variableTools from '../../apps/desktop/resources/dsh/variable-tools.mjs'
import { ElecKoiVariableProcessing } from '../../packages/host/product-api/src/variable-processing.ts'
import { emptyEntry } from '../../packages/host/product-data/src/domain/settingLibraries/index'
import { RESULT_READERS, resultDomain } from '../../packages/client/features/dsh-client-roleplay/src/host/tool-result-access.mjs'
import { applyDisabledPolicy, filterDeclarations } from '../../packages/client/features/dsh-client-roleplay/src/host/tool-policy.mjs'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const RESULT_READER = RESULT_READERS.settings
const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture({ root, sessionId = 'result-owner', stream } = {}) {
  if (!root) {
    root = mkdtempSync(join(tmpdir(), 'eleckoi-tool-results-'))
    cleanups.push(() => { const child = relative(tmpdir(), root); if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected cleanup path'); rmSync(root, { recursive: true, force: true }) })
  }
  const ctx = new Context(), requests = []
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('sessionQuery', { readSession: vi.fn() })
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, Tools, AgentRegistry, TokenMeter]) await ctx.plugin(plugin)
  await ctx.plugin(ToolResultStore, { root, cleanupPeriodDays: 0 })
  await ctx.plugin(spillPolicy, { maxInlineTokens: 12_500, exemptTools: ['eleckoi_read_uploaded_file'], pagedTools: Object.values(RESULT_READERS) })
  ctx.provide('eleckoiProductData', { commitConversationRuntime: vi.fn() })
  ctx.provide('eleckoiCharacterConfigurationChanges', { publish: vi.fn() })
  ctx.provide('eleckoiVariableProcessing', new ElecKoiVariableProcessing(null))
  await ctx.plugin(settingTools)
  await ctx.plugin(variableTools)
  await ctx.plugin(AgentLoop, { agents: [] })
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id, context: { contextWindow: 10_000_000 } } }
    async *stream(options) { requests.push(options); yield* stream(options, requests.length) }
  }
  ctx.llm.registerAdapter(['synthetic'], new Adapter())
  const handle = await ctx.agents.create({ sessionId: SessionId(sessionId), cwd: root, agentOptions: { provider: 'synthetic', model: 'synthetic' } })
  cleanups.push(() => handle.dispose())
  const exec = { agent: handle.agent, signal: new AbortController().signal }
  const save = content => ctx.spillStore.saveText({ owner: { sessionId: handle.agent.session.id }, source: { kind: 'tool', toolName: 'eleckoi_read_setting_files', callId: 'synthetic-call', label: 'result' }, suggestedName: 'result.txt', content })
  return { ctx, root, handle, exec, requests, save, read: args => ctx.spillStore.readResult(args, exec, 'settings') }
}

describe('Complete tool-result access', { timeout: 30_000 }, () => {
  it('writes one complete artifact and one small ownership record per result, with no files added by repeated reads', async () => {
    const f = await fixture(), body = '合成正文😀'.repeat(10_001), refs = []
    const listFiles = () => readdirSync(f.root, { recursive: true }).filter(name => statSync(join(f.root, name)).isFile()).sort()
    for (let index = 0; index < 12; index++) {
      refs.push(await f.save(body))
      expect(listFiles()).toHaveLength((index + 1) * 2)
    }
    const files = listFiles(), before = files.map(name => statSync(join(f.root, name)).size)
    expect(files.filter(name => name.endsWith('.owner.json')).every(name => statSync(join(f.root, name)).size < 512)).toBe(true)
    expect(before.reduce((total, size) => total + size, 0)).toBeLessThan(12 * (Buffer.byteLength(body) + 512))
    for (const ref of refs) {
      let offset = 0, restored = ''
      do {
        const page = await f.read({ file_path: ref.locator, offset })
        restored += page.content; offset = page.next_offset
      } while (offset !== null)
      expect(restored).toBe(body)
    }
    expect(listFiles()).toEqual(files)
    expect(files.map(name => statSync(join(f.root, name)).size)).toEqual(before)
  })

  it.each(['eleckoi_glob_setting_files', 'eleckoi_grep_setting_files', 'eleckoi_read_setting_files',
    'eleckoi_glob_variables', 'eleckoi_grep_variables', 'eleckoi_read_variables'])('recovers the complete real %s output through the Agent loop', async toolName => {
    let ref, offset = 0, recovered = '', args, original
    const f = await fixture({ stream: async function* (request, step) {
      if (step === 2) expect(request.messages.at(-1).content[0].text).toContain(RESULT_READERS[resultDomain(toolName)])
      if (step > 2) {
        const page = JSON.parse(request.messages.at(-1).content[0].text)
        recovered += page.content
        offset = page.next_offset
      }
      yield { type: 'block-start', index: 0, blockType: offset === null ? 'text' : 'tool-call' }
      yield { type: 'block-end', index: 0, block: offset === null ? { type: 'text', text: '合成角色工具全文已恢复' }
        : { type: 'tool-call', id: `synthetic-real-tool-${step}`, name: step === 1 ? toolName : RESULT_READERS[resultDomain(toolName)],
          arguments: JSON.stringify(step === 1 ? args : { result: { file_path: ref.locator, offset, limit: 100_000 } }) } }
      yield { type: 'finish', reason: { kind: offset === null ? 'stop' : 'tool-calls' } }
    } })
    const count = 1_001, snapshotRoot = join(f.root, 'snapshots')
    mkdirSync(snapshotRoot)
    const previous = process.env.ELECKOI_SESSION_SNAPSHOT_ROOT
    process.env.ELECKOI_SESSION_SNAPSHOT_ROOT = snapshotRoot
    cleanups.push(() => { if (previous === undefined) delete process.env.ELECKOI_SESSION_SNAPSHOT_ROOT; else process.env.ELECKOI_SESSION_SNAPSHOT_ROOT = previous })
    const entries = Array.from({ length: count }, (_, index) => ({ ...emptyEntry(`synthetic-setting-${index}`), title: `合成设定-${String(index).padStart(4, '0')}`,
      content: `完整正文与末尾关键词-${index}`, agentReadStrategy: 'normal' }))
    const library = { characterId: 'synthetic-character', groups: [], entries }
    const settingFile = join(f.root, 'setting-state.json'), variableFile = join(f.root, 'variable-state.json')
    writeFileSync(settingFile, JSON.stringify({ enabled: true, library, history: [], variableState: {} }))
    const variables = Array.from({ length: count }, (_, index) => ({ id: `synthetic-variable-${index}`, title: `合成指标-${String(index).padStart(4, '0')}`,
      objectId: '', enabled: true, type: 'number', defaultValue: '0', description: `合成说明-${index}`, updateRule: `完整更新规则-${index}`, readMode: 'required' }))
    const state = Object.fromEntries(variables.map(variable => [variable.title, 0]))
    writeFileSync(variableFile, JSON.stringify({ enabled: true, config: { initialState: state, schemaCode: '', objects: [], variables }, state }))
    writeFileSync(join(snapshotRoot, `${f.handle.agent.session.id}.json`), JSON.stringify({ conversationId: 'synthetic-chat',
      settingStateFile: settingFile, settingLibraryEnabled: true, settingLibraryBaseline: { source: library, projected: library }, variableStateFile: variableFile, variablesEnabled: true }))
    args = toolName.includes('grep') ? { pattern: toolName.endsWith('variables') ? '合成指标' : '合成设定' }
      : toolName.includes('read') ? { paths: toolName.endsWith('variables') ? variables.map(variable => `/${variable.title}`) : entries.map(entry => entry.title) } : {}
    f.ctx.on('tools/post-execute', async (exec, result, next) => { if (exec.name === toolName && !Object.hasOwn(exec.arguments, 'result')) original = result.content[0].text; return next() })
    const originalSave = f.ctx.spillStore.saveText.bind(f.ctx.spillStore)
    const save = vi.spyOn(f.ctx.spillStore, 'saveText').mockImplementation(async input => { ref = await originalSave(input); return ref })
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成大量设定与变量读取' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    expect(recovered).toBe(original)
    const parsed = JSON.parse(recovered)
    expect(parsed.status).toBe('ok')
    expect(parsed.files ?? parsed.matches ?? parsed.paths ?? parsed.variables).toHaveLength(count)
    expect(parsed.omitted ?? 0).toBe(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect(f.handle.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data.reason).toEqual({ kind: 'completed' })
    save.mockRestore()
  })

  it('reconstructs a long single line with Chinese, surrogate pairs and the final keyword without splitting UTF-8', async () => {
    const f = await fixture()
    const original = `开始𠮷${'合成正文😀'.repeat(20_001)}末尾关键词`
    const ref = await f.save(original)
    let offset = 0, reconstructed = '', pages = 0
    do {
      const page = await f.read({ file_path: ref.locator, offset, limit: pages < 8 ? 1 : 32_768 })
      reconstructed += page.content
      expect(page.content).not.toContain('\ufffd')
      expect(page.total_bytes).toBe(Buffer.byteLength(original))
      expect(page.next_offset === null || page.next_offset > offset).toBe(true)
      offset = page.next_offset
      pages++
    } while (offset !== null)
    expect(reconstructed).toBe(original)
    expect(ref.retrievalHint).toContain(RESULT_READER)
    expect(pages).toBeGreaterThan(10)
    await expect(f.read({ file_path: ref.locator, offset: 1 })).rejects.toThrow('UTF-8')
  })

  it('finds literal keywords across stream boundaries and retrieves every match through continuation', async () => {
    const f = await fixture()
    const original = `${'x'.repeat(65_535)}中文😀${'合成关键词𠮷,'.repeat(1_501)}最终关键词`
    const ref = await f.save(original)
    let offset = 0, matches = []
    do {
      const page = await f.read({ file_path: ref.locator, offset, query: '合成关键词𠮷', limit: 37 })
      matches.push(...page.matches)
      expect(page.next_offset === null || page.next_offset > offset).toBe(true)
      offset = page.next_offset
    } while (offset !== null)
    expect(matches).toHaveLength(1_501)
    const bytes = Buffer.from(original)
    for (const match of matches) expect(bytes.subarray(match.offset, match.offset + Buffer.byteLength('合成关键词𠮷')).toString()).toBe('合成关键词𠮷')
    const final = await f.read({ file_path: ref.locator, query: '最终关键词' })
    expect(final.matches).toHaveLength(1)
    const body = await f.read({ file_path: ref.locator, offset: final.matches[0].offset })
    expect(body.content).toBe('最终关键词')
    expect(await f.read({ file_path: ref.locator, query: '不匹配的文字' })).toMatchObject({ matches: [], next_offset: null })
  })

  it('rejects another session, arbitrary files, invalid offsets and missing ownership records', async () => {
    const f = await fixture(), other = await fixture({ sessionId: 'other-result-owner' })
    const ref = await f.save('合成内容')
    await expect(other.read({ file_path: ref.locator })).rejects.toThrow('无权')
    const peer = await fixture({ root: f.root, sessionId: 'same-root-peer' })
    await expect(peer.read({ file_path: ref.locator })).rejects.toThrow('不属于')
    await expect(f.ctx.spillStore.readResult({ file_path: ref.locator }, f.exec, 'variables')).rejects.toThrow('本工具组')
    await expect(f.ctx.spillStore.readResult({ file_path: ref.locator }, f.exec, 'creator')).rejects.toThrow('本工具组')
    const arbitrary = join(f.root, 'arbitrary.txt')
    writeFileSync(arbitrary, '无归属的合成内容')
    await expect(f.read({ file_path: arbitrary })).rejects.toThrow('凭据')
    await expect(f.read({ file_path: ref.locator, offset: 10_000 })).rejects.toThrow('范围')
    await expect(f.read({ file_path: ref.locator, limit: 0 })).rejects.toThrow('limit')
    await expect(f.read({ file_path: ref.locator, query: '' })).rejects.toThrow('query')
    rmSync(ref.locator)
    await expect(f.read({ file_path: ref.locator })).rejects.toThrow('失效')
  })

  it.each(['settings', 'variables'])('continues and searches through the existing %s reader and rejects mixed business arguments', async domain => {
    const f = await fixture(), reader = RESULT_READERS[domain], body = '合成关键词𠮷😀'.repeat(1_501)
    const ref = await f.ctx.spillStore.saveText({ owner: { sessionId: f.handle.agent.session.id },
      source: { kind: 'tool', toolName: reader, callId: 'synthetic-owned-result', label: 'result' }, suggestedName: 'result.txt', content: body })
    const run = args => f.handle.agent.ctx.tools.execute({ callId: 'synthetic-read-own-result', name: reader, arguments: args, ...f.exec })
    const page = await run({ result: { file_path: ref.locator, query: '合成关键词𠮷😀', limit: 1_501 } })
    expect(page.isError).not.toBe(true)
    expect(page.value.matches).toHaveLength(1_501)
    expect(page.value.next_offset).toBeNull()
    const mixed = await run({ paths: ['synthetic'], result: { file_path: ref.locator } })
    expect(mixed.isError).toBe(true)
    expect(mixed.content[0].text).toContain('只传 result')
    expect(f.ctx.tools.schemas().map(tool => tool.name)).not.toContain('eleckoi_read_tool_result')
    expect(filterDeclarations([{ name: reader }], [`builtin:${domain === 'settings' ? 'setting-library' : 'variables'}`])).toEqual([])
    applyDisabledPolicy(f.handle.agent.ctx, [`builtin:${domain === 'settings' ? 'setting-library' : 'variables'}`])
    expect((await run({ result: { file_path: ref.locator } })).isError).toBe(true)
    applyDisabledPolicy(f.handle.agent.ctx, [])
    expect((await run({ result: { file_path: ref.locator } })).isError).not.toBe(true)
  })

  it('retains session authorization and exact content after the Host is reconstructed', async () => {
    const f = await fixture()
    const ref = await f.save('合成重开内容𠮷😀')
    await f.ctx.fiber.dispose()
    const reopened = await fixture({ root: f.root })
    expect(await reopened.read({ file_path: ref.locator })).toMatchObject({ content: '合成重开内容𠮷😀', next_offset: null })
    expect(readFileSync(`${ref.locator}.owner.json`, 'utf8')).not.toContain('合成重开内容')
  })

  it('rejects cancellation without returning a placeholder success', async () => {
    const f = await fixture(), ref = await f.save('合成取消场景')
    const controller = new AbortController(), reason = new Error('Synthetic cancellation')
    controller.abort(reason)
    await expect(f.ctx.spillStore.readResult({ file_path: ref.locator }, { ...f.exec, signal: controller.signal }, 'settings')).rejects.toBe(reason)
  })

  it('allows only result artifacts actually inherited at the official Session fork boundary', async () => {
    const f = await fixture({ stream: async function* (_options, step) {
      yield { type: 'block-start', index: 0, blockType: step === 1 ? 'tool-call' : 'text' }
      yield { type: 'block-end', index: 0, block: step === 1
        ? { type: 'tool-call', id: 'synthetic-fork-call', name: 'eleckoi_glob_setting_files', arguments: '{}' }
        : { type: 'text', text: '合成分叉前回复' } }
      yield { type: 'finish', reason: { kind: step === 1 ? 'tool-calls' : 'stop' } }
    } })
    const original = '合成继承全文𠮷😀'.repeat(20_001)
    f.handle.agent.ctx.tools.register(defineTool({ name: 'eleckoi_glob_setting_files', description: '合成分叉结果', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: original }] }, execute: () => ({ content: original }) }))
    const save = vi.spyOn(f.ctx.spillStore, 'saveText')
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成分叉权限测试' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    const ref = await save.mock.results[0].value
    const child = f.ctx.sessions.fork(f.handle.agent.session, undefined, SessionId('synthetic-result-child'))
    const inherited = await f.ctx.spillStore.readResult({ file_path: ref.locator, limit: Buffer.byteLength(original) }, { ...f.exec, agent: { session: child } }, 'settings')
    expect(inherited.content).toBe(original)
    const firstUser = f.handle.agent.session.snapshotEvents().find(event => event.type === 'user/message')
    const earlier = f.ctx.sessions.fork(f.handle.agent.session, firstUser.seq, SessionId('synthetic-result-earlier-child'))
    await expect(f.ctx.spillStore.readResult({ file_path: ref.locator }, { ...f.exec, agent: { session: earlier } }, 'settings')).rejects.toThrow('不属于')
    const grandchild = f.ctx.sessions.fork(child, undefined, SessionId('synthetic-result-grandchild'))
    expect((await f.ctx.spillStore.readResult({ file_path: ref.locator }, { ...f.exec, agent: { session: grandchild } }, 'settings')).content).toBeTruthy()
    save.mockRestore()
  })

  it('keeps a reader response above the spill budget intact without writing another spill file', async () => {
    const f = await fixture()
    const original = `${'合成😀'.repeat(30_000)}最后关键词`
    const ref = await f.save(original)
    const save = vi.spyOn(f.ctx.spillStore, 'saveText')
    const result = await f.handle.agent.ctx.tools.execute({ callId: 'read-complete-result', name: RESULT_READER,
      arguments: { result: { file_path: ref.locator, limit: Buffer.byteLength(original) } }, ...f.exec })
    expect(result.isError).not.toBe(true)
    expect(result.value.content).toBe(original)
    expect(JSON.parse(result.content[0].text).content).toBe(original)
    expect(save).not.toHaveBeenCalled()
    expect(filterDeclarations([{ name: RESULT_READER }], ['builtin:other', 'builtin:workspace'])).toEqual([{ name: RESULT_READER }])
    save.mockRestore()
  })

  it('recovers a PTC dispatch artifact, keeps its reader log whole, and permits an inheriting fork', async () => {
    let ref
    const original = '合成程序工具正文😀'.repeat(20_001)
    const f = await fixture({ stream: async function* (_options, step) {
      yield { type: 'block-start', index: 0, blockType: step <= 2 ? 'tool-call' : 'text' }
      yield { type: 'block-end', index: 0, block: step <= 2
        ? { type: 'tool-call', id: `synthetic-ptc-${step}`, name: 'run_code', arguments: JSON.stringify({ code: step === 1 ? 'source' : 'read', description: '合成程序工具续读' }) }
        : { type: 'text', text: '合成程序工具已完整读取' } }
      yield { type: 'finish', reason: { kind: step <= 2 ? 'tool-calls' : 'stop' } }
    } })
    class SyntheticRuntime extends PtcRuntime {
      language = 'typescript'
      isolation = 'synthetic'
      resolve(request) { return { ...request, cwd: f.root, timeoutMs: 30_000 } }
      async run(request) {
        const tools = request.bindings[0].functions
        if (request.program === 'source') expect(await tools.eleckoi_glob_setting_files({})).toBe(original)
        else expect((await tools[RESULT_READER]({ result: { file_path: ref.locator, limit: Buffer.byteLength(original) } })).content).toBe(original)
        return { logs: [], value: '合成程序读取完成' }
      }
    }
    await f.ctx.plugin(SyntheticRuntime)
    const stop = f.handle.agent.ctx.tools.presentAs('both')
    cleanups.push(stop)
    f.handle.agent.ctx.tools.register(defineTool({ name: 'eleckoi_glob_setting_files', description: '合成程序数据源', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: () => original }))
    const save = vi.spyOn(f.ctx.spillStore, 'saveText').mockImplementation(async input => {
      ref = await ToolResultStore.prototype.saveText.call(f.ctx.spillStore, input); return ref
    })
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成程序工具结果恢复' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    const dispatches = f.handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch')
    expect(dispatches).toHaveLength(2)
    expect(dispatches.every(event => event.data.isError === false)).toBe(true)
    expect(JSON.parse(dispatches[1].data.content[0].text).content).toBe(original)
    expect(save).toHaveBeenCalledTimes(1)
    const child = f.ctx.sessions.fork(f.handle.agent.session, undefined, SessionId('synthetic-ptc-child'))
    expect((await f.ctx.spillStore.readResult({ file_path: ref.locator, limit: Buffer.byteLength(original) }, { ...f.exec, agent: { session: child } }, 'settings')).content).toBe(original)
    save.mockRestore()
  })

  it.each([101, 1_001, 10_001])('returns all %i entries to the model through actual spill and result-reader calls', async count => {
    const entries = Array.from({ length: count }, (_, index) => ({ id: `synthetic-${index}`, title: `合成条目-${index}`, content: `${'合成正文'.repeat(count === 101 ? 200 : 60)}|末尾关键词-${index}` }))
    const complete = JSON.stringify({ entries })
    let ref, reconstructed = '', nextOffset = 0
    const f = await fixture({ stream: async function* (options, step) {
      if (step > 1) {
        const result = options.messages.at(-1)
        if (step === 2) {
          expect(result.content[0].text).toContain(RESULT_READER)
          expect(result.content[0].text).toContain('Full formatted result stored at:')
        } else {
          const value = JSON.parse(result.content[0].text)
          reconstructed += value.content
          nextOffset = value.next_offset
        }
      }
      if (step === 1 || nextOffset !== null) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `volume-call-${step}`,
          name: step === 1 ? 'eleckoi_glob_setting_files' : RESULT_READER,
          arguments: step === 1 ? '{}' : JSON.stringify({ result: { file_path: ref.locator, offset: nextOffset, limit: 250_000 } }) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '合成全文恢复完成' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    } })
    f.handle.agent.ctx.tools.register(defineTool({ name: 'eleckoi_glob_setting_files', description: '合成大结果', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: complete }] }, execute: () => ({ entries }) }))
    const save = vi.spyOn(f.ctx.spillStore, 'saveText').mockImplementationOnce(async input => {
      ref = await ToolResultStore.prototype.saveText.call(f.ctx.spillStore, input)
      return ref
    })
    f.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '合成大量条目完整读取' }], source: { kind: 'user' } }))
    await f.handle.agent.whenIdle()
    expect(reconstructed).toBe(complete)
    expect(JSON.parse(reconstructed).entries).toHaveLength(count)
    expect(f.handle.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data.reason).toEqual({ kind: 'completed' })
    expect(save).toHaveBeenCalledTimes(1)
    save.mockRestore()
  })
})
