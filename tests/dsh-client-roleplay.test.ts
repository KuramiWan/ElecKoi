import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-roleplay/src/client.js', import.meta.url), 'utf8')
const slotTypes = readFileSync(new URL('../packages/dsh-client-roleplay/src/slots.d.ts', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../packages/dsh-client-roleplay/package.json', import.meta.url), 'utf8'))
const rowId = 'eleckoi-client-roleplay'

function clientRequire(React: unknown) {
  return (name: string) => {
    if (name === 'react') return React
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
    expect(entry.children).toEqual({
      'eleckoi.roleplay.session': { kind: 'single', scope: 'session' }
    })
    expect(entry.select(owner)).toBe(owner)
    expect(entry.select({ component: null })).toBeNull()
    expect(component({ matched: owner })).toEqual({ type: ChatView, props: {
      ...owner.props,
      renderRoleplaySlot: undefined,
      renderRoleplaySlotChain: undefined,
      renderRoleplayMessage: undefined,
      dshComposerOwner: undefined,
      dshInputZone: undefined
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
    let roleplayComponent: any
    let sessionComponent: any
    const reference = { sessionId: 'dsh-session-1' }
    const sessionSnapshot = { id: reference.sessionId, running: false }
    const inputSnapshot = { text: 'draft' }
    const pendingInteraction = { kind: 'approval' }
    const renderSlot = (name: string, owner: unknown, options: unknown) => ({ name, owner, options })
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
        if (name === 'eleckoi.roleplay' || name === 'eleckoi.roleplay.session') register()
      },
      register: (options: any, view: unknown) => {
        if (options.name === 'eleckoi.roleplay') roleplayComponent = view
        if (options.name === 'eleckoi.roleplay.session') sessionComponent = view
      }
    } })
    const ChatView = () => null
    const matched = {
      component: ChatView,
      props: { conversationId: 'product-chat-1', runtimeSessionId: reference.sessionId }
    }
    const result = roleplayComponent({
      matched, sessions: {}, SessionProvider, renderSlot
    })
    expect(result.type).toBe(SessionProvider)
    expect(result.props.session).toBe(reference)
    expect(result.child).toEqual({
      name: 'eleckoi.roleplay.session',
      owner: { matched },
      options: expect.objectContaining({ fallback: expect.anything() })
    })

    const sessionResult = sessionComponent({
      matched,
      sessionId: reference.sessionId,
      useSession: (selector: (snapshot: unknown) => unknown) => selector(sessionSnapshot),
      useSessionStatus: (selector: (snapshot: Map<string, unknown>) => unknown) => selector(new Map([
        [reference.sessionId, { pendingInteraction }]
      ])),
      useInput: (selector: (snapshot: unknown) => unknown) => selector(inputSnapshot),
      renderSlot,
      renderSlotChain
    })
    expect(sessionResult.type).toBe(ChatView)
    expect(sessionResult.props.renderRoleplaySlot).toBe(renderSlot)
    expect(sessionResult.props.renderRoleplaySlotChain).toBe(renderSlotChain)
    expect(sessionResult.props.dshComposerOwner).toEqual({
      sessionId: reference.sessionId,
      session: sessionSnapshot,
      pendingInteraction
    })
    expect(sessionResult.props.dshInputZone).toEqual({ session: sessionSnapshot, input: inputSnapshot })
    const messageOwner = { productMessageId: 'm1', content: '流式正文', streaming: true }
    const content = { type: 'official-markdown', props: { text: '流式正文', streaming: true } }
    const rendered = sessionResult.props.renderRoleplayMessage(messageOwner, content)
    expect(rendered.name).toBe('eleckoi.roleplay.message.content')
    expect(rendered.owner).toEqual(messageOwner)
    expect(rendered.options.fallback).toBe(content)
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
        'conversation.session.header.corner': { kind: 'single', scope: 'session' },
        'conversation.composer': { kind: 'chain', scope: 'session' },
        'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
        'conversation.input.dock': { kind: 'list', scope: 'session' },
        'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
        'conversation.input.permission': { kind: 'single', scope: 'session' },
        'conversation.input.left': { kind: 'list', scope: 'session' },
        'conversation.input.plan': { kind: 'single', scope: 'session' },
        'conversation.input.right': { kind: 'list', scope: 'session' },
        'conversation.input.model': { kind: 'single', scope: 'session' },
        'conversation.input.activity': { kind: 'single', scope: 'session' },
        'conversation.input.overlay': { kind: 'list', scope: 'session' },
        'conversation.composer.dock': { kind: 'list', scope: 'session' },
        'conversation.approval.detail': { kind: 'single', scope: 'session' },
        'conversation.plan-review.actions': { kind: 'list', scope: 'session' },
        'conversation.trajectory.images': { kind: 'single', scope: 'session' },
        'conversation.view': { kind: 'list', scope: 'session' }
      }
    }, () => null)
    plugin.apply({ sessions: {}, slots: clientSlots })

    const typeDeclarations = [...slotTypes.matchAll(/'([^']+)':\s*\{\s*kind:\s*'([^']+)'\s*scope:\s*'([^']+)'/g)]
      .filter(([, id]) => id !== 'eleckoi.roleplay.session')
    expect(manifest.eleckoi.developerInterfaces.map((item: any) => item.id).sort())
      .toEqual(typeDeclarations.map(([, id]) => id).sort())
    const modes: Record<string, string> = { single: 'replace', chain: 'replace', list: 'append' }
    for (const [, id, kind, scope] of typeDeclarations) {
      const metadata = manifest.eleckoi.developerInterfaces.find((item: any) => item.id === id)
      expect(slots.spec(id), id).toEqual({ kind, scope })
      expect(metadata, id).toMatchObject({ kind: 'ui-slot', mode: modes[kind!], scope })
    }
    for (const id of ['eleckoi.roleplay.input.left', 'eleckoi.roleplay.input.right',
      'eleckoi.roleplay.input.overlay', 'eleckoi.roleplay.composer.dock']) {
      expect(slots.spec(id), id).toBeUndefined()
    }

    const extensionButton = () => null
    const extensionDock = () => null
    const extensionImage = () => null
    const officialComposer = () => null
    const officialRightbarButton = () => null
    const skinComposer = () => null
    const losingComposer = () => null
    const takeoverComposer = () => null
    const store = () => null
    const inject = () => ({ value: 1 })
    const releaseOfficialComposer = slots.register({
      name: 'conversation.composer.bar',
      registrant: '@deepseek-ai/dsh-client-ui-conversation'
    }, officialComposer)
    const releaseOfficialRightbarButton = slots.register({
      name: 'conversation.session.header.corner',
      inject,
      store,
      locale: 'sidebarRight',
      registrant: '@deepseek-ai/dsh-client-ui-sidebar-right'
    }, officialRightbarButton)
    const releaseLosingComposer = slots.register({
      name: 'conversation.composer.bar', priority: 10, registrant: 'sample-losing-skin'
    }, losingComposer)
    await Promise.resolve()
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.bar')).toHaveLength(1)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.bar')[0]?.component({}).type)
      .toBe(officialComposer)
    const releaseSkinComposer = slots.register({
      name: 'conversation.composer.bar', priority: -10, registrant: 'sample-input-skin'
    }, skinComposer)
    const takeoverRequest = { sessionId: 'session-1', kind: 'approval' }
    const takeoverSelect = (owner: any) => owner.pendingInteraction ? takeoverRequest : null
    const releaseTakeover = slots.register({
      name: 'conversation.composer', priority: 1, select: takeoverSelect, registrant: 'sample-approval'
    }, takeoverComposer)
    const releaseButton = slots.register({
      name: 'conversation.input.right', id: 'sample-button', order: 12,
      inject, store, locale: 'sample', registrant: 'sample-extension'
    }, extensionButton)
    const releaseDock = slots.register({
      name: 'conversation.composer.dock', id: 'sample-dock', order: 4,
      registrant: 'sample-extension'
    }, extensionDock)
    const releaseInputDock = slots.register({
      name: 'conversation.input.dock', id: 'sample-input-dock', order: 2,
      registrant: 'sample-extension'
    }, extensionDock)
    const releaseLeft = slots.register({ name: 'conversation.input.left', id: 'left-button' }, extensionButton)
    const releaseOverlay = slots.register({ name: 'conversation.input.overlay', id: 'overlay' }, extensionButton)
    const releaseImage = slots.register({ name: 'conversation.trajectory.images', id: 'trajectory-images' }, extensionImage)
    const trajectory = () => null
    const releaseTrajectory = slots.register({
      name: 'conversation.view', id: 'trajectory', inject, store, locale: 'trajectory',
      children: { 'sample.trajectory.child': { kind: 'single', scope: 'session' } }
    }, trajectory)
    await Promise.resolve()

    const bar = slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.bar')[0]
    expect(bar?.options.priority).toBe(-10)
    expect(bar?.registrant).toBe('sample-input-skin')
    const childCalls: Array<{ name: string, owner: unknown, options: unknown }> = []
    const renderBridgeSlot = (name: string, owner: unknown, options: unknown) => {
      childCalls.push({ name, owner, options })
      return 'bridged-child'
    }
    const barRender = bar?.component({ marker: 'skin', renderBridgeSlot })
    expect(barRender.type).toBe(skinComposer)
    expect(barRender.props.renderBridgeSlot).toBeUndefined()
    expect(barRender.props.renderSlot('conversation.input.model', { locked: false }, { fallback: 'fallback' }))
      .toBe('bridged-child')
    expect(childCalls[0]).toEqual({
      name: 'eleckoi.roleplay.conversation.input.model',
      owner: { locked: false },
      options: { fallback: 'fallback' }
    })
    const takeover = slots.entriesOfSlot('eleckoi.roleplay.conversation.composer')[0]
    expect(takeover?.select).toBe(takeoverSelect)
    expect(takeover?.select({ pendingInteraction: true })).toBe(takeoverRequest)
    const takeoverRender = takeover?.component({ matched: takeoverRequest, renderBridgeSlot })
    expect(takeoverRender.type).toBe(takeoverComposer)
    expect(takeoverRender.props.renderSlot('conversation.approval.detail', {}, undefined))
      .toBe('bridged-child')

    const button = slots.entriesOfSlot('eleckoi.roleplay.conversation.input.right')[0]
    const rightbarButton = slots.entriesOfSlot('eleckoi.roleplay.conversation.header.corner')[0]
    const dock = slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.dock')[0]
    const inputDock = slots.entriesOfSlot('eleckoi.roleplay.conversation.input.dock')[0]
    expect(button?.component({ marker: 'button' })).toEqual({ type: extensionButton, props: { marker: 'button' } })
    expect(rightbarButton?.component({ marker: 'rightbar' })).toEqual({
      type: officialRightbarButton,
      props: { marker: 'rightbar' }
    })
    expect(rightbarButton?.inject).toBe(inject)
    expect(rightbarButton?.store).toBe(store)
    expect(rightbarButton?.locale).toBe('sidebarRight')
    expect(button?.options).toMatchObject({ id: 'dsh:conversation.input.right:sample-button', order: 12 })
    expect(button?.inject).toBe(inject)
    expect(button?.store).toBe(store)
    expect(button?.locale).toBe('sample')
    const upstreamProjection = (key: string) => `old:${key}`
    const dockRender = dock?.component({ useProjection: upstreamProjection })
    expect(dockRender.type).toBe(extensionDock)
    expect(dockRender.props.useProjection).toBe(upstreamProjection)
    expect(dockRender.props.useProjection('sessionStats')).toBe('old:sessionStats')
    expect(dockRender.props.useProjection('tokenUsage')).toBe('old:tokenUsage')
    expect(dockRender.props.useProjection('other')).toBe('old:other')
    expect(inputDock?.component({ session: { id: 's1' }, input: { text: 'draft' } })).toEqual({
      type: extensionDock,
      props: { session: { id: 's1' }, input: { text: 'draft' } }
    })
    const releaseStats = slots.register({ name: 'conversation.composer.dock', id: 'stats' }, extensionDock)
    await Promise.resolve()
    const statsEntry = slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.dock')
      .find((entry: any) => entry.options.id === 'dsh:conversation.composer.dock:stats')
    expect(statsEntry).toBeDefined()
    const statsProjection = (key: string) => key === 'sessionStats'
      ? { turns: 3, steps: 5, llmMs: 1 }
      : key === 'eleckoiHistoryStatsAdjustment' ? { turns: 1, steps: 2 }
        : `official:${key}`
    const statsRender = statsEntry?.component({ useProjection: statsProjection })
    expect(statsRender.type).toBe(extensionDock)
    expect(statsRender.props.useProjection('sessionStats')).toEqual({ turns: 2, steps: 3, llmMs: 1 })
    expect(statsRender.props.useProjection('tokenUsage')).toBe('official:tokenUsage')
    expect(statsEntry?.component({ useProjection: statsProjection, generationStatsEnabled: false })).toBeNull()
    releaseStats()
    const seat = slots.entriesOfSlot('eleckoi.roleplay.trajectory')[0]
    expect(seat?.inject).toBe(inject)
    expect(seat?.store).toBe(store)
    expect(seat?.locale).toBe('trajectory')
    const productView = () => null
    const renderSlot = (name: string, owner: unknown) => ({ name, owner })
    const rendered = seat?.component({ component: productView, useProjection: upstreamProjection, renderSlot })
    expect(rendered.type).toBe(productView)
    expect(rendered.props.useProjection).toBe(upstreamProjection)
    expect(rendered.props.renderSlot('conversation.trajectory.images', { id: 'image' }))
      .toEqual({ name: 'eleckoi.roleplay.trajectory.images', owner: { id: 'image' } })
    expect(slots.spec('eleckoi.roleplay.conversation.input.right')).toEqual({ kind: 'list', scope: 'session' })
    expect(slots.spec('conversation.trajectory.images')).toEqual({ kind: 'single', scope: 'session' })
    expect(slots.entriesOfSlot('conversation.trajectory.images')[0]?.component).toBe(extensionImage)
    expect(slots.spec('eleckoi.roleplay.trajectory.images')).toEqual({ kind: 'single', scope: 'session' })
    expect(slots.entriesOfSlot('eleckoi.roleplay.trajectory.images')[0]?.component({ marker: 'image' }))
      .toEqual({ type: extensionImage, props: { marker: 'image' } })
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.left')).toHaveLength(1)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.overlay')).toHaveLength(1)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.header.corner')).toHaveLength(1)

    releaseSkinComposer()
    releaseTakeover()
    releaseButton()
    releaseDock()
    releaseInputDock()
    releaseLeft()
    releaseOverlay()
    releaseImage()
    releaseTrajectory()
    await Promise.resolve()
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.bar')).toHaveLength(1)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.bar')[0]?.component({}).type)
      .toBe(officialComposer)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.right')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.dock')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.left')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.input.overlay')).toHaveLength(0)
    expect(slots.entriesOfSlot('conversation.trajectory.images')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.trajectory.images')).toHaveLength(0)
    expect(slots.entriesOfSlot('eleckoi.roleplay.trajectory')).toHaveLength(0)
    releaseOfficialRightbarButton()
    await Promise.resolve()
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.header.corner')).toHaveLength(0)
    releaseLosingComposer()
    releaseOfficialComposer()
    await Promise.resolve()
    expect(slots.entriesOfSlot('eleckoi.roleplay.conversation.composer.bar')).toHaveLength(0)
    for (const dispose of injectors.reverse()) dispose()
    releaseRoot()
  })
})
