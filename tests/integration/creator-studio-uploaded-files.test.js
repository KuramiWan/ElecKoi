import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import Commands from '@deepseek-ai/dsh-commands'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as spillPolicy from '@deepseek-ai/dsh-spill-policy'
import ToolResultStore from '../../packages/client/features/dsh-client-roleplay/src/host/tool-result-store.mjs'
import { emptyEntry } from '../../packages/host/product-data/src/domain/settingLibraries/index'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { CharacterConfigurationChangeFeed, ProductRecordChangeFeed } from '../../packages/host/product-api/src/index'
import { installCreatorStudioRuntime } from '../../packages/client/features/dsh-client-creator-studio/src/host/runtime.mjs'
import { creatorStudioProjection } from '../../packages/client/features/dsh-client-creator-studio/src/host/projection.mjs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureSerializedRequest } from '../helpers/captureModelRequest.js'

const RESULT_READER = 'eleckoi_call_capability'
const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(existing, { productionTemplate = false, stream } = {}) {
  const root = existing?.root ?? mkdtempSync(join(tmpdir(), 'eleckoi-studio-files-'))
  if (!existing) cleanups.push(() => {
    const child = relative(tmpdir(), root)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected cleanup path')
    rmSync(root, { recursive: true, force: true })
  })
  const resources = join(root, 'resources'), template = join(resources, 'agent-preset-template', 'agent.cordis.yml')
  mkdirSync(join(resources, 'agent-preset-template'), { recursive: true })
  writeFileSync(join(resources, 'uploaded-file-tools.mjs'),
    `export * from ${JSON.stringify(pathToFileURL(resolve('apps/desktop/resources/dsh/uploaded-file-tools.mjs')).href)}\n`)
  const sections = ['variables', 'setting-library', 'web', 'workspace', 'collaboration', 'roleplay-workflow', 'workflow']
  writeFileSync(template, productionTemplate ? readFileSync(resolve('apps/desktop/resources/dsh/agent-preset-template/agent.cordis.yml'), 'utf8')
    : '- id: uploaded-file-tools\n  name: __ELECKOI_UPLOADED_FILE_TOOLS_PLUGIN__\n' + sections.map(id => `# ELECKOI:${id}:BEGIN\n# ELECKOI:${id}:END\n`).join(''))
  for (const [key, value] of Object.entries({ ELECKOI_DATABASE_PATH: join(root, 'product.sqlite'), ELECKOI_MEDIA_ROOT: join(root, 'media'),
    ELECKOI_PRESET_ROOT: join(root, 'presets'), ELECKOI_PRESET_TEMPLATE_PATH: template, ELECKOI_WORKSPACE_ROOT: root })) {
    const previous = process.env[key]; process.env[key] = value
    cleanups.push(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  mkdirSync(join(root, 'media'), { recursive: true })
  const ctx = new Context(), requests = [], requestedPaths = new Map()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('settings', { describe: () => [] })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'synthetic', model: 'synthetic' }) })
  ctx.provide('workspaceRegistry', { pinnedSessionIds: [], archivedSessionIds: [] })
  ctx.provide('connection', { fetch: { register: () => () => {} } })
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry, Commands, TypertRegistry, TokenMeter]) await ctx.plugin(plugin)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(SessionQuery, { path: join(root, 'query.sqlite') })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(ToolResultStore, { root: join(root, 'tool-results'), cleanupPeriodDays: 0 })
  await ctx.plugin(spillPolicy, { maxInlineTokens: 12_500, exemptTools: ['eleckoi_read_uploaded_file'], pagedTools: ['eleckoi_read_setting_files', 'eleckoi_read_variables', RESULT_READER] })
  await ctx.plugin(FileUploads)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(productDataPlugin)
  ctx.provide('eleckoiCharacterConfigurationChanges', new CharacterConfigurationChangeFeed())
  ctx.provide('eleckoiProductRecordChanges', new ProductRecordChangeFeed())
  ctx.sessionProjections.register(creatorStudioProjection)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(AgentPresetRegistry, { default: 'synthetic-unused-preset' })
  await ctx.plugin(SessionController, { nativeOpen: false })
  const expectedContent = '合成上传内容：synthetic-file-marker'
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id, context: { contextWindow: 10_000_000 }, defaultMaxTokens: 8192 } }
    async *stream(options) {
      requests.push(options)
      if (stream) { yield* stream(options, requests.length); return }
      const last = options.messages.at(-1)
      if (last.role === 'user') {
        const uploaded = (await ctx.sessionQuery.readSurface(options.sessionId)).events
          .findLast(event => event.type === 'user/message').data.content.find(part => part.type === 'file').attachment
        const filePath = requestedPaths.get(options.sessionId) ?? ctx.fs.processPathFromHostPath(ctx.attachments.fileHostPath(uploaded))
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `synthetic-read-${requests.length}`,
          name: 'eleckoi_read_uploaded_file', arguments: JSON.stringify({ file_path: filePath }) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '合成读取完成' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '合成读取完成' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['synthetic'], new Adapter())
  const runtimePlugin = { name: 'synthetic-studio-file-runtime',
    inject: ['agents', 'agentPresets', 'agentDefaultModel', 'llm', 'settings', 'sessionController', 'eleckoiProductData', 'workspaceRegistry'],
    apply: installCreatorStudioRuntime }
  await ctx.plugin(runtimePlugin)
  const service = ctx.eleckoiCreatorStudioRuntime
  const opened = existing ? await service.open(existing.sessionId) : await service.create()
  async function sendFile(sessionId, { content = expectedContent, readPath } = {}) {
    const { agent } = await ctx.sessionController.resolveAgent(sessionId)
    if (readPath === undefined) requestedPaths.delete(sessionId)
    else requestedPaths.set(sessionId, readPath)
    const receipt = await ctx.fileUploads.upload(agent, { data: Buffer.from(content).toString('base64'), name: 'synthetic-notes.md' }, new AbortController().signal)
    await ctx.sessionController.prompt({ sessionId, requestId: `synthetic-upload-${randomUUID()}`, mode: 'queue',
      content: [{ type: 'text', text: '读取上传文件' }, { type: 'file', receiptId: receipt.receiptId }] }, new AbortController().signal)
    await agent.whenIdle()
    return { agent, receipt }
  }
  return { ctx, root, opened, requests, expectedContent, sendFile, service, async restart() {
    await ctx.fiber.dispose()
    return fixture({ root, sessionId: opened.sessionId }, { productionTemplate, stream })
  } }
}

