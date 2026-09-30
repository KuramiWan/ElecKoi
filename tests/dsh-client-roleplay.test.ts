import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-roleplay/src/client.js', import.meta.url), 'utf8')
const rowId = 'eleckoi-client-roleplay'
const OfficialMarkdownText = 'OfficialMarkdownText'

function clientRequire(React: unknown) {
  return (name: string) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: OfficialMarkdownText }
    throw new Error(`Unexpected client module: ${name}`)
  }
}

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
      useEffect: () => {},
      useCallback: (callback: unknown) => callback
    }
    const plugin = registration.factory(clientRequire(React))
    plugin.apply({
      sessions: {},
      slots: {
        inject: (name: string, register: () => () => void) => {
          if (name !== 'eleckoi.roleplay') return
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
    expect(entry.children['eleckoi.roleplay.trajectory.images']).toEqual({ kind: 'single', scope: 'session' })
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
    const React = {
      createElement: (type: unknown, props: unknown, child: unknown) => ({ type, props, child }),
      useState: () => [reference, () => {}],
      useEffect: () => {},
      useCallback: (callback: unknown) => callback
    }
    const plugin = registration.factory(clientRequire(React))
    plugin.apply({ sessions: {}, slots: {
      inject: (name: string, register: () => void) => {
        if (name === 'eleckoi.roleplay') register()
      },
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
    const messageOwner = { productMessageId: 'm1', content: '流式正文', streaming: true }
    const rendered = result.child.props.renderRoleplayMessage(messageOwner, 'unused fallback')
    expect(rendered.name).toBe('eleckoi.roleplay.message.content')
    expect(rendered.owner).toEqual(messageOwner)
    expect(rendered.options.fallback.type.name).toBe('OfficialMarkdownMessage')
    const officialWrapper = rendered.options.fallback.type(rendered.options.fallback.props)
    expect(officialWrapper.type).toBe('div')
    expect(officialWrapper.props.className).toBe('eleckoi-dsh-markdown')
    expect(officialWrapper.child.type).toBe(OfficialMarkdownText)
    expect(officialWrapper.child.props).toMatchObject({ text: '流式正文', streaming: true })
    expect(officialWrapper.child.props.labels.code.copyLabel).toBe('复制')
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
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } } },
      setTimeout,
      clearTimeout
    })
    const React = {
      createElement: (type: unknown, props: unknown) => ({ type, props }),
      useState: () => [null, (value: unknown) => { selected = value }],
      useEffect: (effect: () => () => void) => { cleanup = effect() },
      useCallback: (callback: unknown) => callback
    }
    const plugin = registration.factory(clientRequire(React))
    const sessions = {
      list: { getSnapshot: () => ({ byId: {} }) },
      refresh: async () => { refreshed += 1 },
      retain: () => reference
    }
    plugin.apply({ sessions, slots: {
      inject: (name: string, register: () => void) => {
        if (name === 'eleckoi.roleplay') register()
      },
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

  it('retries a failed initial Session binding without leaving the chat page', async () => {
    let registration: any
    let component: any
    let cleanup: (() => void) | undefined
    let selected: any
    let retained = 0
    let released = 0
    const timers = new Map<number, () => void>()
    let nextTimerId = 0
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } } },
      setTimeout: (callback: () => void) => { const id = ++nextTimerId; timers.set(id, callback); return id },
      clearTimeout: (id: number) => { timers.delete(id) }
    })
    const React = {
      createElement: (type: unknown, props: unknown) => ({ type, props }),
      useState: () => [null, (value: unknown) => { selected = value }],
      useEffect: (effect: () => () => void) => { cleanup = effect() },
      useCallback: (callback: unknown) => callback
    }
    const plugin = registration.factory(clientRequire(React))
    const readyReference = { sessionId: 'session-retry', ready: Promise.resolve(), release: () => { released += 1 } }
    const sessions = {
      list: { getSnapshot: () => ({ byId: { 'session-retry': {} } }) },
      retain: () => {
        retained += 1
        return retained === 1
          ? { sessionId: 'session-retry', ready: Promise.reject(new Error('not ready')), release: () => { released += 1 } }
          : readyReference
      }
    }
    plugin.apply({ sessions, slots: {
      inject: (name: string, register: () => void) => {
        if (name === 'eleckoi.roleplay') register()
      },
      register: (_options: unknown, view: unknown) => { component = view }
    } })
    component({
      matched: { component: () => null, props: { runtimeSessionId: 'session-retry' } },
      sessions
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(retained).toBe(1)
    expect(selected).toBeNull()
    expect(timers.size).toBe(1)
    const retryEntry = [...timers.entries()][0]
    if (!retryEntry) throw new Error('Expected a Session retry timer')
    timers.delete(retryEntry[0])
    retryEntry[1]()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(retained).toBe(2)
    expect(selected).toBe(readyReference)
    cleanup?.()
    expect(released).toBe(2)
  })

  it('projects live DSH composer contributions into the retained roleplay seats', async () => {
    let registration: any
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } } }
    })
    const React = {
      createElement: (type: unknown, props: unknown) => ({ type, props }),
      useState: () => [null, () => {}], useEffect: () => {},
      useCallback: (callback: unknown) => callback
    }
    const plugin = registration.factory(clientRequire(React))
    const slots: any = new SlotCore()
    const injectors: Array<() => void> = []
    const clientSlots = Object.assign(slots, {
      inject(name: string, register: () => () => void) {
        let release: (() => void) | undefined
        const sync = () => {
          release?.()
          release = slots.spec(name) ? register() : undefined
        }
        const unsubscribe = slots.subscribeDeclaration(name, sync)
        sync()
        injectors.push(() => { unsubscribe(); release?.() })
      }
    })
    const releaseRoot = slots.register({
      name: 'root',
      children: {
        'eleckoi.roleplay': { kind: 'chain', scope: 'root' },
        'conversation.input.left': { kind: 'list', scope: 'session' },
        'conversation.input.right': { kind: 'list', scope: 'session' },
        'conversation.input.overlay': { kind: 'list', scope: 'session' },
        'conversation.composer.dock': { kind: 'list', scope: 'session' },
        'conversation.trajectory.images': { kind: 'single', scope: 'session' }
      }
    }, () => null)
    plugin.apply({ sessions: {}, slots: clientSlots })

    const extensionButton = () => null
    const extensionDock = () => null
    const extensionImage = () => null
    const store = () => null
    const inject = () => ({ value: 1 })
    const releaseButton = slots.register({
      name: 'conversation.input.right', id: 'sample-button', order: 12,
      inject, store, locale: 'sample', registrant: 'sample-extension'
    }, extensionButton)
    const releaseDock = slots.register({
      name: 'conversation.composer.dock', id: 'sample-dock', order: 4,
      registrant: 'sample-extension'
    }, extensionDock)
    const releaseLeft = slots.register({ name: 'conversation.input.left', id: 'left-button' }, extensionButton)
    const releaseOverlay = slots.register({ name: 'conversation.input.overlay', id: 'overlay' }, extensionButton)
    const releaseImage = slots.register({ name: 'conversation.trajectory.images', id: 'trajectory-images' }, extensionImage)
    await Promise.resolve()

    const button = slots.entriesOfSlot('eleckoi.roleplay.conversation.input.right')[0]
    const dock = slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.dock')[0]
    expect(button?.component({ marker: 'button' })).toEqual({ type: extensionButton, props: { marker: 'button' } })
    expect(button?.options).toMatchObject({ id: 'dsh:conversation.input.right:sample-button', order: 12 })
    expect(button?.inject).toBe(inject)
    expect(button?.store).toBe(store)
    expect(button?.locale).toBe('sample')
    const upstreamProjection = (key: string) => `old:${key}`
    const stats = { turns: 1, steps: 3, tokenUsage: { outputTokens: 42 } }
    const dockRender = dock?.component({ generationStats: stats, useProjection: upstreamProjection })
    expect(dockRender.type).toBe(extensionDock)
    expect(dockRender.props.useProjection('sessionStats')).toEqual(stats)
    expect(dockRender.props.useProjection('tokenUsage')).toEqual(stats.tokenUsage)
    expect(dockRender.props.useProjection('other')).toBe('old:other')
    expect(dock?.component({ generationStats: null, useProjection: upstreamProjection }).props.useProjection('sessionStats'))
      .toEqual({ turns: 0, steps: 0 })
    expect(slots.spec('eleckoi.roleplay.conversation.input.right')).toEqual({ kind: 'list', scope: 'session' })
    expect(slots.spec('conversation.trajectory.images')).toEqual({ kind: 'single', scope: 'session' })
    expect(slots.entriesOfSlot('conversation.trajectory.images')[0]?.component).toBe(extensionImage)
    expect(slots.spec('eleckoi.roleplay.trajectory.images')).toEqual({ kind: 'single', scope: 'session' })
    expect(slots.entriesOfSlot('eleckoi.roleplay.trajectory.images')[0]?.component({ marker: 'image' }))
      .toEqual({ type: extensionImage, props: { marker: 'image' } })
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.left')).toHaveLength(1)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.overlay')).toHaveLength(1)

    releaseButton()
    releaseDock()
    releaseLeft()
    releaseOverlay()
    releaseImage()
    await Promise.resolve()
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.right')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.dock')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.left')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.overlay')).toHaveLength(0)
    expect(slots.entriesOfSlot('conversation.trajectory.images')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.trajectory.images')).toHaveLength(0)
    for (const dispose of injectors.reverse()) dispose()
    releaseRoot()
  })
})
