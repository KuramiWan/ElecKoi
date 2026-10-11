import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { MessageDisplayProjector } from '../packages/host/product-data/src/domain/conversations/MessageDisplayProjector'
import { mvuMessageDisplayCompatibility } from '@eleckoi/compatibility-mvu'
import { preserveMessageRenderKeys } from '../apps/web/src/modules/chat/hooks/useConversationMessages.js'

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)) }
const scopes = ['globalRules', 'agentPresetRules', 'characterRules']
const sourceMessage = { id: 'assistant-1', conversationId: 'chat-1', role: 'assistant',
  content: '[CARD]', status: 'complete', variableStateJson: '{}', createdAt: '2026-10-10T00:00:00.000Z' }
const makeCollection = scope => ({ characterId: 'character-1', agentPresetId: 'preset-1',
  agentPresetName: 'Synthetic preset', agentPresetRegexRevision: 'a'.repeat(64), revision: 1,
  globalRules: [], characterRules: [], agentPresetRules: [],
  [scope]: [{ id: 'card', name: 'Synthetic display', pattern: '/\\[CARD\\]/g',
    replacement: '<section>Old card</section>', targets: ['AiOutput', 'UserInput'],
    enabled: true, displayOnly: true, promptOnly: false, runOnEdit: false, order: 0 }],
  versions: [], activeVersionId: '' })

function feed() {
  const streams = new Set()
  return {
    open(signal) {
      const state = { queue: [{ kind: 'snapshot' }], done: false, wake: undefined }
      streams.add(state)
      const stop = () => { state.done = true; streams.delete(state); state.wake?.() }
      signal?.addEventListener('abort', stop, { once: true })
      return (async function* () {
        try {
          while (!state.done) {
            if (state.queue.length) { yield state.queue.shift(); continue }
            await new Promise(resolve => { state.wake = resolve })
            state.wake = undefined
          }
        } finally { signal?.removeEventListener('abort', stop); stop() }
      })()
    },
    emit(change) { for (const state of streams) { state.queue.push(change); state.wake?.() } }
  }
}

function plugin(path) {
  let registration
  runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    AbortController, console, window: { __ModuleLoader__: { load: value => { registration = value } } }
  })
  return dshClientPlugin(registration)
}

async function mount(scope) {
  let collection = makeCollection(scope)
  let regexRules
  let catalog
  let rendered = []
  const cleanups = []
  const changes = feed()
  const conversationChanges = feed()
  const projector = new MessageDisplayProjector(mvuMessageDisplayCompatibility)
  const projectDisplay = vi.fn(async (conversationId, input) => ({ ok: true,
    value: input.map((message, index) => {
      const projected = projector.project({ ...message, conversationId }, collection, undefined, input.length - index - 1)
      return { id: message.id, sourceContent: message.content,
        displayContent: projected.displayContent ?? projected.content, variableStateJson: projected.variableStateJson }
    }) }))
  const readRules = vi.fn(async () => ({ ok: true, value: structuredClone(collection) }))
  const saveRules = vi.fn(async (_characterId, value) => {
    collection = { ...structuredClone(value), revision: collection.revision + 1 }
    changes.emit({ kind: 'configuration', domain: 'regexRules' })
    return { ok: true, value: structuredClone(collection) }
  })
  const remote = {
    eleckoiCharacterConfiguration: {
      changes: signal => changes.open(signal), readRegexRules: readRules,
      saveRegexRules: saveRules,
      importRegexRules: async (_characterId, _fallbackScope, documents) => ({ ok: true,
        value: { collection: (await saveRules(_characterId, { ...collection, [scope]: JSON.parse(documents[0].json) })).value,
          importedFileCount: 1, importedRuleCount: 1, failedFileNames: [] } })
    },
    eleckoiConversations: {
      changes: signal => conversationChanges.open(signal),
      list: async () => ({ ok: true, value: [{ id: 'chat-1' }] }),
      details: async () => ({ ok: true, value: { conversation: { id: 'chat-1' },
        metadata: { characterId: 'character-1' }, runtimeSessionId: '', messages: [{ ...sourceMessage }],
        hasMore: false, beforeSequence: null } }), projectDisplay
    }
  }
  const common = { remote, on: () => () => {}, effect: run => { cleanups.push(run()) } }
  plugin('../packages/client/features/dsh-client-character-configuration/src/client.js').apply({ ...common,
    provide: (name, value) => { if (name === 'eleckoiRegexRules') regexRules = value } })
  plugin('../packages/client/features/dsh-client-conversations/src/client.js').apply({ ...common,
    eleckoiRegexRules: regexRules, provide: (_name, value) => { catalog = value } })
  catalog.subscribeDetails(() => {
    const details = catalog.getDetailsSnapshot().details
    if (details) rendered = preserveMessageRenderKeys(rendered, details.messages)
  })
  await settle()
  await catalog.open('chat-1')
  await settle()
  return { regexRules, catalog, readRules, saveRules, projectDisplay, changes,
    collection: () => collection, rendered: () => rendered,
    close: () => { for (const cleanup of cleanups.reverse()) cleanup() } }
}

