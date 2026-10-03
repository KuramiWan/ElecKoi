import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  migrateLegacyGlobalModelSelection,
  refreshSessionModelSnapshot
} from '../packages/dsh-client-roleplay/src/host/model-selection-migration.mjs'
import { writeSessionSnapshot } from '../packages/dsh-client-roleplay/src/host/session-snapshot.mjs'

const cleanups = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function fixture() {
  let selected = { provider: 'legacy-label', model: 'synthetic-model' }
  const saved = []
  const routes = {
    'current-route-a1b2': {
      displayName: 'legacy-label',
      models: [{ id: 'synthetic-model' }]
    }
  }
  const ctx = {
    agentDefaultModel: {
      currentSelection: () => ({ ...selected }),
      saveSelection: async next => { saved.push(next); selected = { ...next } }
    },
    llm: {
      resolveModelInfo: async (provider, model) => {
        if (provider !== 'current-route-a1b2' || model !== 'synthetic-model') {
          throw new Error(`no adapter registered for provider "${provider}"`)
        }
        return { contextWindow: 64_000, defaultMaxTokens: 8_000 }
      }
    },
    settings: { describe: () => [
      { ns: 'llm-pi-ai', value: { providers: routes } },
      { ns: 'eleckoi-client-models', value: { entries: {
        'current-route-a1b2': { parameters: { 'synthetic-model': { temperature: 0.4 } } }
      } } }
    ] },
    logger: { info() {} }
  }
  return { ctx, saved, select: value => { selected = value } }
}

describe('legacy global model upgrade', () => {
  it('persists the unique current provider route behind an old display label', async () => {
    const f = fixture()
    await expect(migrateLegacyGlobalModelSelection(f.ctx)).resolves.toMatchObject({
      selection: { provider: 'current-route-a1b2', model: 'synthetic-model' }
    })
    expect(f.saved).toEqual([{ provider: 'current-route-a1b2', model: 'synthetic-model' }])
  })

  it('rewrites an old Session model snapshot before resume', async () => {
    const f = fixture()
    f.select({ provider: 'current-route-a1b2', model: 'synthetic-model' })
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-model-upgrade-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    writeSessionSnapshot(root, 'synthetic-session', {
      conversationId: 'synthetic-conversation',
      model: { provider: 'legacy-label', model: 'synthetic-model' }
    })
    await refreshSessionModelSnapshot(f.ctx, root, 'synthetic-session')
    const snapshot = JSON.parse(readFileSync(join(root, 'synthetic-session.json'), 'utf8'))
    expect(snapshot.model).toEqual({
      configId: 'current-route-a1b2', provider: 'current-route-a1b2', model: 'synthetic-model',
      temperature: 0.4, maxTokens: 8_000, contextWindow: 64_000
    })
  })

  it('uses the only current configured route when an old generated route no longer exists', async () => {
    const f = fixture()
    f.select({ provider: 'openai-responses-a1b2c3d4e5f6', model: 'synthetic-model' })
    f.ctx.settings.describe = () => [
      { ns: 'llm-pi-ai', value: { providers: {
        'current-route-a1b2': { displayName: 'Current', models: [{ id: 'synthetic-model' }] }
      } } },
      { ns: 'eleckoi-client-models', value: { entries: {
        'current-route-a1b2': { name: 'Current', model: 'synthetic-model', parameters: {} }
      } } }
    ]

    await expect(migrateLegacyGlobalModelSelection(f.ctx)).resolves.toMatchObject({
      selection: { provider: 'current-route-a1b2', model: 'synthetic-model' }
    })
    expect(f.saved).toEqual([{ provider: 'current-route-a1b2', model: 'synthetic-model' }])
  })

  it('falls back from the retired DeepSeek label to the current dedicated route', async () => {
    const f = fixture()
    f.select({ provider: 'deepseek-default', model: 'synthetic-model' })
    f.ctx.settings.describe = () => []
    f.ctx.llm.resolveModelInfo = async (provider, model) => {
      if (provider !== 'deepseek-official' || model !== 'synthetic-model') {
        throw new Error(`no adapter registered for provider "${provider}"`)
      }
      return { contextWindow: 64_000, defaultMaxTokens: 8_000 }
    }

    await expect(migrateLegacyGlobalModelSelection(f.ctx)).resolves.toMatchObject({
      selection: { provider: 'deepseek-official', model: 'synthetic-model' }
    })
    expect(f.saved).toEqual([{ provider: 'deepseek-official', model: 'synthetic-model' }])
  })
})
