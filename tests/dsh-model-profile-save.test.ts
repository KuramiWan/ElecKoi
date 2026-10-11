import { mkdtempSync, mkdirSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import { discoverDraftModels, readModelApiKey } from '@eleckoi/dsh-product-api'
import { afterEach, describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/client/features/dsh-client-models/src/client.js', import.meta.url), 'utf8')
const modelSettings = createRequire(import.meta.url)('../packages/client/features/dsh-client-models/src/index.js')
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'eleckoi-model-save-')))
  cleanups.push(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['model-save-test'])
  writeFileSync(join(home, 'package.json'), '{"name":"model-save-test"}\n')
  const bundle = join(dir, 'node_modules', 'model-save-test')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'model-save-test', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } }
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'llm', name: 'cordis:llm' },
    { id: 'credentials', name: 'cordis:credentials', config: { path: join(dir, '.credentials.yaml'), watch: false } },
    { id: 'llm-pi-ai', name: 'cordis:pi-ai', config: { providers: {} } },
    { id: 'eleckoi-client-models', name: 'cordis:model-settings', config: { schemaVersion: 2 } }
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['model-save-test'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined
  }
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), context => {
      context.provide('profileContext', profile)
      context.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(context.loader.builtins, {
        editor: ConfigEditor, settings: Settings, llm: LlmRuntime,
        credentials: LocalCredentialProvider, 'pi-ai': piAi, 'model-settings': modelSettings
      })
    })
    cleanups.push(() => ctx.fiber.dispose())
    return { ctx, catalog: await clientCatalog(ctx) }
  }
  return { ...(await start()), profile, start }
}

async function clientCatalog(ctx: Context) {
  let registration: any
  let catalog: any
  const result = async (read: () => unknown) => {
    try { return { ok: true, value: await read() } }
    catch (error) { return { ok: false, error: { message: (error as Error).message } } }
  }
  const remote = {
    settings: {
      describe: () => result(() => ({ namespaces: ctx.settings.describe({ redactSecrets: true }) })),
      mutate: (ns: string, ops: any, revision: number) => result(async () => {
        await ctx.settings.mutate(ns, JSON.parse(JSON.stringify(ops)), revision)
        return ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === ns)
      })
    },
    llm: { listConfigurableProviders: () => result(() => ctx.llm.listConfigurableProviders()) },
    credentials: {
      describe: (refs: string[]) => result(async () => Object.fromEntries(await Promise.all(
        refs.map(async ref => [ref, await ctx.credentials.describe(ref as never)])
      ))),
      set: (ref: string, value: string) => result(() => ctx.credentials.set(ref as never, value)),
      unset: (ref: string) => result(() => ctx.credentials.unset(ref as never))
    },
    eleckoiModels: {
      revealApiKey: (id: string) => result(() => readModelApiKey(ctx, id)),
      discoverModels: (input: any) => result(() => discoverDraftModels(ctx, input))
    },
    session: { modelCatalog: () => result(async () => ({
      groups: await Promise.all(ctx.llm.listProviders().map(async provider => ({
        id: provider.id, name: provider.name, models: await ctx.llm.listModels(provider.id)
      })))
    })) }
  }
  runInNewContext(source, { window: { __ModuleLoader__: { load: (item: any) => { registration = item } } } })
  dshClientPlugin(registration).apply({ remote,
    provide: (_name: string, value: unknown) => { catalog = value }, effect: () => {}, on: () => () => {} })
  cleanups.push(() => catalog.dispose())
  await catalog.refresh()
  return catalog
}

const draft = () => ({ id: 'config-synthetic', provider: 'custom', name: '', model: '', model_options: [],
  api_format: 'responses', base_url: 'https://models.example/v1', api_key: 'synthetic-test-value',
  custom_headers: { 'x-model-config': 'synthetic-header' } })

