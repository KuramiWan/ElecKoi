import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { apply as applyHost } from '../packages/dsh-client-display-preferences/src/index.js'

const source = readFileSync(new URL('../packages/dsh-client-display-preferences/src/client.js', import.meta.url), 'utf8')
const ok = (value: unknown) => Promise.resolve({ ok: true, value })

function clientHarness() {
  let registration: any
  let model: any
  let cleanup = () => {}
  let snapshot: {
    revision: number
    writable: boolean
    ui: Record<string, unknown>
    chatDisplay: Record<string, unknown>
  } = {
    revision: 2,
    writable: true,
    ui: { pinned_chat_ids: ['chat-a'] },
    chatDisplay: { layout: 'roleplay' }
  }
  const remote = {
    eleckoiDisplayPreferences: {
      read: vi.fn(() => ok(snapshot)),
      updateUi: vi.fn(async (ui: Record<string, unknown>, revision?: number) => {
        expect(revision).toBe(snapshot.revision)
        snapshot = { ...snapshot, revision: snapshot.revision + 1, ui }
        return { ok: true, value: snapshot }
      }),
      setChatDisplay: vi.fn(async (chatDisplay: Record<string, unknown>, revision?: number) => {
        expect(revision).toBe(snapshot.revision)
        snapshot = { ...snapshot, revision: snapshot.revision + 1, chatDisplay }
        return { ok: true, value: snapshot }
      })
    },
    $on: vi.fn(() => () => {})
  }
  runInNewContext(source, { window: { __ModuleLoader__: { load: (value: any) => { registration = value } } } })
  dshClientPlugin(registration).apply({
    remote,
    provide: (_name: string, value: any) => { model = value },
    effect: (run: () => () => void) => { cleanup = run() },
    on: () => () => {}
  })
  return { remote, model, cleanup: () => cleanup() }
}

describe('DSH display preferences', () => {
  it('reads and serializes Client writes through the DSH display preferences Remote', async () => {
    const { remote, model, cleanup } = clientHarness()
    try {
      await model.refresh()
      expect(model.getSnapshot()).toMatchObject({
        status: 'ready',
        writable: true,
        ui: { pinned_chat_ids: ['chat-a'] },
        chatDisplay: { layout: 'roleplay' }
      })

      await Promise.all([
        model.updateUi((current: Record<string, unknown>) => ({ ...current, first: true })),
        model.updateUi((current: Record<string, unknown>) => ({ ...current, second: true }))
      ])
      expect(model.getSnapshot().ui).toMatchObject({
        pinned_chat_ids: ['chat-a'], first: true, second: true
      })
      expect(remote.eleckoiDisplayPreferences.updateUi).toHaveBeenNthCalledWith(
        1, { pinned_chat_ids: ['chat-a'], first: true }, 2
      )
      expect(remote.eleckoiDisplayPreferences.updateUi).toHaveBeenNthCalledWith(
        2, { pinned_chat_ids: ['chat-a'], first: true, second: true }, 3
      )
    } finally { cleanup() }
  })

  it('adopts current DSH Settings without reading a legacy product preference store', () => {
    const data = { setDisplayPreferences: vi.fn() }
    let onUpdate: ((paths: string[][]) => void) | undefined
    const ui = { get: vi.fn(() => ({ new_character_background: 'app' })) }
    applyHost({
      settings: { configure: vi.fn(() => () => {}) },
      eleckoiProductData: data,
      fiber: {},
      on: vi.fn((_name: string, listener: (paths: string[][]) => void) => { onUpdate = listener }) ,
      effect: (run: () => unknown) => { run() }
    } as any, { ui, chatDisplay: { get: () => ({}) } })

    expect(data.setDisplayPreferences).toHaveBeenCalledWith({ new_character_background: 'app' })
    ui.get.mockReturnValue({ new_character_background: 'empty' })
    onUpdate?.([['ui']])
    expect(data.setDisplayPreferences).toHaveBeenLastCalledWith({ new_character_background: 'empty' })
  })
})
