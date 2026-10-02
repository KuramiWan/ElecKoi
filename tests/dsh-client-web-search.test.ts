import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/dsh-client-web-search/src/client.js', import.meta.url), 'utf8')
const ok = (value: unknown) => Promise.resolve({ ok: true, value })

function harness() {
  let registration: any
  let model: any
  let cleanup = () => {}
  const remote = {
    eleckoiWebSearch: {
      selection: vi.fn(() => ok('tavily')),
      select: vi.fn(() => ok('provider_native')),
      testTavily: vi.fn(() => ok({ ok: true, used: 0, limit: 100, plan: 'Test' }))
    },
    settings: {
      describe: vi.fn(() => ok({ writable: true, namespaces: [{
        ns: 'web-search-tavily', revision: 4, value: { apiKeyEnv: 'CUSTOM_SEARCH_KEY', maxResults: 8 }
      }] })),
      mutate: vi.fn(() => ok(undefined))
    },
    credentials: {
      describe: vi.fn(() => ok({ CUSTOM_SEARCH_KEY: { configured: true, writable: true } })),
      set: vi.fn(() => ok(undefined)),
      unset: vi.fn(() => ok(undefined))
    },
    $on: vi.fn(() => () => {})
  }
  runInNewContext(source, { window: { __ModuleLoader__: { load: (value: any) => { registration = value } } } })
  dshClientPlugin(registration).apply({
    remote, provide: (_name: string, value: any) => { model = value },
    effect: (run: () => () => void) => { cleanup = run() }, on: () => () => {}
  })
  return { remote, model, cleanup: () => cleanup() }
}

describe('DSH web search Client model', () => {
  it('uses the configured credential reference and revision without reading credential contents', async () => {
    const { remote, model, cleanup } = harness()
    try {
      await model.refresh()
      expect(model.getSnapshot()).toMatchObject({ mode: 'tavily', maxResults: 8, apiKeyConfigured: true })
      expect(remote.credentials.describe).toHaveBeenCalledWith(['CUSTOM_SEARCH_KEY'])
      await model.saveAndTest('synthetic-key')
      expect(remote.credentials.set).toHaveBeenCalledWith('CUSTOM_SEARCH_KEY', 'synthetic-key')
      await model.update({ maxResults: 3 })
      expect(remote.settings.mutate).toHaveBeenCalledWith('web-search-tavily', [{
        op: 'set', path: ['maxResults'], value: 3
      }], 4)
      await model.removeKey()
      expect(remote.credentials.unset).toHaveBeenCalledWith('CUSTOM_SEARCH_KEY')
    } finally { cleanup() }
  })

  it('does not save a credential when its connection test fails', async () => {
    const { remote, model, cleanup } = harness()
    try {
      await model.refresh()
      remote.eleckoiWebSearch.testTavily.mockResolvedValueOnce({ ok: false, error: { message: 'invalid credential' } } as any)
      await expect(model.saveAndTest('invalid')).rejects.toThrow('invalid credential')
      expect(remote.credentials.set).not.toHaveBeenCalled()
    } finally { cleanup() }
  })
})
