import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'

const source = readFileSync(new URL('../packages/dsh-client-characters/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

interface Collection {
  active_character_id: string
  groups: string[]
  items: Array<{ id: string }>
}

const collection = (id: string): Collection => ({ active_character_id: id, groups: [], items: [{ id }] })

function recordChanges() {
  const queue: Array<{ kind: 'snapshot' } | { kind: 'records'; domain: 'characters' }> = [{ kind: 'snapshot' }]
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
            if (queue.length) yield queue.shift()!
            else await new Promise<void>(resolve => { wake = resolve })
          }
        } finally {
          signal?.removeEventListener('abort', stop)
          stop()
        }
      })()
    },
    emit() { queue.push({ kind: 'records', domain: 'characters' }); wake?.(); wake = undefined },
    isStopped: () => stopped
  }
}

describe('DSH ElecKoi character client model', () => {
  it('uses the generated Character Remote and keeps a mutation ahead of an older read', async () => {
    const pending: Array<(result: { ok: true; value: Collection }) => void> = []
    let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
    let cleanup = () => {}
    let catalog: {
      getSnapshot: () => { status: string; collection: Collection }
      subscribe: (listener: () => void) => () => void
      refresh: () => Promise<Collection>
      select: (id: string) => Promise<Collection>
    } | undefined
    const remote = {
      eleckoiCharacters: {
        changes: (signal?: AbortSignal) => changeFeed.open(signal),
        list: vi.fn(() => new Promise<{ ok: true; value: Collection }>(resolve => pending.push(resolve))),
        select: vi.fn(async (id: string) => ({ ok: true as const, value: collection(id) }))
      }
    }
    const changeFeed = recordChanges()
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } },
      document: {}, URL, Blob, Uint8Array, atob, setTimeout
    })
    expect(registration?.id).toBe('@eleckoi/dsh-client-characters')
    dshClientPlugin(registration!).apply({
      remote,
      provide: (name: string, value: typeof catalog) => {
        expect(name).toBe('eleckoiCharacters')
        catalog = value
      },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {},
      slots: { inject: () => {}, register: () => () => {} }
    })
    if (!catalog) throw new Error('Character catalog was not provided')
    let notifications = 0
    catalog.subscribe(() => { notifications += 1 })
    await settle()
    expect(remote.eleckoiCharacters.list).toHaveBeenCalledTimes(2)

    await catalog.select('saved')
    pending[0]!({ ok: true, value: collection('stale') })
    pending[1]!({ ok: true, value: collection('stale') })
    await settle()

    expect(remote.eleckoiCharacters.select).toHaveBeenCalledWith('saved')
    expect(catalog.getSnapshot().collection.active_character_id).toBe('saved')
    expect(notifications).toBe(1)
    cleanup()
    expect(changeFeed.isStopped()).toBe(true)
  })
})
