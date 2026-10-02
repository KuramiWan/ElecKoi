import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'

const pages = [
  ['conversations', 'messages'],
  ['characters', 'character'],
  ['presets', 'presets'],
  ['models', 'model'],
] as const

describe('ElecKoi DSH main pages', () => {
  it.each(pages)('%s contributes a real %s page and navigation item', (feature, id) => {
    const source = readFileSync(new URL(`../packages/dsh-client-${feature}/src/client.js`, import.meta.url), 'utf8')
    let registration: any
    const entries: Array<{ options: any; component: any }> = []
    const disposers: Array<() => void> = []
    const slots = {
      inject: (_name: string, register: () => () => void) => { disposers.push(register()) },
      register: (options: any, component: any) => {
        const entry = { options, component }
        entries.push(entry)
        return () => { entries.splice(entries.indexOf(entry), 1) }
      },
    }
    runInNewContext(source, {
      window: {
        __ModuleLoader__: { load: (value: any) => { registration = value } },
      },
    })
    const plugin = registration.factory((name: string) => {
      if (name === 'react') return {
        Suspense: 'Suspense',
        lazy: (load: any) => ({ load }),
        createElement: (component: any, props: any, ...children: any[]) => ({ component, props, children })
      }
      throw new Error(`Unexpected client module ${name}`)
    })
    plugin.apply({
      provide: () => {},
      remote: { eleckoiAgentPresets: {} },
      slots,
      effect: () => {},
    })

    const page = entries.find(entry => entry.options.name === 'main' && entry.options.key === id)
    const navigation = entries.find(entry => entry.options.name === 'sidebar.panellist' && entry.options.id === id)
    expect(page).toBeDefined()
    expect(navigation).toBeDefined()
    const rendered = page!.component({})
    expect(page!.options.registrant).toBe(`@eleckoi/dsh-client-${feature}`)
    expect(rendered.component.load).toBeTypeOf('function')
    expect(rendered.props).toBeUndefined()
    for (const dispose of disposers.reverse()) dispose()
    expect(entries).toEqual([])
  })

  it('keeps the product marker in the upstream slot registry', () => {
    const slots: any = new SlotCore()
    const stopRoot = slots.register({
      name: 'root', children: { main: { kind: 'keyed', scope: 'root' } }
    }, () => null)
    const stopPage = slots.register({ name: 'main', key: 'messages', registrant: '@eleckoi/dsh-client-conversations' }, () => null)
    expect(slots.entriesOfSlot('main')[0]?.registrant).toBe('@eleckoi/dsh-client-conversations')
    stopPage()
    stopRoot()
  })
})
