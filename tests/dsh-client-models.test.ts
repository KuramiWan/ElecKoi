import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/dsh-client-models/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('DSH ElecKoi model catalog', () => {
  it('rejects stale reads after a local save and refreshes after connection reset', async () => {
    let registration: { factory: () => { apply: (ctx: unknown) => void } } | undefined
    let resolveFirst: ((value: unknown) => void) | undefined
    const first = new Promise(resolve => { resolveFirst = resolve })
    let reads = 0
    const listeners = new Set<(event: unknown) => void>()
    let onReset: (() => void) | undefined
    let cleanup = () => {}
    let catalog: any
    const bridge = {
      request: (name: string) => {
        expect(name).toBe('query.models.list')
        reads += 1
        return reads === 1 ? first : Promise.resolve({ ok: true, data: [
          { id: `model-${reads}`, provider: 'custom', model: 'example' }
        ] })
      },
      subscribe: (listener: (event: unknown) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    dshClientPlugin(registration!).apply({
      provide: (_name: string, value: unknown) => { catalog = value },
      effect: (run: () => () => void) => { cleanup = run() },
      on: (_name: string, listener: () => void) => { onReset = listener; return () => {} }
    })
    catalog.adopt([{ id: 'saved', provider: 'custom', model: 'example' }])
    resolveFirst?.({ ok: true, data: [{ id: 'stale', provider: 'custom', model: 'example' }] })
    await settle()
    expect(catalog.getSnapshot().configs[0].id).toBe('saved')

    for (const listener of listeners) listener({ name: 'records.changed', payload: { module: 'models' } })
    await settle()
    expect(catalog.getSnapshot().configs[0].id).toBe('model-2')
    onReset?.()
    await settle()
    expect(catalog.getSnapshot().configs[0].id).toBe('model-3')
    cleanup()
    expect(listeners.size).toBe(0)
  })
})
