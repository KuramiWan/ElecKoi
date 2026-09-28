import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GenerationStatsPersistence } from '../packages/dsh-runtime/src/generationStatsPersistence'

const permissionError = () => Object.assign(new Error('file temporarily locked'), { code: 'EPERM' })

describe('generation statistics checkpoints', () => {
  it('coalesces updates and retries a transient Windows rename failure', async () => {
    const writes = []
    const warn = vi.fn()
    const store = new GenerationStatsPersistence(async (_path, data) => {
      writes.push(data)
      if (writes.length < 3) throw permissionError()
    }, warn)

    store.schedule('stats.json', '{"turns":1}')
    store.schedule('stats.json', '{"turns":2}')
    await expect(store.flush('stats.json')).resolves.toBeUndefined()
    expect(writes).toEqual(['{"turns":2}', '{"turns":2}', '{"turns":2}'])
    expect(warn).not.toHaveBeenCalled()
    await store.close()
  })

  it('keeps a failed checkpoint for the next flush without interrupting the caller', async () => {
    let available = false
    const saved = []
    const warn = vi.fn()
    const store = new GenerationStatsPersistence(async (_path, data) => {
      if (!available) throw permissionError()
      saved.push(data)
    }, warn)

    store.schedule('stats.json', '{"turns":1}')
    await expect(store.flush('stats.json')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    available = true
    await store.flush('stats.json')
    expect(saved).toEqual(['{"turns":1}'])
    await store.close()
  })

  it('replaces the checkpoint and leaves no temporary files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eleckoi-stats-'))
    const path = join(directory, 'stats.json')
    const store = new GenerationStatsPersistence()
    try {
      store.schedule(path, '{"turns":1}')
      await store.flush(path)
      store.schedule(path, '{"turns":2}')
      await store.flush(path)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ turns: 2 })
      expect(await readdir(directory)).toEqual(['stats.json'])
    } finally {
      await store.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
