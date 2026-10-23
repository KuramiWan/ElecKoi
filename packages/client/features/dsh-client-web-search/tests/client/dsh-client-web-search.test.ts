import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from '../../../../../../tests/helpers/dshClientPlugin'

const source = readFileSync(new URL('../../src/client.js', import.meta.url), 'utf8')
const ok = (value: unknown) => Promise.resolve({ ok: true, value })

function harness() {
  let registration: any
  let model: any
  let cleanup = () => {}
  const remote = {
    eleckoiWebSearch: {
      selection: vi.fn(() => ok('tavily')),
      fetchSelection: vi.fn(() => ok('http')),
      selectFetch: vi.fn(() => ok('deepseek_api')),
      testDeepSeek: vi.fn(() => ok({ ok: true, provider: 'deepseek_api', search: true, fetch: true })),
      select: vi.fn(() => ok('provider_native')),
      testTavily: vi.fn(() => ok({ ok: true, used: 0, limit: 100, plan: 'Test' }))
    },
    settings: {
      describe: vi.fn(() => ok({ writable: true, namespaces: [{
        ns: 'web-search-tavily', revision: 4, value: { apiKeyEnv: 'CUSTOM_SEARCH_KEY', maxResults: 8 }
      }, { ns: 'eleckoi-web-deepseek', revision: 7, value: { apiKeyEnv: 'DEEPSEEK_WEB_API_KEY', count: 10, needContent: false } }] })),
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
  it('keeps Search, Fetch and their credentials independent and saves official count/body settings', async () => {
    const { remote, model, cleanup } = harness()
    try {
      await model.refresh()
      await model.update({ mode: 'deepseek_api', fetchMode: 'deepseek_api', deepseekCount: 50, needContent: true })
      expect(remote.eleckoiWebSearch.select).toHaveBeenCalledWith('deepseek_api')
      expect(remote.eleckoiWebSearch.selectFetch).toHaveBeenCalledWith('deepseek_api')
      expect(remote.settings.mutate).toHaveBeenCalledWith('eleckoi-web-deepseek', [
        { op: 'set', path: ['count'], value: 50 }, { op: 'set', path: ['needContent'], value: true }
      ], 7)
      await model.saveAndTest('synthetic-deepseek', 'deepseek_api')
      expect(remote.eleckoiWebSearch.testDeepSeek).toHaveBeenCalledWith('synthetic-deepseek')
      expect(remote.credentials.set).toHaveBeenCalledWith('DEEPSEEK_WEB_API_KEY', 'synthetic-deepseek')
      await model.removeKey('deepseek_api')
      expect(remote.credentials.unset).toHaveBeenCalledWith('DEEPSEEK_WEB_API_KEY')
    } finally { cleanup() }
  })
  it('uses the configured credential reference and revision without reading credential contents', async () => {
    const { remote, model, cleanup } = harness()
    try {
      await model.refresh()
      expect(model.getSnapshot()).toMatchObject({ mode: 'tavily', maxResults: 8, apiKeyConfigured: true })
      expect(remote.credentials.describe).toHaveBeenCalledWith(['CUSTOM_SEARCH_KEY', 'DEEPSEEK_WEB_API_KEY'])
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
      remote.eleckoiWebSearch.testTavily.mockResolvedValueOnce({ ok: false, error: { isDSHRemoteError: true, code: 'gateway/internal', message: 'invalid credential' } } as any)
      await expect(model.saveAndTest('invalid')).rejects.toThrow('invalid credential')
      expect(remote.credentials.set).not.toHaveBeenCalled()
    } finally { cleanup() }
  })
})
