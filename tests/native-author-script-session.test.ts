// @ts-expect-error The browser test runtime does not publish declarations.
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthorScriptSession, type AuthorScriptDescriptor, type AuthorScriptProgram, type AuthorScriptFrame,
  type AuthorScriptStatus, type ElecKoiAuthorApi } from '@eleckoi/author-sdk'

const close: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of close.splice(0)) await stop() })

function descriptor(scope: AuthorScriptDescriptor['scope'] = 'character'): AuthorScriptDescriptor {
  return { key: JSON.stringify([scope, scope === 'global' ? '' : 'synthetic-owner', 'synthetic-script']),
    id: 'synthetic-script', name: 'Synthetic script', scope, ownerId: scope === 'global' ? '' : 'synthetic-owner',
    source: '', settings: { amount: 3 }, librarySettings: { enabled: true } }
}
function runtime(programs: AuthorScriptProgram[], scripts = programs.map(() => descriptor())) {
  const pages: any[] = [], statuses: AuthorScriptStatus[] = [], apis: ElecKoiAuthorApi[] = []
  const request = vi.fn(async () => ({ value: 1 }))
  const disposals: string[] = []
  const session = new AuthorScriptSession({ conversationId: 'synthetic-chat', scripts,
    createFrame(script) {
      const page = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }), index = pages.length
      pages.push(page)
      return { window: page.window, load: async () => async context => {
        apis[index] = context.api
        return programs[index]!(context)
      }, dispose() { disposals.push(script.key); page.window.dispatchEvent(new page.window.Event('pagehide')) } }
    },
    adapter: () => ({ request, on: () => () => {} }),
    status: value => statuses.push(value),
  })
  close.push(async () => { await session.close().catch(() => {}); for (const page of pages) page.window.close() })
  return { session, request, pages, statuses, apis, disposals }
}

