import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../packages/dsh-client-character-configuration/src/client.js', import.meta.url), 'utf8')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

type ConfigurationChange =
  | { kind: 'snapshot' }
  | { kind: 'configuration'; domain: 'settingLibraries' | 'variables' | 'regexRules' | 'agentPresets'; characterId?: string }

function configurationChanges() {
  const queue: ConfigurationChange[] = [{ kind: 'snapshot' }]
  let wake: (() => void) | undefined
  let stopped = false
  return {
    open(signal?: AbortSignal): AsyncIterable<ConfigurationChange> {
      const stop = () => { stopped = true; wake?.(); wake = undefined }
      if (signal?.aborted) stop()
      else signal?.addEventListener('abort', stop, { once: true })
      return (async function* () {
        try {
          while (!stopped) {
            if (queue.length > 0) {
              yield queue.shift()!
              continue
            }
            await new Promise<void>(resolve => { wake = resolve })
            wake = undefined
          }
        } finally {
          signal?.removeEventListener('abort', stop)
          stop()
        }
      })()
    },
    emit(change: ConfigurationChange) {
      queue.push(change)
      wake?.()
      wake = undefined
    },
    isStopped: () => stopped
  }
}

describe('DSH ElecKoi character configuration models', () => {
  it('uses DSH Remote for character and conversation settings and refreshes after a connection reset', async () => {
    const calls: string[] = []
    const inputs: Array<{ name: string; input: unknown }> = []
    const stopped: string[] = []
    let registration: { id: string; factory: () => { apply: (ctx: unknown) => void } } | undefined
    let onReset: (() => void) | undefined
    let cleanup = () => {}
    const services = new Map<string, any>()
    const changes = configurationChanges()
    runInNewContext(source, {
      AbortController,
      window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
    })
    expect(registration?.id).toBe('@eleckoi/dsh-client-character-configuration')
    registration!.factory().apply({
      remote: {
        eleckoiCharacterConfiguration: {
          changes: (signal?: AbortSignal) => changes.open(signal),
          readSettingLibrary: async (characterId: string) => {
            calls.push('query.setting_library.read')
            inputs.push({ name: 'query.setting_library.read', input: { characterId } })
            return { ok: true, value: { characterId, entries: [], groups: [], versions: [] } }
          },
          saveSettingLibrary: async (characterId: string, library: unknown) => {
            calls.push('command.setting_library.save')
            inputs.push({ name: 'command.setting_library.save', input: { characterId, library } })
            return { ok: true, value: library }
          },
          saveSettingLibraryViewState: async (characterId: string, expandedGroupIds: string[]) => {
            calls.push('command.setting_library.view_state.save')
            inputs.push({ name: 'command.setting_library.view_state.save', input: { characterId, expandedGroupIds } })
            return { ok: true, value: expandedGroupIds }
          },
          readConversationSettingLibraries: async (characterId: string) => {
            calls.push('query.setting_library.conversations')
            inputs.push({ name: 'query.setting_library.conversations', input: { characterId } })
            return { ok: true, value: [] }
          },
          saveConversationSettingLibrary: async (characterId: string, sessionId: string, library: unknown) => {
            calls.push('command.setting_library.conversation.save')
            inputs.push({ name: 'command.setting_library.conversation.save', input: { characterId, sessionId, library } })
            return { ok: true, value: library }
          },
          resetConversationSettingLibrary: async (characterId: string, sessionId: string) => {
            calls.push('command.setting_library.conversation.reset')
            inputs.push({ name: 'command.setting_library.conversation.reset', input: { characterId, sessionId } })
            return { ok: true, value: undefined }
          },
          saveConversationSettingLibraryVersion: async (characterId: string, sessionId: string, name: string) => {
            calls.push('command.setting_library.conversation.save_version')
            inputs.push({ name: 'command.setting_library.conversation.save_version', input: { characterId, sessionId, name } })
            return { ok: true, value: { characterId, entries: [], groups: [], versions: [] } }
          },
          readVariableConfig: async (characterId: string) => {
            calls.push('query.variable_config.read')
            inputs.push({ name: 'query.variable_config.read', input: { characterId } })
            return { ok: true, value: { characterId, objects: [], variables: [], versions: [] } }
          },
          saveVariableConfig: async (characterId: string, config: unknown) => {
            calls.push('command.variable_config.save')
            inputs.push({ name: 'command.variable_config.save', input: { characterId, config } })
            return { ok: true, value: config }
          },
          saveVariableConfigViewState: async (characterId: string, expandedObjectIds: string[]) => {
            calls.push('command.variable_config.view_state.save')
            inputs.push({ name: 'command.variable_config.view_state.save', input: { characterId, expandedObjectIds } })
            return { ok: true, value: expandedObjectIds }
          },
          readRegexRules: async (characterId: string) => {
            calls.push('query.regex_rules.read')
            inputs.push({ name: 'query.regex_rules.read', input: { characterId } })
            return { ok: true, value: { characterId, globalRules: [], agentPresetRules: [],
              characterRules: [], versions: [], revision: 1 } }
          },
          saveRegexRules: async (characterId: string, collection: unknown, expectedRevision: number) => {
            calls.push('command.regex_rules.save')
            inputs.push({ name: 'command.regex_rules.save', input: { characterId, collection, expectedRevision } })
            return { ok: true, value: { ...(collection as object), revision: 2 } }
          },
          importRegexRules: async () => ({ ok: true, value: null }),
          exportRegexRules: async () => ({ ok: true, value: { fileName: 'rules.json', json: '[]' } }),
          testRegexRule: async (text: string, rule: unknown, target: string) => {
            calls.push('command.regex_rules.test')
            inputs.push({ name: 'command.regex_rules.test', input: { text, rule, target } })
            return { ok: true, value: { output: 'matched', validationMessage: null } }
          }
        }
      },
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
    await settle()

    await Promise.all([libraries.read('character-1'), variables.read('character-1'), regexRules.read('character-1')])
    await libraries.readConversations('character-1')
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
    const library = libraries.getSnapshot('character-1').value
    await libraries.saveConversation('character-1', 'conversation-1', library)
    await libraries.resetConversation('character-1', 'conversation-1')
    await libraries.saveConversationVersion('character-1', 'conversation-1', '版本一')
    expect(inputs.filter(item => item.name.startsWith('command.setting_library.conversation.'))).toHaveLength(3)

    await settle()
    changes.emit({ kind: 'configuration', domain: 'variables', characterId: 'character-1' })
    await settle()
    expect(calls.filter(name => name === 'query.setting_library.read')).toHaveLength(1)
    expect(calls.filter(name => name === 'query.variable_config.read')).toHaveLength(2)
    expect(calls.filter(name => name === 'query.regex_rules.read')).toHaveLength(1)
    changes.emit({ kind: 'configuration', domain: 'agentPresets' })
    await settle()
    expect(calls.filter(name => name === 'query.regex_rules.read')).toHaveLength(2)

    onReset?.()
    await settle()
    expect(calls.filter(name => name === 'query.setting_library.read')).toHaveLength(2)
    expect(calls.filter(name => name === 'query.variable_config.read')).toHaveLength(3)
    expect(calls.filter(name => name === 'query.regex_rules.read')).toHaveLength(3)
    expect(calls.filter(name => name === 'query.setting_library.conversations')).toHaveLength(2)
    cleanup()
    expect(stopped).toEqual(['reset'])
    expect(changes.isStopped()).toBe(true)
  })
})
