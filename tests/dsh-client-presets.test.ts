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

function presetChanges() {
  const queue: Array<{ kind: 'snapshot' } | { kind: 'configuration'; domain: 'agentPresets' }> = [{ kind: 'snapshot' }]
  let wake: (() => void) | undefined
  let stopped = false
  return {
    open(signal?: AbortSignal): AsyncIterable<(typeof queue)[number]> {
      const stop = () => { stopped = true; wake?.(); wake = undefined }
      if (signal?.aborted) stop()
      else signal?.addEventListener('abort', stop, { once: true })
      return (async function* () {
        try {
          while (!stopped) {
            if (queue.length > 0) yield queue.shift()!
            else await new Promise<void>(resolve => { wake = resolve })
          }
        } finally {
          signal?.removeEventListener('abort', stop)
          stop()
        }
      })()
    },
    emit() { queue.push({ kind: 'configuration', domain: 'agentPresets' }); wake?.(); wake = undefined },
    isStopped: () => stopped
  }
}

describe('DSH ElecKoi preset client model', () => {
  it('preserves a newer catalog while an older Remote refresh is pending', async () => {
    const pending: Array<(result: { ok: boolean; value: Catalog }) => void> = []
    let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let catalogModel: {
      getSnapshot: () => { status: string; catalog: Catalog | null }
      subscribe: (listener: () => void) => () => void
      adopt: (value: Catalog) => void
      refresh: () => Promise<Catalog>
    } | undefined
    const remote = {
      catalog: () => new Promise<{ ok: boolean; value: Catalog }>(resolve => pending.push(resolve))
    }
    const changeFeed = presetChanges()
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    expect(registration?.id).toBe('@eleckoi/dsh-client-presets')
    dshClientPlugin(registration!).apply({
      remote: {
        eleckoiAgentPresets: remote,
        eleckoiCharacterConfiguration: { changes: (signal?: AbortSignal) => changeFeed.open(signal) }
      },
      provide: (name: string, value: typeof catalogModel) => {
        expect(name).toBe('eleckoiPresets')
        catalogModel = value
      },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalogModel) throw new Error('Preset catalog was not provided')
    await settle()
    let changes = 0
    catalogModel.subscribe(() => { changes += 1 })
    pending[0]!({ ok: true, value: catalog('first') })
    await settle()
    expect(catalogModel.getSnapshot().catalog?.activePresetId).toBe('first')
    void catalogModel.refresh()
    expect(pending).toHaveLength(2)
    catalogModel.adopt(catalog('saved'))
    pending[1]!({ ok: true, value: catalog('stale') })
    await settle()
    expect(catalogModel.getSnapshot().catalog?.activePresetId).toBe('saved')
    expect(changes).toBe(2)
    cleanup()
    expect(changeFeed.isStopped()).toBe(true)
  })

  it('keeps the latest preset detail after an older read and publishes a save', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let resolveFirst: ((value: unknown) => void) | undefined
    const first = new Promise(resolve => { resolveFirst = resolve })
    let reads = 0
    let model: any
    let cleanup = () => {}
    const detail = (name: string) => ({ id: 'preset-1', name, regexRules: [] })
    const remote = {
      catalog: () => Promise.resolve({ ok: true, value: catalog('preset-1') }),
      read: () => {
          reads += 1
          return reads === 1 ? first : Promise.resolve({ ok: true, value: detail('newer') })
      },
      save: () => Promise.resolve({ ok: true, value: detail('saved') })
    }
    const changeFeed = presetChanges()
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      remote: {
        eleckoiAgentPresets: remote,
        eleckoiCharacterConfiguration: { changes: (signal?: AbortSignal) => changeFeed.open(signal) }
      },
      provide: (_name: string, value: unknown) => { model = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    await settle()
    const pending = model.read('preset-1')
    await model.read('preset-1')
    resolveFirst?.({ ok: true, value: detail('older') })
    await pending
    expect(model.getDetailSnapshot('preset-1').preset.name).toBe('newer')
    await model.save(detail('edited'), [])
    expect(model.getDetailSnapshot('preset-1').preset.name).toBe('saved')
    cleanup()
    expect(changeFeed.isStopped()).toBe(true)
  })
})
