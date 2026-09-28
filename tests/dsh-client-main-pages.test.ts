import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
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
    const slots = {
      inject: (_name: string, register: () => void) => register(),
      register: (options: any, component: any) => {
        entries.push({ options, component })
        return () => {}
      },
    }
    runInNewContext(source, {
      window: {
        eleckoi: {},
        __ModuleLoader__: { load: (value: any) => { registration = value } },
      },
    })
    const plugin = registration.factory((name: string) => {
      if (name === 'react') return { createElement: (component: any, props: any) => ({ component, props }) }
      throw new Error(`Unexpected client module ${name}`)
    })
    plugin.apply({
      provide: () => {},
      slots,
      effect: () => {},
    })

    const page = entries.find(entry => entry.options.name === 'main' && entry.options.key === id)
    const navigation = entries.find(entry => entry.options.name === 'sidebar.panellist' && entry.options.id === id)
    expect(page).toBeDefined()
    expect(navigation).toBeDefined()
    const Page = () => null
    const view = { marker: id }
    const rendered = page!.component({ productMainPages: { [id]: Page }, view })
    expect(rendered.component).toBe(Page)
    expect(rendered.props.view).toBe(view)
  })
})