describe('native author script lifecycle', () => {
  it('closes SDK calls before cleanup but retains the frame until its cleanup completes', async () => {
    const owner = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
    const node = owner.window.document.createElement('iframe'); owner.window.document.body.append(node)
    const dispose = vi.fn(() => node.remove()), sequence: string[] = []
    let finish!: () => void
    const session = new AuthorScriptSession({ conversationId: 'synthetic-chat', scripts: [descriptor()],
      createFrame: () => ({ window: node.contentWindow, load: async () => ({ api }) => async () => {
        expect(node.isConnected).toBe(true)
        await expect(api.variables.getState()).rejects.toMatchObject({ code: 'FRAME_CLOSED' })
        sequence.push('cleanup-start')
        await new Promise<void>(resolve => { finish = resolve })
        expect(node.isConnected).toBe(true); sequence.push('cleanup-end')
      }, dispose }),
      adapter: () => ({ request: async () => ({}), on: () => () => {} }), status() {},
    })
    close.push(async () => { await session.close(); owner.window.close() })
    await session.start(); const closing = session.close()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(dispose).not.toHaveBeenCalled(); finish(); await closing
    expect(sequence).toEqual(['cleanup-start', 'cleanup-end']); expect(dispose).toHaveBeenCalledTimes(1)
    expect(node.isConnected).toBe(false)
  })

  it('starts explicit programs in library order, exposes cloned settings and cleans up in reverse order', async () => {
    const events: string[] = [], scripts = [descriptor('global'), descriptor('preset'), descriptor('character')]
    const r = runtime(scripts.map(script => async context => {
      events.push(`start:${context.scope}`)
      expect(context.scriptId).toBe(script.id); expect(context.settings).toEqual({ amount: 3 })
      context.settings.amount = 99; expect(script.settings.amount).toBe(3)
      expect(await context.api.variables.getState()).toEqual({ value: 1 })
      return () => { events.push(`stop:${context.scope}`); expect(context.signal.aborted).toBe(true) }
    }), scripts)
    await r.session.start(); await r.session.close(); await r.session.close()
    expect(events).toEqual(['start:global', 'start:preset', 'start:character', 'stop:character', 'stop:preset', 'stop:global'])
    expect(r.disposals).toHaveLength(3)
    for (const page of r.pages) { expect(page.window.Mvu).toBeUndefined(); expect(page.window.TavernHelper).toBeUndefined() }
  })

  it('uses one candidate across async rules and native SDK calls without another Host save', async () => {
    const r = runtime([({ api }) => {
      api.variables.registerRule({ id: 'prepare', stage: 'before', run: async context => {
        expect(context.before).toEqual({ value: 1 }); context.state.prepared = true
      } })
      api.variables.registerRule({ id: 'derive', stage: 'after', run: async context => {
        const candidate = await api.variables.getState()
        expect(candidate).toEqual({ value: 4, prepared: true })
        await api.variables.merge({ derived: Number(candidate.value) * 2 })
        context.before.value = 999
      } })
      api.variables.registerRule({ id: 'finish', stage: 'afterSchema', run: context => { context.state.finalized = true } })
    }])
    await r.session.start()
    expect(JSON.parse(await r.session.apply('synthetic-run', 'before', '{"value":1}', '{"value":1}'))).toEqual({ value: 1, prepared: true })
    expect(JSON.parse(await r.session.apply('synthetic-run', 'after', '{"value":4,"prepared":true}', '{"value":1}'))).toEqual({ value: 4, prepared: true, derived: 8 })
    expect(JSON.parse(await r.session.apply('synthetic-run', 'afterSchema', '{"value":4,"derived":8}', '{"value":1}'))).toEqual({ value: 4, derived: 8, finalized: true })
    expect(r.request).not.toHaveBeenCalled()
    expect(await r.apis[0]!.variables.getState()).toEqual({ value: 1 }); expect(r.request).toHaveBeenCalledTimes(1)
  })

  it('keeps same script and rule ids independent across their explicit scopes', async () => {
    const scripts = [descriptor('global'), descriptor('character')]
    const r = runtime(scripts.map((_, index) => ({ api }) => {
      api.variables.registerRule({ id: 'synthetic-rule', stage: 'before', run: context => { context.state.value = Number(context.state.value) + index + 1 } })
    }), scripts)
    await r.session.start()
    expect(JSON.parse(await r.session.apply('synthetic-run', 'before', '{"value":1}', '{"value":1}')).value).toBe(4)
  })

  it('rejects duplicate registration, aborts its partial startup and preserves the visible failure', async () => {
    const r = runtime([({ api }) => {
      const rule = { id: 'synthetic-rule', stage: 'after' as const, run() {} }
      api.variables.registerRule(rule); api.variables.registerRule(rule)
    }])
    await expect(r.session.start()).rejects.toMatchObject({ code: 'RULE_ID_CONFLICT' })
    expect(r.statuses.at(-1)).toMatchObject({ status: 'error', error: expect.any(String) })
    expect(r.disposals).toHaveLength(1)
    await expect(r.apis[0]!.variables.getState()).rejects.toMatchObject({ code: 'FRAME_CLOSED' })
  })

  it('awaits startup, refuses candidates while starting and cleans up a late startup result', async () => {
    let finish!: () => void; const cleanup = vi.fn()
    const r = runtime([async () => { await new Promise<void>(resolve => { finish = resolve }); return cleanup }])
    const starting = r.session.start()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(r.session.apply('synthetic-run', 'before', '{}', '{}')).rejects.toMatchObject({ code: 'SCRIPT_NOT_READY' })
    const rejected = expect(starting).rejects.toMatchObject({ code: 'SCRIPT_CLOSED' })
    await r.session.close(); await rejected
    expect(cleanup).not.toHaveBeenCalled(); finish()
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
    expect(r.disposals).toHaveLength(1)
    expect(r.statuses.at(-1)).toMatchObject({ status: 'stopped' })
  })

  it('cancels an asynchronous rule immediately and does not reuse its candidate after unload', async () => {
    let finish!: () => void
    const r = runtime([({ api }) => { api.variables.registerRule({ id: 'wait', stage: 'before', run: async context => {
      await new Promise<void>(resolve => { finish = resolve }); context.state.value = 9
    } }) }])
    await r.session.start()
    const processing = r.session.apply('synthetic-run', 'before', '{"value":1}', '{"value":1}')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    r.session.cancel('synthetic-run')
    await expect(processing).rejects.toMatchObject({ code: 'VARIABLE_RULE_CANCELLED' })
    await r.session.close(); finish()
    await expect(r.session.apply('synthetic-run', 'after', '{}', '{}')).rejects.toMatchObject({ code: 'SCRIPT_NOT_READY' })
    expect(r.request).not.toHaveBeenCalled()
  })

  it('pins dynamic registrations across stages and allows a fresh attempt after a failed run', async () => {
    let stop!: () => void
    const r = runtime([({ api }) => { stop = api.variables.registerRule({ id: 'derive', stage: 'after', run: context => { context.state.derived = true } }) }])
    await r.session.start()
    await r.session.apply('synthetic-run', 'before', '{}', '{}'); stop()
    await expect(r.session.apply('synthetic-run', 'after', '{}', '{}')).rejects.toMatchObject({ code: 'VARIABLE_RULE_CHANGED' })
    expect(JSON.parse(await r.session.apply('synthetic-retry', 'before', '{}', '{}'))).toEqual({})
    await expect(r.session.apply('synthetic-retry', 'before', '{}', '{}')).rejects.toMatchObject({ code: 'VARIABLE_RULE_DUPLICATED' })
    await expect(r.session.apply('synthetic-retry', 'afterSchema', '{}', '{}')).rejects.toMatchObject({ code: 'VARIABLE_RULE_ORDER' })
  })

  it('updates settings without teardown, cancels only a changed candidate and rejects unrelated settings identities', async () => {
    let context!: Parameters<AuthorScriptProgram>[0], finish!: () => void, wait = true
    const cleanup = vi.fn(), r = runtime([value => {
      context = value
      value.api.variables.registerRule({ id: 'settings', stage: 'before', run: async candidate => {
        if (wait) await new Promise<void>(resolve => { finish = resolve })
        candidate.state.value = context.settings.amount
      } })
      return cleanup
    }])
    await r.session.start()
    const candidate = r.session.apply('synthetic-run', 'before', '{}', '{}')
    const failed = expect(candidate).rejects.toMatchObject({ code: 'VARIABLE_RULE_CANCELLED' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const next = { ...descriptor(), settings: { amount: 8 }, librarySettings: { shared: true } }
    r.session.updateSettings([next]); await failed
    expect(context.settings).toEqual({ amount: 8 }); expect(context.signal.aborted).toBe(false)
    expect(cleanup).not.toHaveBeenCalled(); expect(r.disposals).toHaveLength(0)
    context.settings.amount = 99; expect(context.settings.amount).toBe(8)
    expect(() => r.session.updateSettings([{ ...next, key: 'synthetic-unrelated' }])).toThrow('不属于')
    expect(() => r.session.updateSettings([next, next])).toThrow('不属于')
    expect(context.settings.amount).toBe(8)
    wait = false; finish()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(JSON.parse(await r.session.apply('synthetic-retry', 'before', '{}', '{}'))).toEqual({ value: 8 })
    r.session.updateSettings([next])
    expect(JSON.parse(await r.session.apply('synthetic-retry', 'after', '{"value":8}', '{}'))).toEqual({ value: 8 })
    expect(r.pages).toHaveLength(1)
  })

  it.each([undefined, Infinity, new Date(0), () => {}, Symbol('synthetic')])('does not silently lose non-JSON rule data: %s', async value => {
    const r = runtime([({ api }) => { api.variables.registerRule({ id: 'invalid', stage: 'before', run: context => { context.state.invalid = value } }) }])
    await r.session.start()
    await expect(r.session.apply('synthetic-run', 'before', '{}', '{}')).rejects.toMatchObject({ code: 'INVALID_RULE_STATE' })
  })

  it('runs an actual synthetic module without compatibility resources', async () => {
    const scripts = [descriptor()], page = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
    scripts[0]!.source = 'export default ({api}) => { api.variables.registerRule({id:"synthetic-rule",stage:"before",run(ctx){ctx.state.value = 3}}); }'
    const frame: AuthorScriptFrame = { window: page.window,
      load: async source => (await import(`data:text/javascript,${encodeURIComponent(source)}`)).default,
      dispose() { page.window.dispatchEvent(new page.window.Event('pagehide')) } }
    const session = new AuthorScriptSession({ conversationId: 'synthetic-chat', scripts, createFrame: () => frame,
      adapter: () => ({ request: async () => ({}), on: () => () => {} }), status() {} })
    close.push(async () => { await session.close(); page.window.close() })
    await session.start()
    expect(JSON.parse(await session.apply('synthetic-run', 'before', '{}', '{}'))).toEqual({ value: 3 })
  })

  it('reports invalid module exports and releases the frame after a failed load', async () => {
    const page = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }), dispose = vi.fn()
    const statuses: AuthorScriptStatus[] = []
    const session = new AuthorScriptSession({ conversationId: 'synthetic-chat', scripts: [descriptor()],
      createFrame: () => ({ window: page.window, load: async () => undefined as any, dispose }),
      adapter: () => ({ request: async () => ({}), on: () => () => {} }), status: status => statuses.push(status) })
    close.push(async () => { await session.close(); page.window.close() })
    await expect(session.start()).rejects.toMatchObject({ code: 'INVALID_SCRIPT_MODULE' })
    expect(dispose).toHaveBeenCalledTimes(1); expect(statuses.at(-1)).toMatchObject({ status: 'error' })
  })

  it('continues reverse cleanup after an author cleanup failure', async () => {
    const cleanups = [vi.fn(), vi.fn(() => { throw new Error('Synthetic cleanup failure') })]
    const r = runtime(cleanups.map(cleanup => () => cleanup), [descriptor('global'), descriptor('character')])
    await r.session.start()
    await expect(r.session.close()).rejects.toThrow('清理失败')
    expect(cleanups[0]).toHaveBeenCalledTimes(1); expect(cleanups[1]).toHaveBeenCalledTimes(1)
    expect(r.disposals).toHaveLength(2)
    expect(r.statuses.filter(status => status.status === 'error')).toHaveLength(1)
  })
})
