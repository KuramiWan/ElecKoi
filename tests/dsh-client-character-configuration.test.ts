import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-character-configuration/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('DSH ElecKoi character configuration models', () => {
  it('refreshes loaded settings after a record change and a connection reset', async () => {
    const calls: string[] = []
    const inputs: Array<{ name: string; input: unknown }> = []
    const stopped: string[] = []
    let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
    const recordListeners = new Set<(event: unknown) => void>()
    let onReset: (() => void) | undefined
    let cleanup = () => {}
    const services = new Map<string, any>()
    const bridge = {
      request: async (name: string, input: unknown) => {
        calls.push(name)
        inputs.push({ name, input })
        if (name === 'query.setting_library.read') {
          return { ok: true, data: { characterId: 'character-1', entries: [], groups: [], versions: [] } }
        }
        if (name === 'query.variable_config.read') {
          return { ok: true, data: { characterId: 'character-1', objects: [], variables: [], versions: [] } }
        }
        if (name === 'query.regex_rules.read' || name === 'command.regex_rules.save') {
          return { ok: true, data: { characterId: 'character-1', globalRules: [], agentPresetRules: [],
            characterRules: [], versions: [], revision: name === 'command.regex_rules.save' ? 2 : 1 } }
        }
        if (name === 'command.regex_rules.test') {
          return { ok: true, data: { output: 'matched', validationMessage: null } }
        }
        throw new Error(`Unexpected request: ${name}`)
      },
      subscribe: (listener: (event: unknown) => void) => {
        recordListeners.add(listener)
        return () => { stopped.push('bridge'); recordListeners.delete(listener) }
      }
    }
    runInNewContext(source, {
      window: { eleckoi: bridge, __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    expect(registration?.id).toBe('@eleckoi/dsh-client-character-configuration')
    registration!.factory().apply({
      provide: (name: string, value: unknown) => { services.set(name, value) },
      effect: (run: () => () => void) => { cleanup = run() },
      on: (name: string, listener: () => void) => {
        expect(name).toBe('connection/reset')
        onReset = listener
        return () => { stopped.push('reset') }
      }
    })
    const libraries = services.get('eleckoiSettingLibraries')
    const variables = services.get('eleckoiVariables')
    const regexRules = services.get('eleckoiRegexRules')
    expect(libraries).toBeDefined()
    expect(variables).toBeDefined()
    expect(regexRules).toBeDefined()

    await Promise.all([libraries.read('character-1'), variables.read('character-1'), regexRules.read('character-1')])
    expect(libraries.getSnapshot('character-1').status).toBe('ready')
    expect(variables.getSnapshot('character-1').status).toBe('ready')
    expect(regexRules.getSnapshot('character-1').status).toBe('ready')

    const edited = regexRules.getSnapshot('character-1').value
    await regexRules.save('character-1', edited)
    expect(inputs.findLast(item => item.name === 'command.regex_rules.save')?.input).toMatchObject({
      characterId: 'character-1', expectedRevision: 1
    })
    expect(regexRules.getSnapshot('character-1').value.revision).toBe(2)
    await expect(regexRules.test('input', { id: 'rule-1' }, 'AiOutput')).resolves.toMatchObject({ output: 'matched' })

    for (const listener of recordListeners) listener({ name: 'records.changed', payload: { module: 'settingLibraries' } })
    await settle()
    expect(calls.filter(name => name === 'query.setting_library.read')).toHaveLength(2)
    expect(calls.filter(name => name === 'query.variable_config.read')).toHaveLength(1)

    for (const listener of recordListeners) listener({ name: 'records.changed', payload: { module: 'agentPresets' } })
    await settle()
    expect(calls.filter(name => name === 'query.regex_rules.read')).toHaveLength(2)

    onReset?.()
    await settle()
    expect(calls.filter(name => name === 'query.setting_library.read')).toHaveLength(3)
    expect(calls.filter(name => name === 'query.variable_config.read')).toHaveLength(2)
    expect(calls.filter(name => name === 'query.regex_rules.read')).toHaveLength(3)
    cleanup()
    expect(stopped).toEqual(['reset', 'bridge', 'bridge', 'bridge'])
  })
})
