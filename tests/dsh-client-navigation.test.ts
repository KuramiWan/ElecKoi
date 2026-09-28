import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const packages = [
  'dsh-client-shell', 'dsh-client-conversations', 'dsh-client-characters',
  'dsh-client-presets', 'dsh-client-models'
]

describe('ElecKoi DSH client navigation', () => {
  it('lets each feature plugin register its page and navigation entry', () => {
    let root: any
    const entries: Array<{ options: any; component: any; dispose: () => void }> = []
    const slots = {
      provideRoot: () => () => {},
      register: (options: any, component: any) => {
        const entry = { options, component, dispose: () => { entries.splice(entries.indexOf(entry), 1) } }
        entries.push(entry)
        if (options.name === 'root') root = options
        return entry.dispose
      },
      inject: (_name: string, register: () => Iterable<() => void> | (() => void)) => {
        const result = register()
        if (typeof result === 'function') return
        for (const _dispose of result) { /* Cordis owns each disposer. */ }
      },
      entriesOfSlot: (name: string) => entries.filter(entry => entry.options.name === name),
      spec: () => undefined,
      subscribe: () => () => {},
    }
    for (const packageName of packages) {
      let registration: any
      const source = readFileSync(new URL(`../packages/${packageName}/src/client.js`, import.meta.url), 'utf8')
      runInNewContext(source, {
        window: { eleckoi: {}, __ModuleLoader__: { load: (value: any) => { registration = value } } },
        AbortController,
      })
      const plugin = registration.factory((name: string) => {
        if (name === 'react') return {
          Suspense: 'Suspense',
          lazy: (load: any) => ({ load }),
          createElement: (component: any, props: any, ...children: any[]) => ({ component, props, children })
        }
        if (name === 'react-dom') return {}
        throw new Error(`Unexpected module ${name}`)
      })
      let effectCount = 0
      plugin.apply({
        slots,
        provide: () => {},
        reflect: { provide: () => () => {} },
        effect: (run: () => void) => { if (packageName === 'dsh-client-shell' && effectCount++ === 0) run() },
      })
    }

    expect(root.children['sidebar.panellist']).toBeUndefined()
    expect(root.children.main).toEqual({ kind: 'keyed', scope: 'root' })
    const panels = slots.entriesOfSlot('main').map(entry => entry.options.key)
    const railItems = slots.entriesOfSlot('sidebar.panellist').map(entry => entry.options.id)
    expect(railItems).toEqual(['community', 'messages', 'character', 'presets', 'model'])
    expect(panels).toEqual(['settings', 'messages', 'character', 'presets', 'model'])

    for (const id of panels) {
      const entry = entries.find(item => item.options.name === 'main' && item.options.key === id)
      const rendered = entry?.component({})
      expect(entry?.options.registrant).toMatch(/^@eleckoi\/dsh-client-/)
      expect(rendered?.component.load).toBeTypeOf('function')
      expect(rendered?.props).toBeUndefined()
    }

    const layout = root.inject().layout
    slots.register({ name: 'main', key: 'extension-page' }, () => null)
    layout.selectPanel('extension-page')
    expect(layout.panelInfo.getSnapshot().activePanelId).toBe('extension-page')
    expect(() => layout.selectPanel('missing-page')).toThrow('not registered')
  })

  it('renders official sidebar footer actions in the product sidebar with wide layout', () => {
    let registration: any
    let rootComponent: any
    let rootOptions: any
    const slotCalls: Array<{ name: string; owner: any }> = []
    const sourceEntry = {
      options: { name: 'sidebar.footer.action', id: 'example' },
      component: () => null,
    }
    const sourceEntries = [sourceEntry]
    const projectedEntries: any[] = []
    let notifySource = () => {}
    const slots = {
      subscribe: (name: string, listener: () => void) => {
        if (name === 'sidebar.footer.action') notifySource = listener
        return () => {}
      },
      getVersion: () => 1,
      spec: (name: string) => name === 'sidebar.footer.action' ? { kind: 'list', scope: 'root' } : undefined,
      entriesOfSlot: (name: string) => name === 'sidebar.footer.action' ? sourceEntries
        : name === 'eleckoi.sidebar.footer.action' ? projectedEntries : [],
      provideRoot: () => () => {},
      register: (options: any, component: any) => {
        if (options.name === 'root') {
          rootComponent = component
          rootOptions = options
        }
        if (options.name === 'eleckoi.sidebar.footer.action') {
          const entry = { options, component }
          projectedEntries.push(entry)
          return () => { projectedEntries.splice(projectedEntries.indexOf(entry), 1) }
        }
        return () => {}
      },
      inject: (_name: string, register: () => void) => { register() },
    }
    const ProductApp = () => null
    let stateIndex = 0
    const React = {
      Fragment: 'Fragment',
      lazy: () => ProductApp,
      useState: () => [stateIndex++ === 0 ? ProductApp : '', () => {}],
      useSyncExternalStore: (_subscribe: any, getSnapshot: () => any) => getSnapshot(),
      useMemo: (calculate: () => any) => calculate(),
      useEffect: () => {},
      createElement: (component: any, props: any, ...children: any[]) => ({ component, props, children }),
    }
    const source = readFileSync(new URL('../packages/dsh-client-shell/src/client.js', import.meta.url), 'utf8')
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } } },
      AbortController,
    })
    const plugin = registration.factory((name: string) => {
      if (name === 'react') return React
      throw new Error(`Unexpected module ${name}`)
    })
    let effectCount = 0
    plugin.apply({
      slots,
      reflect: { provide: () => () => {} },
      effect: (run: () => void) => { if (effectCount++ === 0) run() },
    })
    const render = () => {
      stateIndex = 0
      const tree = rootComponent({
        layout: { panelInfo: { subscribe: () => () => {}, getSnapshot: () => ({ activePanelId: 'messages' }) } },
        slots,
        locale: { subscribe: () => () => {}, getSnapshot: () => ({ revision: 0 }) },
        renderSlot: (name: string, owner: any) => {
          if (!rootOptions.children[name]) throw new Error(`root cannot render ${name}`)
          slotCalls.push({ name, owner })
          return { slot: name }
        },
      })
      return tree.children[0].children[0].props
    }

    expect(projectedEntries).toHaveLength(1)
    expect(projectedEntries[0].component).toBe(sourceEntry.component)
    expect(render().sidebarFooterActions).toEqual({ slot: 'eleckoi.sidebar.footer.action' })
    expect(slotCalls).toContainEqual({ name: 'eleckoi.sidebar.footer.action', owner: { wide: true } })
    sourceEntries.length = 0
    notifySource()
    slotCalls.length = 0
    expect(render().sidebarFooterActions).toBeNull()
    expect(projectedEntries).toHaveLength(0)
    expect(slotCalls.some(call => call.name === 'eleckoi.sidebar.footer.action')).toBe(false)
  })
})
