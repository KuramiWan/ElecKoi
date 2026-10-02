import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/dsh-client-models/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('DSH ElecKoi model catalog', () => {
  it('saves profiles and product parameters through settings while keeping secrets in credentials', async () => {
    let registration: any
    let catalog: any
    let cleanup = () => {}
    const rows: any[] = [
      { ns: 'llm-pi-ai', value: { providers: {} }, revision: 0 },
      { ns: 'eleckoi-client-models', value: { entries: {} }, revision: 0 },
    ]
    const keys = new Map<string, string>()
    const remote = {
      settings: {
        describe: async () => ({ ok: true, value: { namespaces: rows } }),
        mutate: vi.fn(async (ns, ops, revision) => {
          const row = rows.find(row => row.ns === ns)
          expect(revision).toBe(row.revision)
          for (const op of ops) {
            const parent = op.path.slice(0, -1).reduce((object: any, key: string) => object[key] ||= {}, row.value)
            if (op.op === 'unset') delete parent[op.path.at(-1)]
            else parent[op.path.at(-1)] = op.value
          }
          row.revision += 1
          return { ok: true, value: row }
        }),
      },
      llm: {
        listConfigurableProviders: async () => ({ ok: true, value: [{ provider: 'deepseek-account', displayName: 'Account', settingsNs: 'llm-deepseek-account', settingsPath: [] },
          ...(rows.some(row => row.ns === 'llm-deepseek') ? [{ provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }] : []),
          ...Object.keys(rows[0].value.providers).map(provider => ({
          provider, displayName: provider, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider],
        }))] }),
      },
      eleckoiModels: { discoverModels: vi.fn(async () => ({ ok: true, value: [{ id: 'example-model' }] })),
        revealApiKey: vi.fn(async () => ({ ok: true, value: 'synthetic-stored-value' })) },
      credentials: {
        describe: async (refs: string[]) => ({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: keys.has(ref) }])) }),
        set: vi.fn(async (ref, value) => { keys.set(ref, value); return { ok: true } }),
        unset: vi.fn(async ref => { keys.delete(ref); return { ok: true } }),
      },
      session: { modelCatalog: async () => ({ ok: true, value: {
        groups: [{ id: 'deepseek-account', name: 'Account', models: [] }, ...Object.keys(rows[0].value.providers).map(id => ({ id, name: id, models: [] }))],
      } }) },
    }
    runInNewContext(source, { window: { crypto: { randomUUID: () => '00000000-1111-2222-3333-444444444444' },
      __ModuleLoader__: { load: (item: any) => { registration = item } } } })
    dshClientPlugin(registration).apply({ remote,
      provide: (_name: string, value: unknown) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() }, on: () => () => {},
    })
    await settle()
    expect(catalog.getSnapshot().configs).toEqual([])
    const draft = { id: 'config-example', provider: 'custom', name: 'Example', model: 'example-model',
      api_format: 'chat_completions', base_url: 'https://models.example/v1', api_key: 'synthetic-probe-value',
      model_options: [{ id: 'example-model', contextWindowTokens: 65536, temperature: 0.6, topP: 0.96, autoCompactTokenLimit: 30000 }],
    }
    const saved = await catalog.save(draft)
    expect(saved).toMatchObject({ id: draft.id, api_key: '', credentialConfigured: true, model: draft.model })
    await expect(catalog.revealApiKey(draft.id)).resolves.toBe('synthetic-stored-value');
    expect(remote.eleckoiModels.revealApiKey).toHaveBeenCalledExactlyOnceWith(draft.id);
    expect(JSON.stringify(catalog.getSnapshot())).not.toContain('synthetic-stored-value');
    expect(saved.model_options[0]).toMatchObject({ temperature: 0.6, topP: 0.96, autoCompactTokenLimit: 30000, contextWindowTokens: 65536 })
    expect(rows[0].value.providers[draft.id]).toMatchObject({ api: 'openai-completions', apiKeyEnv: 'CONFIG_EXAMPLE_API_KEY',
      models: [{ id: 'example-model', contextWindow: 65536 }] })
    expect(JSON.stringify(rows)).not.toContain(draft.api_key)
    expect(remote.credentials.set).toHaveBeenCalledExactlyOnceWith('CONFIG_EXAMPLE_API_KEY', draft.api_key)
    await catalog.save({ ...saved, api_key: '', name: 'Renamed' })
    expect(remote.credentials.set).toHaveBeenCalledTimes(1)
    await catalog.save({ ...saved, api_key: '', clearCredential: true })
    expect(remote.credentials.unset).toHaveBeenCalledExactlyOnceWith('CONFIG_EXAMPLE_API_KEY')
    await catalog.save(draft)
    await catalog.discover(saved)
    expect(remote.eleckoiModels.discoverModels).toHaveBeenCalledWith(expect.objectContaining({ configId: draft.id, api: 'openai-completions' }))
    const discovered = await catalog.discover({ ...saved, model_options: [{ ...saved.model_options[0], topP: 0.99 }] })
    expect(discovered[0]).toMatchObject({ topP: 0.99, temperature: 0.6, contextWindowTokens: 65536 })
    const cleared = await catalog.save({ ...saved, api_key: '', model: '', model_options: [], clearConfiguration: true })
    expect(cleared).toMatchObject({ id: draft.id, credentialConfigured: false, model_options: [] })
    expect(catalog.getSnapshot().configs).toEqual([])
    expect(rows[0].value.providers).toEqual({})
    expect(rows[1].value.entries).toEqual({})
    await catalog.save(draft)
    await catalog.deleteConfig(draft.id)
    expect(rows[0].value.providers).toEqual({})
    expect(rows[1].value.entries).toEqual({})
    expect(remote.credentials.unset).toHaveBeenCalledTimes(3)
    const dedicated = { ...saved, id: 'deepseek-official', provider: 'deepseek', credentialRef: 'CONFIRMED_KEY',
      api_format: 'deepseek_messages', model_options: [{ id: 'example-model', reasoningEfforts: { off: null, high: 'high', max: 'max' }, reasoningEffort: 'high', topP: 0.96 }] }
    catalog.adopt([dedicated])
    const switched = await catalog.save({ ...dedicated, api_format: 'responses' })
    expect(switched.id).not.toBe('deepseek-official')
    expect(switched.credentialRef).toBe('CONFIRMED_KEY')
    expect(switched.model_options[0]).toMatchObject({ reasoningEfforts: { off: null, high: 'high', max: 'max' }, reasoningEffort: 'high', topP: 0.96 })
    expect(rows[0].value.providers[switched.id]).toMatchObject({ api: 'openai-responses', apiKeyEnv: 'CONFIRMED_KEY' })
    rows.push({ ns: 'llm-deepseek', value: { baseURL: 'https://models.example/anthropic', models: [{ id: 'example-model' }] }, revision: 0 })
    rows[1].value.entries['deepseek-official'] = { provider: 'deepseek', model: 'example-model', credentialRef: 'CONFIRMED_KEY' }
    keys.set('CONFIRMED_KEY', 'synthetic-shared-value')
    await catalog.refresh()
    expect(catalog.getSnapshot().configs.some((config: any) => config.id === 'deepseek-official')).toBe(true)
    await catalog.deleteConfig('deepseek-official')
    expect(catalog.getSnapshot().configs.some((config: any) => config.id === 'deepseek-official')).toBe(false)
    expect(catalog.getSnapshot().configs.find((config: any) => config.id === switched.id).credentialConfigured).toBe(true)
    expect(keys.get('CONFIRMED_KEY')).toBe('synthetic-shared-value')
    expect(rows[2].value).toEqual({})
    cleanup()
  })
  it('rejects stale DSH catalog reads after adoption and refreshes after connection reset', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let resolveFirst: ((value: unknown) => void) | undefined
    const first = new Promise(resolve => { resolveFirst = resolve })
    let reads = 0
    let onReset: (() => void) | undefined
    let cleanup = () => {}
    let catalog: any
    const remote = {
      session: { modelCatalog: () => {
        reads += 1
        return reads === 1 ? first : Promise.resolve({ ok: true, value: catalogValue(reads) })
      } }
    }
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      remote,
      provide: (_name: string, value: unknown) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: (_name: string, listener: () => void) => { onReset = listener; return () => {} }
    })
    catalog.adopt([{ id: 'saved', provider: 'custom', model: 'example' }])
    resolveFirst?.({ ok: true, value: catalogValue(1) })
    await settle()
    expect(catalog.getSnapshot().configs[0].id).toBe('saved')

    onReset?.()
    await settle()
    expect(catalog.getSnapshot().configs[0].id).toBe('provider-2')
    expect(catalog.getSnapshot().configs[0].model_options[0]).toMatchObject({
      id: 'example',
      supportsImageInput: true,
      contextWindowTokens: 131_072,
      maxOutputTokens: 8192
    })
    cleanup()
  })
})

function catalogValue(index: number) {
  return {
    default: { provider: `provider-${index}`, model: 'example' },
    routableProviders: [`provider-${index}`],
    groups: [{
      id: `provider-${index}`,
      name: `Provider ${index}`,
      models: [{
        id: 'example',
        name: 'Example',
        inputModalities: ['text', 'image'],
        contextWindow: 131_072,
        defaultMaxTokens: 8192
      }]
    }],
    failures: []
  }
}
