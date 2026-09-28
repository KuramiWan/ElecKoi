import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-roleplay/src/client.js', import.meta.url), 'utf8')
const rowId = 'eleckoi-client-roleplay'

describe('ElecKoi roleplay client contribution', () => {
  it('mounts the existing chat view through a removable DSH chain entry', () => {
    let registration: any
    let unregister = false
    let entry: any
    let component: any
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } } }
    })
    expect(registration.id).toBe('@eleckoi/dsh-client-roleplay')
    const React = {
      createElement: (type: unknown, props: unknown) => ({ type, props }),
      useState: () => [null, () => {}],
      useEffect: () => {}
    }
    const plugin = registration.factory((name: string) => {
      expect(name).toBe('react')
      return React
    })
    plugin.apply({
      sessions: {},
      slots: {
        inject: (name: string, register: () => () => void) => {
          expect(name).toBe('eleckoi.roleplay')
          const dispose = register()
          dispose()
        },
        register: (options: unknown, view: unknown) => {
          entry = options
          component = view
          return () => { unregister = true }
        }
      }
    })
    const ChatView = () => null
    const owner = { component: ChatView, props: { conversationId: 'session-1' } }
    expect(entry.name).toBe('eleckoi.roleplay')
    expect(entry.children['eleckoi.roleplay.message.content']).toEqual({ kind: 'chain', scope: 'session' })
    expect(entry.children['eleckoi.roleplay.message.actions']).toEqual({ kind: 'list', scope: 'session' })
    expect(entry.children['eleckoi.roleplay.input.left']).toEqual({ kind: 'list', scope: 'session' })
    expect(entry.select(owner)).toBe(owner)
    expect(entry.select({ component: null })).toBeNull()
    expect(component({ matched: owner })).toEqual({ type: ChatView, props: {
      ...owner.props, renderRoleplaySlot: undefined, renderRoleplayMessage: undefined
    } })
    expect(unregister).toBe(true)
  })

  it('allows the user profile layer to disable the bundled row', () => {
    const patch = loadOverlayPatches('dsh', resolve('packages/dsh-client-roleplay/cordis.patch.yml'))
    expect(composeEntries([patch]).find(row => row.id === rowId)?.disabled).toBeFalsy()
    const disabled = composeEntries([patch, [{ id: rowId, disabled: true }]])
    expect(disabled.find(row => row.id === rowId)?.disabled).toBe(true)
  })

  it('renders extension seats only under the retained DSH Session scope', () => {
    let registration: any
    let component: any
    const reference = { sessionId: 'dsh-session-1' }
    const renderSlot = () => null
    const renderSlotChain = (name: string, owner: unknown, options: unknown) => ({ name, owner, options })
    const SessionProvider = () => null
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } } }
    })
    const plugin = registration.factory(() => ({
      createElement: (type: unknown, props: unknown, child: unknown) => ({ type, props, child }),
      useState: () => [reference, () => {}],
      useEffect: () => {}
    }))
    plugin.apply({ sessions: {}, slots: {
      inject: (_name: string, register: () => void) => register(),
      register: (_options: unknown, view: unknown) => { component = view }
    } })
    const ChatView = () => null
    const result = component({
      matched: { component: ChatView, props: { conversationId: 'product-chat-1', runtimeSessionId: reference.sessionId } },
      sessions: {}, SessionProvider, renderSlot, renderSlotChain
    })
    expect(result.type).toBe(SessionProvider)
    expect(result.props.session).toBe(reference)
    expect(result.child.type).toBe(ChatView)
    expect(result.child.props.renderRoleplaySlot).toBe(renderSlot)
    expect(result.child.props.renderRoleplayMessage({ productMessageId: 'm1' }, 'fallback')).toEqual({
      name: 'eleckoi.roleplay.message.content', owner: { productMessageId: 'm1' }, options: { fallback: 'fallback' }
    })
  })

  it('refreshes an unknown Session and releases its reference when the chat closes', async () => {
    let registration: any
    let component: any
    let cleanup: (() => void) | undefined
    let released = 0
    let refreshed = 0
    let selected: unknown
    const reference = { sessionId: 'dsh-session-2', ready: Promise.resolve(), release: () => { released += 1 } }
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } } }
    })
    const plugin = registration.factory(() => ({
      createElement: (type: unknown, props: unknown) => ({ type, props }),
      useState: () => [null, (value: unknown) => { selected = value }],
      useEffect: (effect: () => () => void) => { cleanup = effect() }
    }))
    const sessions = {
      list: { getSnapshot: () => ({ byId: {} }) },
      refresh: async () => { refreshed += 1 },
      retain: () => reference
    }
    plugin.apply({ sessions, slots: {
      inject: (_name: string, register: () => void) => register(),
      register: (_options: unknown, view: unknown) => { component = view }
    } })
    component({
      matched: { component: () => null, props: { runtimeSessionId: reference.sessionId } },
      sessions
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(refreshed).toBe(1)
    expect(selected).toBe(reference)
    cleanup?.()
    expect(released).toBe(1)
  })
})