describe('regex display refresh', () => {
  it('invalidates the Host cache after an active preset regex revision change', () => {
    const original = makeCollection('agentPresetRules')
    const projector = new MessageDisplayProjector(mvuMessageDisplayCompatibility)
    expect(projector.project(sourceMessage, original).displayContent).toContain('Old card')
    const updated = structuredClone(original)
    updated.agentPresetRules[0].replacement = '<section>New card</section>'
    updated.agentPresetRegexRevision = 'b'.repeat(64)
    expect(projector.project(sourceMessage, updated).displayContent).toContain('New card')
    expect(updated.revision).toBe(original.revision)
  })

  for (const scope of scopes) {
    it.each(['plain', 'empty', 'disable', 'delete', 'pattern', 'depth', 'prompt', 'order', 'version', 'import'])(
      `refreshes an existing message after ${scope} %s without regeneration`, async action => {
        const app = await mount(scope)
        try {
          expect(app.rendered()[0].displayContent).toContain('Old card')
          const updated = structuredClone(app.collection())
          const rule = updated[scope][0]
          let expected = '[CARD]'
          if (action === 'plain' || action === 'import') { rule.replacement = expected = 'New plain text' }
          if (action === 'empty') rule.replacement = expected = ''
          if (action === 'disable') rule.enabled = false
          if (action === 'delete') updated[scope] = []
          if (action === 'pattern') rule.pattern = '/UNMATCHED/g'
          if (action === 'depth') rule.minDepth = 1
          if (action === 'prompt') { rule.displayOnly = false; rule.promptOnly = true }
          if (action === 'order') {
            rule.replacement = 'intermediate'
            updated[scope].push({ ...rule, id: 'second', pattern: '/intermediate/g', replacement: 'New order', order: 1 })
            await app.regexRules.save('character-1', updated)
            await settle()
            expect(app.rendered()[0].displayContent).toBe('New order')
            rule.order = 1
            updated[scope][1].order = 0
            updated.revision = app.collection().revision
            expected = 'intermediate'
          }
          if (action === 'version') {
            updated.versions = [{ id: 'off', name: 'Disabled version', globalEnabledIds: [], agentPresetEnabledIds: [], characterEnabledIds: [] }]
            updated.activeVersionId = 'off'
          }
          if (action === 'import') await app.regexRules.import('character-1', updated, 'Character', [{ displayName: 'synthetic.json', json: JSON.stringify(updated[scope]) }])
          else await app.regexRules.save('character-1', updated)
          await settle()
          expect(app.catalog.getDetailsSnapshot().details.messages[0].displayContent).toBe(expected)
          expect(app.rendered()[0].displayContent).toBe(expected)
          expect(app.rendered()[0].content).toBe('[CARD]')
        } finally { app.close() }
      })
  }

  it.each(scopes)('refreshes external %s changes without ever opening the regex editor', async scope => {
    const app = await mount(scope)
    try {
      expect(app.regexRules.getSnapshot('character-1').status).toBe('ready')
      app.collection()[scope][0].replacement = '<section>New external card</section>'
      if (scope === 'agentPresetRules') app.collection().agentPresetRegexRevision = 'b'.repeat(64)
      else app.collection().revision += 1
      app.changes.emit({ kind: 'configuration', domain: scope === 'agentPresetRules' ? 'agentPresets' : 'regexRules',
        ...(scope === 'characterRules' ? { characterId: 'character-1' } : {}) })
      await settle()
      expect(app.rendered()[0].displayContent).toContain('New external card')
    } finally { app.close() }
  })

  it.each(scopes)('uses saved %s edits when returning from configuration to chat', async scope => {
    const app = await mount(scope)
    try {
      app.catalog.activate('')
      const calls = app.projectDisplay.mock.calls.length
      const updated = structuredClone(app.collection())
      updated[scope][0].replacement = 'Saved away from chat'
      await app.regexRules.save('character-1', updated)
      await settle()
      expect(app.projectDisplay.mock.calls.length).toBe(calls)
      await app.catalog.open('chat-1')
      await settle()
      expect(app.catalog.getDetailsSnapshot().details.messages[0].displayContent).toBe('Saved away from chat')
      expect(app.rendered()[0].displayContent).toBe('Saved away from chat')
      expect(app.rendered()[0].content).toBe('[CARD]')
    } finally { app.close() }
  })

  it('keeps the last projected display while awaiting a saved rule, and rejects its late superseded result', async () => {
    const app = await mount('characterRules')
    try {
      const project = app.projectDisplay.getMockImplementation()
      const deferred = []
      app.projectDisplay.mockImplementation(async (...args) => {
        const result = await project(...args)
        return new Promise(resolve => deferred.push(() => resolve(result)))
      })
      const first = structuredClone(app.collection())
      first.characterRules[0].replacement = 'First edit'
      await app.regexRules.save('character-1', first)
      await settle()
      expect(deferred.length).toBeGreaterThan(0)
      expect(app.rendered()[0].displayContent).toContain('Old card')
      app.projectDisplay.mockImplementation(project)
      const second = structuredClone(app.collection())
      second.characterRules[0].replacement = 'Latest edit'
      await app.regexRules.save('character-1', second)
      await settle()
      expect(app.rendered()[0].displayContent).toBe('Latest edit')
      deferred.forEach(resolve => resolve())
      await settle()
      expect(app.rendered()[0].displayContent).toBe('Latest edit')
    } finally { app.close() }
  })

  it('retains the saved display if saving rules fails', async () => {
    const app = await mount('characterRules')
    try {
      app.saveRules.mockRejectedValueOnce(new Error('Synthetic save failure'))
      const updated = structuredClone(app.collection())
      updated.characterRules[0].replacement = 'Unsaved edit'
      await expect(app.regexRules.save('character-1', updated)).rejects.toThrow('Synthetic save failure')
      await settle()
      expect(app.rendered()[0].displayContent).toContain('Old card')
      expect(app.collection().characterRules[0].replacement).toContain('Old card')
    } finally { app.close() }
  })

  it('rejects a pending display result after switching chats', async () => {
    const app = await mount('characterRules')
    try {
      let finish = () => {}
      app.projectDisplay.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const updated = structuredClone(app.collection())
      updated.characterRules[0].replacement = 'Late edit'
      await app.regexRules.save('character-1', updated)
      await settle()
      app.catalog.activate('chat-2')
      finish({ ok: true, value: [{ id: sourceMessage.id, sourceContent: sourceMessage.content,
        displayContent: 'Late edit', variableStateJson: '{}' }] })
      await settle()
      expect(app.catalog.getDetailsSnapshot()).toMatchObject({ id: 'chat-2', status: 'loading', details: null })
    } finally { app.close() }
  })
})
