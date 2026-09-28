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
    }
    for (const packageName of packages) {
      let registration: any
      const source = readFileSync(new URL(`../packages/${packageName}/src/client.js`, import.meta.url), 'utf8')
      runInNewContext(source, {
        window: { eleckoi: {}, __ModuleLoader__: { load: (value: any) => { registration = value } } },
        AbortController,
      })
      const plugin = registration.factory((name: string) => {
        if (name === 'react') return { createElement: (component: any, props: any) => ({ component, props }) }
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

    const view = { marker: 'product page state' }
    for (const id of panels) {
      const Page = () => null
      const entry = entries.find(item => item.options.name === 'main' && item.options.key === id)
      const rendered = entry?.component({ productMainPages: { [id]: Page }, view })
      expect(rendered?.component).toBe(Page)
      expect(rendered?.props.view).toBe(view)
    }

    const layout = root.inject().layout
    slots.register({ name: 'main', key: 'extension-page' }, () => null)
    layout.selectPanel('extension-page')
    expect(layout.panelInfo.getSnapshot().activePanelId).toBe('extension-page')
    expect(() => layout.selectPanel('missing-page')).toThrow('not registered')
  })
})