describe('model configuration persistence through DSH settings', () => {
  it.each(['responses', 'chat_completions', 'anthropic_messages', 'google_gemini'])(
    'retains an incomplete %s configuration and clears it without registering a route', async api_format => {
      const { ctx, catalog, start } = await fixture()
      const saved = await catalog.save({ ...draft(), api_format })
      expect(saved).toMatchObject({ api_format, base_url: draft().base_url, model: '', model_options: [],
        api_key: '', credentialConfigured: true, enabled: false })
      expect(ctx.llm.listProviders()).toEqual([])
      await ctx.fiber.dispose()
      const reopened = await start()
      const restored = reopened.catalog.getSnapshot().configs.find((item: any) => item.id === saved.id)
      expect(restored).toMatchObject(saved)
      await reopened.catalog.save({ ...restored, clearConfiguration: true })
      expect(reopened.catalog.getSnapshot().configs).toEqual([])
      expect((await reopened.ctx.credentials.describe(saved.credentialRef)).configured).toBe(false)
    }, 30_000)

  it('saves only endpoint and key, restores them, and activates a manually added model without discovery', async () => {
    let { ctx, catalog, profile, start } = await fixture()
    const saved = await catalog.save(draft())
    expect(saved).toMatchObject({ ...draft(), name: draft().id, api_key: '', credentialConfigured: true, enabled: false })
    expect(ctx.llm.listProviders()).toEqual([])
    expect(readFileSync(profile.patchPath, 'utf8')).not.toContain(draft().api_key)
    await ctx.fiber.dispose()
    ;({ ctx, catalog } = await start())
    const restored = catalog.getSnapshot().configs.find((item: any) => item.id === saved.id)
    expect(restored).toMatchObject({ ...saved, api_key: '', enabled: false })
    await expect(catalog.revealApiKey(saved.id)).resolves.toBe(draft().api_key)

    await expect(catalog.save({ ...restored, model: 'synthetic-model', model_options: [
      { id: 'synthetic-model', contextWindowTokens: -1 }
    ] })).rejects.toThrow('contextWindow')
    await catalog.refresh()
    expect(catalog.getSnapshot().configs.find((item: any) => item.id === saved.id)).toMatchObject(restored)
    expect(ctx.llm.listProviders()).toEqual([])

    const active = await catalog.save({ ...restored, name: 'Synthetic provider', model: 'synthetic-model',
      model_options: [{ id: 'synthetic-model', isUserAdded: true, contextWindowTokens: 65536, topP: 0.95 }] })
    expect(active).toMatchObject({ enabled: true, credentialConfigured: true, model: 'synthetic-model' })
    expect(active.model_options[0]).toMatchObject({ isUserAdded: true, contextWindowTokens: 65536, topP: 0.95 })
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual([saved.id])
    expect((await ctx.llm.listModels(saved.id)).map(model => model.id)).toEqual(['synthetic-model'])
    expect((ctx.settings.describe().find(row => row.ns === 'eleckoi-client-models')!.value as any)
      .entries[saved.id]).not.toHaveProperty('draftProfile')

    const emptied = await catalog.save({ ...active, model: '', model_options: [] })
    expect(emptied).toMatchObject({ enabled: false, model_options: [], base_url: draft().base_url })
    expect(ctx.llm.listProviders()).toEqual([])
    await expect(catalog.revealApiKey(saved.id)).resolves.toBe(draft().api_key)
    await catalog.deleteConfig(saved.id)
    expect(catalog.getSnapshot().configs).toEqual([])
    expect((await ctx.credentials.describe(saved.credentialRef)).configured).toBe(false)
  }, 30_000)

  it('discovers later with the saved key and headers, then registers the explicitly selected model', async () => {
    const requests: Array<{ path: string | undefined; authorization: string | undefined; header: string | string[] | undefined }> = []
    const server = createServer((request, response) => {
      requests.push({ path: request.url, authorization: request.headers.authorization,
        header: request.headers['x-model-config'] })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'synthetic-model-one' }, { id: 'synthetic-model-two' }] }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    })
    const { ctx, catalog } = await fixture()
    const saved = await catalog.save({ ...draft(),
      base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` })
    expect(requests).toEqual([])
    const models = await catalog.discover(saved)
    expect(requests).toEqual([{ path: '/v1/models', authorization: `Bearer ${draft().api_key}`,
      header: 'synthetic-header' }])
    expect(models.map((model: any) => model.id)).toEqual(['synthetic-model-one', 'synthetic-model-two'])
    expect(ctx.llm.listProviders()).toEqual([])
    const active = await catalog.save({ ...saved, model: 'synthetic-model-two', model_options: models })
    expect(active).toMatchObject({ enabled: true, model: 'synthetic-model-two', credentialConfigured: true })
    expect((await ctx.llm.listModels(saved.id)).map(model => model.id)).toEqual(models.map((model: any) => model.id))
    expect(requests).toHaveLength(1)
  }, 30_000)
})
