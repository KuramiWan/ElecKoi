import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-persona/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

function personaChanges() {
  const queue: Array<{ kind: 'snapshot' } | { kind: 'records'; domain: 'persona' }> = [{ kind: 'snapshot' }]
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
    emit() { queue.push({ kind: 'records', domain: 'persona' }); wake?.(); wake = undefined },
    isStopped: () => stopped
  }
}

describe('DSH ElecKoi persona model', () => {
  it('reads, saves and reconnects through generated Remote methods', async () => {
    const read = vi.fn(async () => ({ ok: true, value: profile('用户甲') }))
    const save = vi.fn(async (value: Record<string, unknown>) => ({ ok: true, value: { ...value, user_name: '用户乙' } }))
    let resetListener: (() => void) | undefined
    let cleanup = () => {}
    let registration: { factory(): { apply(ctx: unknown): void } } | undefined
    const services = new Map<string, any>()
    const changeFeed = personaChanges()

    runInNewContext(source, {
      AbortController,
      window: {
        __ModuleLoader__: { load(value: typeof registration) { registration = value } }
      }
    })
    registration!.factory().apply({
      remote: { eleckoiPersona: { read, save, changes: (signal?: AbortSignal) => changeFeed.open(signal) } },
      provide(name: string, value: unknown) { services.set(name, value) },
      effect(run: () => () => void) { cleanup = run() },
      on(name: string, listener: () => void) {
        expect(name).toBe('connection/reset')
        resetListener = listener
        return () => { resetListener = undefined }
      }
    })

    const model = services.get('eleckoiPersona')
    await settle()
    expect(model.getSnapshot()).toMatchObject({ status: 'ready', profile: { user_name: '用户甲' } })
    expect(read).toHaveBeenCalledTimes(2)
    await expect(model.save(profile('待保存'))).resolves.toMatchObject({ user_name: '用户乙' })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ user_name: '待保存' }))
    expect(model.getSnapshot()).toMatchObject({ status: 'ready', profile: { user_name: '用户乙' } })

    changeFeed.emit()
    await settle()
    expect(read).toHaveBeenCalledTimes(3)

    resetListener?.()
    await settle()
    expect(read).toHaveBeenCalledTimes(4)
    cleanup()
    expect(resetListener).toBeUndefined()
    expect(changeFeed.isStopped()).toBe(true)
  })
})

function profile(userName: string) {
  return {
    assistant_name: '测试角色',
    assistant_avatar: '',
    assistant_square: '',
    assistant_cover: '',
    opening: '',
    show_opening: false,
    user_name: userName,
    user_avatar: '',
    user_square: '',
    user_portrait: ''
  }
}
