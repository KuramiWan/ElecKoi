import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-creator-studio/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

function projectChanges() {
  const queue: Array<{ kind: 'snapshot' } | { kind: 'records'; domain: 'creatorProjects' }> = [{ kind: 'snapshot' }]
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
    emit() { queue.push({ kind: 'records', domain: 'creatorProjects' }); wake?.(); wake = undefined },
    isStopped: () => stopped
  }
}

describe('DSH ElecKoi creator studio projects', () => {
  it('lists, mutates and reconnects through generated Remote methods', async () => {
    const list = vi.fn(async () => ({ ok: true, value: collection('project-1') }))
    const create = vi.fn(async () => ({ ok: true, value: collection('project-2') }))
    const remove = vi.fn(async () => ({ ok: true, value: { items: [] } }))
    const pick = vi.fn(async (_signal: AbortSignal) => ({ ok: true, value: 'C:\\Projects' as string | null }))
    let resetListener: (() => void) | undefined
    let cleanup = () => {}
    let registration: { factory(): { apply(ctx: unknown): void } } | undefined
    const services = new Map<string, any>()
    const changeFeed = projectChanges()

    runInNewContext(source, {
      AbortController, AbortSignal,
      window: {
        __ModuleLoader__: { load(value: typeof registration) { registration = value } }
      }
    })
    registration!.factory().apply({
      remote: {
        eleckoiCreatorStudio: {
          list,
          create,
          delete: remove,
          changes: (signal?: AbortSignal) => changeFeed.open(signal)
        },
        directoryPicker: { pick }
      },
      provide(name: string, value: unknown) { services.set(name, value) },
      effect(run: () => () => void) { cleanup = run() },
      on(name: string, listener: () => void) {
        expect(name).toBe('connection/reset')
        resetListener = listener
        return () => { resetListener = undefined }
      }
    })

    const projects = services.get('eleckoiCreatorStudio')
    await settle()
    expect(projects.getSnapshot()).toMatchObject({
      status: 'ready', collection: { items: [{ id: 'project-1' }] }
    })
    expect(list).toHaveBeenCalledTimes(2)
    await expect(projects.create({ name: '项目', mode: 'blank', parentDirectory: 'C:\\Projects' }))
      .resolves.toMatchObject({ items: [{ id: 'project-2' }] })
    expect(projects.getSnapshot().collection.items[0].id).toBe('project-2')
    await expect(projects.delete('project-2')).resolves.toEqual({ items: [] })
    expect(projects.getSnapshot().collection.items).toEqual([])

    await expect(projects.selectDirectory()).resolves.toBe('C:\\Projects')
    pick.mockResolvedValueOnce({ ok: true, value: null })
    await expect(projects.selectDirectory()).resolves.toBeNull()
    const canceled = new AbortController()
    canceled.abort()
    await expect(projects.selectDirectory(canceled.signal)).rejects.toThrow()
    expect(pick).toHaveBeenCalledTimes(2)

    resetListener?.()
    await settle()
    expect(list).toHaveBeenCalledTimes(3)
    changeFeed.emit()
    await settle()
    expect(list).toHaveBeenCalledTimes(4)
    let pendingSignal: AbortSignal | undefined
    pick.mockImplementationOnce(async signal => {
      pendingSignal = signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const pending = projects.selectDirectory()
    cleanup()
    await expect(pending).rejects.toThrow()
    expect(pendingSignal?.aborted).toBe(true)
    expect(resetListener).toBeUndefined()
    expect(changeFeed.isStopped()).toBe(true)
  })
})

function collection(id: string) {
  return {
    items: [{
      id,
      name: '测试项目',
      mode: 'blank',
      rootPath: `C:\\Projects\\${id}`,
      sourceCharacterId: '',
      coverImage: '',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    }]
  }
}
