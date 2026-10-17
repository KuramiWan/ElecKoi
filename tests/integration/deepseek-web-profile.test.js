import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initProfile, loadLayeredEnv, loadProfileDirectory, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { ELECKOI_DESKTOP_BUNDLES, ELECKOI_INSTALL_ANCHOR } from '../../apps/desktop-host/src/desktopPluginBundles'
import { preparePluginHost } from '../../apps/android-host/src/pluginHostConfiguration'
import { ELECKOI_INSTALL_ANCHOR as ANDROID_INSTALL_ANCHOR } from '../../apps/android-host/src/androidPluginBundles'

const cleanups = []
afterEach(async () => { vi.unstubAllGlobals(); for (const stop of cleanups.splice(0).reverse()) await stop() })

async function start(platform, root) {
  const resources = resolve('apps/desktop/resources/dsh')
  const paths = { runtimeDataRoot: root, homeRoot: join(root, 'home'), workspaceRoot: join(root, 'workspace'),
    productDatabasePath: join(root, 'product.sqlite'), productMediaRoot: join(root, 'media'), resourceRoot: resources,
    presetTemplatePath: join(resources, 'agent-preset-template/agent.cordis.yml'), agentPatchPath: join(resources, 'desktop-agent.patch.yml') }
  const prepared = preparePluginHost(paths)
  const profileDirectory = platform === 'android' ? prepared.profileDirectory : join(paths.homeRoot, 'profiles/desktop')
  if (platform === 'desktop') initProfile(profileDirectory, [...PROFILE_TEMPLATES.web.bundles, ...ELECKOI_DESKTOP_BUNDLES, '@eleckoi/dsh-web-search-tavily'])
  const previous = Object.fromEntries(Object.keys(prepared.environment).map(key => [key, process.env[key]]))
  Object.assign(process.env, prepared.environment)
  cleanups.push(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  const installAnchor = platform === 'android' ? ANDROID_INSTALL_ANCHOR : ELECKOI_INSTALL_ANCHOR
  const profile = loadProfileDirectory('dsh', profileDirectory, installAnchor)
  expect(profile.skippedBundles).toEqual([])
  const overlay = join(profileDirectory, 'eleckoi-plugin-host.patch.yml')
  if (platform === 'desktop') writeFileSync(overlay, JSON.stringify([
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    ...['desktop-product-telemetry', 'product-analytics', 'ui-layout', 'ui-sidebar', 'ui-settings-general', 'ui-settings-models'].map(id => ({ id, disabled: true }))
  ]))
  const running = await runProfile({ environment: loadLayeredEnv('dsh'), profile: platform, resolvedProfile: { profile, installAnchor },
    patchFiles: platform === 'android' ? prepared.patchFiles : [overlay, paths.agentPatchPath], args: ['--no-open', '--port', '0'] })
  cleanups.push(() => running.ctx.fiber.dispose())
  return { ...running, profileDirectory }
}

it.each(['desktop', 'android'])('%s loads both APIs through the shipped bundles, saves settings and executes in roleplay and studio', async platform => {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-web-profile-'))
  cleanups.push(async () => { const child = relative(tmpdir(), root); if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected cleanup target'); await rm(root, { recursive: true, force: true }) })
  const f = await start(platform, root), { ctx } = f
  const api = ctx.eleckoiWebSearchApi
  expect(api.selection()).toBe('provider_native')
  expect(api.fetchSelection()).toBe('http')
  const ns = ctx.settings.describe().find(item => item.ns === 'eleckoi-web-deepseek')
  expect(ctx.settings.describe().map(item => item.ns)).toContain('eleckoi-web-deepseek')
  expect(ns.value).toMatchObject({ apiKeyEnv: 'DEEPSEEK_WEB_API_KEY', count: 10, needContent: false })
  await ctx.settings.mutate(ns.ns, [{ op: 'set', path: ['count'], value: 50 }, { op: 'set', path: ['needContent'], value: true }], ns.revision)
  await api.select('deepseek_api'); await api.selectFetch('deepseek_api')
  expect(api.selection()).toBe('deepseek_api'); expect(api.fetchSelection()).toBe('deepseek_api')
  expect(ctx.settings.describe().find(item => item.ns === ns.ns).value).toMatchObject({ count: 50, needContent: true })
  expect(readFileSync(join(f.profileDirectory, 'cordis.patch.yml'), 'utf8')).toContain('eleckoi-deepseek-api')
  const credentials = vi.spyOn(ctx.credentials, 'resolve').mockResolvedValue({ value: 'synthetic-live-profile', source: 'test' })
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id, context: { contextWindow: 1000000 }, defaultMaxTokens: 8192 } }
    async *stream() { yield { type: 'text', text: '合成响应' } }
  }
  ctx.llm.registerAdapter(['synthetic-web-profile'], new Adapter())
  await ctx.agentDefaultModel.saveSelection({ provider: 'synthetic-web-profile', model: 'synthetic-web-profile' })
  const data = ctx.eleckoiProductData, character = data.createCharacter({ id: 'web-profile-character', name: '合成角色' }).items[0]
  for (const summary of data.readAgentPresetCatalog().presets) {
    const preset = data.readAgentPreset(summary.id)
    data.saveAgentPreset({ ...preset, toolGroups: preset.toolGroups.map(group => group.id === 'builtin:web' ? { ...group, enabled: true, included: true } : group) }, preset.regexRules)
  }
  const chat = await ctx.eleckoiConversationsApi.create({ metadata: { characterId: character.id } })
  const roleplayId = await ctx.eleckoiRoleplaySessions.preparePrompt(chat.conversation.id, '合成联网请求')
  const roleplay = (await ctx.sessionController.resolveAgent(roleplayId)).agent
  const studio = await ctx.eleckoiCreatorStudioRuntime.create(character.id)
  const creator = (await ctx.sessionController.resolveAgent(studio.sessionId)).agent
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (!String(url).startsWith('https://api.deepseek.com/v1/tools/')) throw new Error(`Unexpected request: ${url}`)
    calls.push({ url, input: JSON.parse(init.body), authorization: init.headers.Authorization })
    return new Response(JSON.stringify(String(url).endsWith('/search') ? { results: Array.from({ length: 50 }, (_, index) => ({ title: `合成来源-${index}`, url: `https://example.com/${index}`, snippet: '片段', summary: '摘要', content: `来源正文末尾-${index}`, site_name: null, site_icon: null, date: null, authority: 0, rerank_score: 1 })) } : { title: '抓取标题', content: '合成抓取完整正文末尾' }), { status: 200 })
  }))
  for (const agent of [roleplay, creator]) {
    for (const [name, args, tail] of [['web_search', { queries: ['合成搜索'] }, '来源正文末尾-49'], ['web_fetch', { url: 'https://example.com' }, '合成抓取完整正文末尾']]) {
      expect(agent.ctx.tools.get(name, agent)).toBeDefined()
      const result = await agent.ctx.tools.execute({ callId: `synthetic-${name}`, name, arguments: args, agent, signal: new AbortController().signal })
      expect(result.isError).not.toBe(true)
      const text = result.content.map(block => block.text ?? '').join('\n')
      expect(text).toContain(tail)
      if (name === 'web_fetch') { expect(text).toContain('状态未提供'); expect(text).not.toContain('HTTP 200') }
    }
  }
  expect(calls.filter(call => call.url.endsWith('/search')).every(call => call.input.count === 50 && call.input.need_content === true)).toBe(true)
  expect(calls).toHaveLength(4)
  expect(calls.every(call => call.authorization === 'Bearer synthetic-live-profile')).toBe(true)
  credentials.mockRestore()
  vi.unstubAllGlobals()
  await ctx.fiber.dispose()
  const reopened = await start(platform, root)
  expect(reopened.ctx.eleckoiWebSearchApi.selection()).toBe('deepseek_api')
  expect(reopened.ctx.eleckoiWebSearchApi.fetchSelection()).toBe('deepseek_api')
  expect(reopened.ctx.settings.describe().find(item => item.ns === ns.ns).value).toMatchObject({ count: 50, needContent: true })
}, 30000)