describe('Creator studio uploaded-file composition', { timeout: 30_000 }, () => {
  it.each([101, 1_001, 10_001])('recovers the complete %i-entry catalog and large bodies through the real Studio composition', async count => {
    let stage = 0, waiting, nextOffset = 0, recovered = '', expected, entries
    const refs = []
    const f = await fixture(undefined, { productionTemplate: true, stream: async function* (request) {
      if (request.messages.at(-1).role === 'tool') {
        const text = request.messages.at(-1).content[0].text
        if (waiting === 'read') {
          const page = JSON.parse(text)
          recovered += page.content
          nextOffset = page.next_offset
          if (nextOffset === null) {
            expect(JSON.parse(recovered).value).toEqual(expected[stage])
            stage++; waiting = undefined
          }
        } else if (text.includes('Full formatted result stored at: ')) {
          recovered = ''; nextOffset = 0; waiting = 'read'
          expect(refs.length).toBeGreaterThan(0)
        } else {
          expect(JSON.parse(text).value).toEqual(expected[stage])
          stage++; waiting = undefined
        }
      }
      if (stage >= 4) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '合成目录与正文已完整恢复' } }
        yield { type: 'finish', reason: { kind: 'stop' } }; return
      }
      const reading = waiting === 'read'
      const selected = [0, Math.floor(count / 2), count - 1]
      const args = reading ? { result: { file_path: refs.at(-1).locator, offset: nextOffset, limit: 250_000 } }
        : stage === 0 ? { capability_id: 'settings.list', arguments: {} }
          : { capability_id: 'settings.read', arguments: { id: entries[selected[stage - 1]].id } }
      if (!reading) waiting = 'capability'
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `synthetic-recovery-${request.messages.length}`,
        name: reading ? RESULT_READER : 'eleckoi_call_capability', arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } })
    const originalSave = f.ctx.spillStore.saveText.bind(f.ctx.spillStore)
    const save = vi.spyOn(f.ctx.spillStore, 'saveText').mockImplementation(async input => { const ref = await originalSave(input); refs.push(ref); return ref })
    const character = f.ctx.eleckoiProductData.createCharacter({ id: 'synthetic-volume-character', name: '合成编辑目标', group: '' }).items[0]
    const selected = [0, Math.floor(count / 2), count - 1]
    entries = Array.from({ length: count }, (_, index) => ({ ...emptyEntry(`synthetic-entry-${index}`), title: `合成设定-${index}`,
      content: selected.includes(index) ? `开始-${index}|${'合成正文𠮷😀'.repeat(20_001)}|末尾关键词-${index}` : `合成正文-${index}`,
      agentReadStrategy: 'keyword', keywords: Array.from({ length: selected.includes(index) ? 1_501 : 1 }, (_, key) => `关键词-${index}-${key}`),
    }))
    const library = f.ctx.eleckoiProductData.readSettingLibrary(character.id)
    f.ctx.eleckoiProductData.saveSettingLibrary(character.id, { ...library, entries: [...library.entries, ...entries] })
    const { creatorCapabilities } = await import('@eleckoi/dsh-product-data')
    const capabilities = creatorCapabilities(f.ctx.eleckoiProductData)
    expected = [capabilities.find(item => item.id === 'settings.list').execute(character.id, {}),
      ...selected.map(index => capabilities.find(item => item.id === 'settings.read').execute(character.id, { id: entries[index].id }))]
    await f.service.selectCharacter(f.opened.sessionId, character.id)
    const { agent } = await f.ctx.sessionController.resolveAgent(f.opened.sessionId)
    await f.ctx.sessionController.prompt({ sessionId: agent.id, requestId: 'synthetic-recovery-request', mode: 'queue',
      content: [{ type: 'text', text: '读取当前一张角色卡的完整目录及首中末条目' }] }, new AbortController().signal)
    await agent.whenIdle()
    expect(stage).toBe(4)
    expect(save).toHaveBeenCalledTimes(count === 101 ? 3 : 4)
    expect(f.requests[0].tools.map(tool => tool.name)).toContain(RESULT_READER)
    expect(f.requests.every(request => !request.tools.some(tool => tool.name === 'eleckoi_read_tool_result'))).toBe(true)
    expect(f.requests.some(request => request.purpose === 'compaction')).toBe(false)
    expect(agent.session.snapshotEvents().some(event => event.type === 'compaction/prune')).toBe(false)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data.reason).toEqual({ kind: 'completed' })
    if (count === 10_001) for (const api of ['deepseek_messages', 'openai-completions', 'openai-responses']) {
      const request = f.requests.at(-1), wire = await captureSerializedRequest(api, request)
      const expectedOutputs = request.messages.filter(message => message.role === 'tool')
        .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      const outputs = api === 'deepseek_messages'
        ? wire.messages.flatMap(message => message.content.filter(block => block.type === 'tool_result').map(block => block.content.map(part => part.text || '').join('')))
        : api === 'openai-completions' ? wire.messages.filter(message => message.role === 'tool').map(message => message.content)
          : wire.input.filter(item => item.type === 'function_call_output').map(item => item.output)
      expect(outputs, api).toEqual(expectedOutputs)
      expect(outputs.some(output => output.includes('末尾关键词-10000')), api).toBe(true)
    }
    const originalId = agent.id, ref = refs.at(-1)
    await f.ctx.sessions.flush(agent.session)
    save.mockRestore()
    const reopened = await f.restart()
    const resumed = (await reopened.ctx.sessionController.resolveAgent(originalId)).agent
    expect(resumed.id).toBe(originalId)
    expect(resumed.ctx.tools.schemas(resumed).map(tool => tool.name)).toContain(RESULT_READER)
    expect(resumed.ctx.get('toolResultPruner')).toBeUndefined()
    expect((await reopened.ctx.spillStore.readResult({ file_path: ref.locator }, { agent: resumed, signal: new AbortController().signal }, 'creator')).content).toContain('"value"')
  }, 120_000)

  it('continues a large write receipt through the existing creator call without repeating the write', async () => {
    const body = `${'合成正文😀'.repeat(20_001)}最终写入关键词`
    let ref, read
    const f = await fixture(undefined, { productionTemplate: true, stream: async function* (request, step) {
      if (step === 3) {
        const page = JSON.parse(request.messages.at(-1).content[0].text)
        expect(page.kind).toBe('tool_result_page')
        expect(page.matches).toHaveLength(1)
        read = true
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '合成写入回执已读取' } }
        yield { type: 'finish', reason: { kind: 'stop' } }; return
      }
      const args = step === 1 ? { capability_id: 'settings.create', arguments: { title: '合成写入条目', content: body } }
        : { result: { file_path: ref.locator, query: '最终写入关键词' } }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `synthetic-write-receipt-${step}`, name: RESULT_READER, arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } })
    const character = f.ctx.eleckoiProductData.createCharacter({ id: 'synthetic-write-target', name: '合成编辑目标', group: '' }).items[0]
    await f.service.selectCharacter(f.opened.sessionId, character.id)
    const before = f.ctx.eleckoiProductData.readSettingLibrary(character.id).entries.length
    const originalSave = f.ctx.spillStore.saveText.bind(f.ctx.spillStore)
    const save = vi.spyOn(f.ctx.spillStore, 'saveText').mockImplementation(async input => { ref = await originalSave(input); return ref })
    const { agent } = await f.ctx.sessionController.resolveAgent(f.opened.sessionId)
    await f.ctx.sessionController.prompt({ sessionId: agent.id, requestId: 'synthetic-write-receipt', mode: 'queue', content: [{ type: 'text', text: '创建一条合成设定并续读回执' }] }, new AbortController().signal)
    await agent.whenIdle()
    expect(read).toBe(true)
    const after = f.ctx.eleckoiProductData.readSettingLibrary(character.id).entries
    expect(after).toHaveLength(before + 1)
    expect(after.filter(entry => entry.title === '合成写入条目').map(entry => entry.content)).toEqual([body])
    expect(save).toHaveBeenCalledTimes(1)
    save.mockRestore()
  })

  it('uploads through the official receipt flow and reads the text during the Agent tool loop', async () => {
    const f = await fixture()
    const { agent, receipt } = await f.sendFile(f.opened.sessionId)
    expect(f.requests[0].tools.map(tool => tool.name)).toContain('eleckoi_read_uploaded_file')
    expect(f.requests[0].tools.filter(tool => tool.name === 'eleckoi_read_uploaded_file')).toHaveLength(1)
    expect(JSON.stringify(f.requests[0].messages)).toContain('synthetic-notes.md')
    expect(JSON.stringify(f.requests[1].messages)).toContain(f.expectedContent)
    expect(agent.session.deriveMessages().find(message => message.role === 'user').content)
      .toContainEqual({ type: 'file', attachment: receipt.file })
    await f.ctx.sessions.flush(agent.session)
    const id = agent.id
    const reopened = await f.restart()
    expect(reopened.opened.sessionId).toBe(id)
    await reopened.sendFile(id)
    expect(reopened.requests.at(-1).messages.some(message => JSON.stringify(message).includes(f.expectedContent))).toBe(true)
  })

  it('restores the required reader when an existing generated studio preset omitted it', async () => {
    const f = await fixture()
    const { agent } = await f.sendFile(f.opened.sessionId)
    const presetId = (await f.ctx.sessionController.inspect(agent.id)).meta.agentPreset
    const path = join(f.root, 'presets', 'creator-studio', presetId, 'preset.json')
    const definition = JSON.parse(readFileSync(path, 'utf8'))
    definition.plugins = definition.plugins.filter(plugin => plugin.id !== 'uploaded-file-tools')
    writeFileSync(path, JSON.stringify(definition))
    const reopened = await f.restart()
    // Resume must retain the conversation identity and the persisted file reference.
    expect(reopened.opened.sessionId).toBe(agent.id)
    await reopened.sendFile(agent.id)
    expect(reopened.requests.at(-2).tools.map(tool => tool.name)).toContain('eleckoi_read_uploaded_file')
    expect(JSON.stringify(reopened.requests.at(-1).messages)).toContain(f.expectedContent)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(definition)
  })

  it('rejects another studio Session file even when its exact attachment id is known', async () => {
    const f = await fixture()
    const peer = await f.service.create()
    const foreignText = 'synthetic-other-session-private-content'
    const { receipt } = await f.sendFile(peer.sessionId, { content: foreignText })
    const before = f.requests.length
    await f.sendFile(f.opened.sessionId, { readPath: receipt.file.attachmentId })
    const request = f.requests.slice(before).at(-1)
    expect(request.sessionId).toBe(f.opened.sessionId)
    expect(JSON.stringify(request.messages)).toContain('此文件不在当前会话的可读附件中。')
    expect(JSON.stringify(request.messages)).not.toContain(foreignText)
  })

  it('reports binary content as unsupported text instead of claiming to read it', async () => {
    const f = await fixture()
    await f.sendFile(f.opened.sessionId, { content: Buffer.from([0x41, 0, 0x42]) })
    expect(JSON.stringify(f.requests.at(-1).messages)).toContain('此文件是二进制内容，无法作为文本读取。')
  })
})
