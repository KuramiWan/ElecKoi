import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/dsh-client-presets/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

interface Catalog {
  activePresetId: string
  groups: Array<{ id: string }>
  presets: Array<{ id: string }>
}

const catalog = (id: string): Catalog => ({ activePresetId: id, groups: [], presets: [{ id }] })

describe('DSH ElecKoi preset client model', () => {
  it('updates from preset events and preserves a newer command result', async () => {
    const pending: Array<(result: { ok: boolean; data: Catalog }) => void> = []
    let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
    let onEvent: ((event: unknown) => void) | undefined
    let cleanup = () => {}
    let catalogModel: {
      getSnapshot: () => { status: string; catalog: Catalog | null }
      subscribe: (listener: () => void) => () => void
      adopt: (value: Catalog) => void
    } | undefined
    const bridge = {
      request: (name: string, input: unknown) => {
        expect(name).toBe('query.agent_presets.catalog')
        expect(input).toEqual({})
        return new Promise<{ ok: boolean; data: Catalog }>(resolve => pending.push(resolve))
      },
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    expect(registration?.id).toBe('@eleckoi/dsh-client-presets')
    dshClientPlugin(registration!).apply({
      provide: (name: string, value: typeof catalogModel) => {
        expect(name).toBe('eleckoiPresets')
        catalogModel = value
      },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalogModel) throw new Error('Preset catalog was not provided')
    let changes = 0
    catalogModel.subscribe(() => { changes += 1 })
    pending[0]!({ ok: true, data: catalog('first') })
    await settle()
    expect(catalogModel.getSnapshot().catalog?.activePresetId).toBe('first')
    onEvent?.({ name: 'records.changed', payload: { module: 'personas' } })
    expect(pending).toHaveLength(1)
    onEvent?.({ name: 'records.changed', payload: { module: 'agentPresets' } })
    expect(pending).toHaveLength(2)
    catalogModel.adopt(catalog('saved'))
    pending[1]!({ ok: true, data: catalog('stale') })
    await settle()
    expect(catalogModel.getSnapshot().catalog?.activePresetId).toBe('saved')
    expect(changes).toBe(2)
    cleanup()
    expect(onEvent).toBeUndefined()
  })

  it('keeps the latest preset detail after an older read and publishes a save', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let resolveFirst: ((value: unknown) => void) | undefined
    const first = new Promise(resolve => { resolveFirst = resolve })
    let reads = 0
    let model: any
    let cleanup = () => {}
    const detail = (name: string) => ({ id: 'preset-1', name, regexRules: [] })
    const bridge = {
      request: (name: string) => {
        if (name === 'query.agent_presets.catalog') return Promise.resolve({ ok: true, data: catalog('preset-1') })
        if (name === 'query.agent_presets.read') {
          reads += 1
          return reads === 1 ? first : Promise.resolve({ ok: true, data: detail('newer') })
        }
        if (name === 'command.agent_presets.save') return Promise.resolve({ ok: true, data: detail('saved') })
        throw new Error(`Unexpected route: ${name}`)
      },
      subscribe: () => () => {}
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: unknown) => { model = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    const pending = model.read('preset-1')
    await model.read('preset-1')
    resolveFirst?.({ ok: true, data: detail('older') })
    await pending
    expect(model.getDetailSnapshot('preset-1').preset.name).toBe('newer')
    await model.save(detail('edited'), [])
    expect(model.getDetailSnapshot('preset-1').preset.name).toBe('saved')
    cleanup()
  })
})
