import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-persona/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

interface Profile {
  user_name: string
  user_avatar: string
  user_square: string
  user_portrait: string
}

const profile = (name: string): Profile => ({
  user_name: name, user_avatar: '', user_square: '', user_portrait: ''
})

describe('DSH ElecKoi user profile client model', () => {
  it('refreshes on persona changes and preserves a newer save over an older read', async () => {
    const pending: Array<(result: { ok: boolean; data: Profile }) => void> = []
    let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
    let onEvent: ((event: unknown) => void) | undefined
    let cleanup = () => {}
    let model: {
      getSnapshot: () => { status: string; profile: Profile | null; error: string }
      subscribe: (listener: () => void) => () => void
      adopt: (value: Profile) => void
    } | undefined
    const bridge = {
      request: (name: string, input: unknown) => {
        expect(name).toBe('query.persona.read')
        expect(input).toEqual({})
        return new Promise<{ ok: boolean; data: Profile }>(resolve => pending.push(resolve))
      },
      subscribe: (listener: (event: unknown) => void) => {
        onEvent = listener
        return () => { onEvent = undefined }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    expect(registration?.id).toBe('@eleckoi/dsh-client-persona')
    registration!.factory().apply({
      provide: (name: string, value: typeof model) => {
        expect(name).toBe('eleckoiPersona')
        model = value
      },
      effect: (run: () => () => void) => { cleanup = run() },
      on: () => () => {}
    })
    if (!model) throw new Error('User profile model was not provided')
    let changes = 0
    model.subscribe(() => { changes += 1 })
    pending[0]!({ ok: true, data: profile('first') })
    await settle()
    expect(model.getSnapshot().profile?.user_name).toBe('first')

    onEvent?.({ name: 'records.changed', payload: { module: 'conversations' } })
    expect(pending).toHaveLength(1)
    onEvent?.({ name: 'records.changed', payload: { module: 'personas' } })
    expect(pending).toHaveLength(2)
    model.adopt(profile('saved'))
    pending[1]!({ ok: true, data: profile('stale') })
    await settle()
    expect(model.getSnapshot().profile?.user_name).toBe('saved')
    expect(changes).toBe(2)
    cleanup()
    expect(onEvent).toBeUndefined()
  })
})
