import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

describe('ElecKoi built-in plugin inventory', () => {
  it('registers Chinese product entries with official-style component details', () => {
    const source = readFileSync(new URL('../packages/dsh-client-shell/src/client.js', import.meta.url), 'utf8')
    let registration: any
    const entries: any[] = []
    const react = {
      Fragment: 'fragment',
      createElement: (component: any, props: any, ...children: any[]) => ({ component, props: props || {}, children }),
      lazy: (load: any) => ({ load }),
    }
    runInNewContext(source, {
      window: { __ModuleLoader__: { load: (value: any) => { registration = value } }, addEventListener() {}, removeEventListener() {} },
      document: {},
      globalThis: {},
    })
    const plugin = registration.factory((name: string) => {
      if (name === 'react') return react
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
        PluginArtworkDefault: 'plugin-artwork',
        StateDot: 'state-dot',
        Tag: 'tag',
      }
      throw new Error(`Unexpected client module ${name}`)
    })
    plugin.apply({
      effect: () => {},
      slots: {
        inject: (_name: string, factory: () => any) => {
          const result = factory()
          return Array.isArray(result) ? () => result.forEach((dispose) => dispose?.()) : result
        },
        register: (options: any, component: any) => {
          const entry = { options, component }
          entries.push(entry)
          return () => entries.splice(entries.indexOf(entry), 1)
        },
      },
    })

    const productEntries = entries.filter((entry) => entry.options.name === 'plugins.item')
    expect(productEntries.map((entry) => entry.options.label)).toEqual(expect.arrayContaining([
      '角色与角色卡', '角色配置', '角色对话记录', '模型配置', '用户资料', 'Agent 预设', '角色聊天',
    ]))
    const componentCounts = {
      'eleckoi.characters': 11,
      'eleckoi.character-configuration': 3,
      'eleckoi.conversations': 4,
      'eleckoi.models': 4,
      'eleckoi.persona': 2,
      'eleckoi.presets': 9,
      'eleckoi.roleplay': 13,
      'eleckoi.session-edit': 1,
      'eleckoi.shell': 26,
    }
    const countRows = (node: any): number => {
      if (Array.isArray(node)) return node.reduce((count, child) => count + countRows(child), 0)
      if (!node || typeof node !== 'object') return 0
      return (node.props?.['data-plugin-row'] ? 1 : 0) + countRows(node.children)
    }
    for (const [id, expectedCount] of Object.entries(componentCounts)) {
      const entry = productEntries.find((candidate) => candidate.options.id === id)
      const wrapper = entry.component({ view: 'page' })
      expect(countRows(wrapper.component(wrapper.props)), id).toBe(expectedCount)
    }

    const characters = productEntries.find((entry) => entry.options.id === 'eleckoi.characters')
    const summaryWrapper = characters.component({ view: 'summary' })
    const summary = summaryWrapper.component(summaryWrapper.props)
    const wrapper = characters.component({ view: 'page' })
    const detail = wrapper.component(wrapper.props)
    expect(JSON.stringify(summary)).toContain('提供角色列表、角色卡资料和角色管理入口。')
    expect(JSON.stringify(summary)).toContain('@eleckoi/dsh-client-characters')
    expect(JSON.stringify(detail)).toContain('包含的组件')
    expect(JSON.stringify(detail)).toContain('共 11 个 · 3 运行中 · 8 已开放')
    expect(JSON.stringify(detail)).toContain('eleckoiCharacters')
    expect(JSON.stringify(detail)).toContain('eleckoi.character.editor.dynamic')
    expect(entries.some((entry) => entry.options.name === 'plugins.detail.badge')).toBe(true)

  })

  it('classifies every patched upstream package as an ElecKoi adaptation', () => {
    const source = readFileSync(new URL('../packages/dsh-client-shell/src/client.js', import.meta.url), 'utf8')
    const workspace = parseYaml(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
    const patchedPackages = Object.keys(workspace.patchedDependencies).map((spec) => {
      const versionSeparator = spec.lastIndexOf('@')
      return versionSeparator > 0 ? spec.slice(0, versionSeparator) : spec
    })
    for (const packageName of patchedPackages) {
      expect(source, packageName).toContain(`['${packageName}',`)
    }
  })
})
