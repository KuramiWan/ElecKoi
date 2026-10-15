import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import Loader from '@deepseek-ai/cordis-plugin-loader'
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
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { CharacterConfigurationChangeFeed, ProductRecordChangeFeed } from '../packages/host/product-api/src/index'
import { installCreatorStudioRuntime } from '../packages/client/features/dsh-client-creator-studio/src/host/runtime.mjs'
import { creatorStudioProjection } from '../packages/client/features/dsh-client-creator-studio/src/host/projection.mjs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(existing) {
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
  writeFileSync(template, '- id: uploaded-file-tools\n  name: __ELECKOI_UPLOADED_FILE_TOOLS_PLUGIN__\n'
    + sections.map(id => `# ELECKOI:${id}:BEGIN\n# ELECKOI:${id}:END\n`).join(''))
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
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry, Commands, TypertRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(SessionQuery, { path: join(root, 'query.sqlite') })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(FileUploads)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(productDataPlugin)
  ctx.provide('eleckoiCharacterConfigurationChanges', new CharacterConfigurationChangeFeed())
  ctx.provide('eleckoiProductRecordChanges', new ProductRecordChangeFeed())
  ctx.sessionProjections.register(creatorStudioProjection)
  await ctx.plugin(Loader)
  await ctx.plugin(AgentPresetRegistry, { default: 'synthetic-unused-preset' })
  await ctx.plugin(SessionController, { nativeOpen: false })
  const expectedContent = '合成上传内容：synthetic-file-marker'
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id } }
    async *stream(options) {
      requests.push(options)
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
    return fixture({ root, sessionId: opened.sessionId })
  } }
}

describe('Creator studio uploaded-file composition', { timeout: 30_000 }, () => {
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
