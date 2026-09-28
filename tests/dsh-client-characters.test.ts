import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/dsh-client-characters/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

interface Collection {
  active_character_id: string
  groups: string[]
  items: Array<{ id: string }>
}

const collection = (id: string): Collection => ({ active_character_id: id, groups: [], items: [{ id }] })

describe('DSH ElecKoi character client model', () => {
  it('publishes character changes and keeps a command result ahead of an older read', async () => {
    const pending: Array<(result: { ok: boolean; data: Collection }) => void> = []
    let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
    let onEvent: ((event: unknown) => void) | undefined
    let stopped = false
    let cleanup = () => {}
    let catalog: {
      getSnapshot: () => { status: string; collection: Collection }
      subscribe: (listener: () => void) => () => void
      refresh: () => Promise<Collection>
      adopt: (value: Collection) => void
    } | undefined
    const bridge = {
      request: (name: string, input: unknown) => {
        expect(name).toBe('query.characters.list')
        expect(input).toEqual({})
        return new Promise<{ ok: boolean; data: Collection }>(resolve => pending.push(resolve))
      },
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { stopped = true; onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    expect(registration?.id).toBe('@eleckoi/dsh-client-characters')
    dshClientPlugin(registration!).apply({
      provide: (name: string, value: typeof catalog) => {
        expect(name).toBe('eleckoiCharacters')
        catalog = value
      },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!catalog) throw new Error('Character catalog was not provided')
    let changes = 0
    catalog.subscribe(() => { changes += 1 })
    expect(pending).toHaveLength(1)
    pending[0]!({ ok: true, data: { ...collection('first'), active_character_id: '' } })
    await settle()
    expect(catalog.getSnapshot().collection.active_character_id).toBe('first')

    onEvent?.({ name: 'records.changed', payload: { module: 'conversations' } })
    expect(pending).toHaveLength(1)
    onEvent?.({ name: 'records.changed', payload: { module: 'personas' } })
    expect(pending).toHaveLength(2)
    catalog.adopt(collection('saved'))
    pending[1]!({ ok: true, data: collection('stale') })
    await settle()
    expect(catalog.getSnapshot().collection.active_character_id).toBe('saved')
    expect(changes).toBe(2)
    cleanup()
    expect(stopped).toBe(true)
  })
})
