import { describe, expect, it, vi } from 'vitest'
import { migrateModelSettings } from '../packages/dsh-client-models/src/index.js'

describe('ElecKoi model settings migration', () => {
  it('removes only known obsolete child-model routes and preserves all registered providers', async () => {
    const settings = {
      describe: () => [
        { ns: 'eleckoi-client-models', value: { schemaVersion: 1, entries: {
          'config-owned': { name: '测试', provider: 'custom', model: 'owned-model' },
          'deepseek-official': { hidden: true },
        } }, revision: 4 },
        { ns: 'llm-pi-ai', value: { providers: {
          'config-owned': { models: [{ id: 'owned-model' }] },
          'native-google': { models: [{ id: 'native-model' }] },
        } }, revision: 7 },
        { ns: 'llm-deepseek', value: { models: [{ id: 'deepseek-flash' }] }, revision: 9 },
        { ns: 'subagent-model-selection-settings', value: { enabled: true, allowedModels: [
          { provider: 'config-owned', model: 'owned-model' },
          { provider: 'deepseek-official', model: 'deepseek-flash' },
          { provider: 'native-google', model: 'native-model' },
          { provider: 'deepseek-default', model: 'deepseek-flash' },
        ] }, revision: 11 },
      ],
      mutate: vi.fn(async () => undefined),
    }

    await migrateModelSettings(settings)

    expect(settings.mutate).toHaveBeenCalledWith('eleckoi-client-models', [
      { op: 'unset', path: ['entries', 'deepseek-official'] },
      { op: 'set', path: ['schemaVersion'], value: 2 },
    ], 4)
    expect(settings.mutate).toHaveBeenCalledWith('subagent-model-selection-settings', [
      { op: 'set', path: ['allowedModels'], value: [
        { provider: 'config-owned', model: 'owned-model' },
        { provider: 'deepseek-official', model: 'deepseek-flash' },
        { provider: 'native-google', model: 'native-model' },
      ] },
    ], 11)
  })

  it('does not maintain a provider whitelist', async () => {
    const settings = {
      describe: () => [
        { ns: 'eleckoi-client-models', value: { schemaVersion: 2, entries: {
          'config-owned': { name: '测试' },
          'deepseek-official': { name: 'DeepSeek' },
        } }, revision: 1 },
        { ns: 'llm-pi-ai', value: { providers: { 'config-owned': { models: [] } } }, revision: 2 },
        { ns: 'llm-deepseek', value: { models: [{ id: 'deepseek-flash' }] }, revision: 3 },
        { ns: 'subagent-model-selection-settings', value: { enabled: true, allowedModels: [
          { provider: 'deepseek-official', model: 'deepseek-flash' },
        ] }, revision: 4 },
      ],
      mutate: vi.fn(async () => undefined),
    }

    await migrateModelSettings(settings)

    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('turns off child model selection when every authorized route is a known obsolete provider', async () => {
    const settings = {
      describe: () => [
        { ns: 'eleckoi-client-models', value: { schemaVersion: 2, entries: {} }, revision: 1 },
        { ns: 'llm-pi-ai', value: { providers: {} }, revision: 2 },
        { ns: 'llm-deepseek', value: { models: [] }, revision: 3 },
        { ns: 'subagent-model-selection-settings', value: { enabled: true, allowedModels: [
          { provider: 'deepseek-default', model: 'deepseek-flash' },
        ] }, revision: 4 },
      ],
      mutate: vi.fn(async () => undefined),
    }

    await migrateModelSettings(settings)

    expect(settings.mutate).toHaveBeenCalledWith('subagent-model-selection-settings', [
      { op: 'set', path: ['allowedModels'], value: [] },
      { op: 'set', path: ['enabled'], value: false },
    ], 4)
  })

  it('migrates generic DeepSeek-labelled profiles to the current custom-provider identity once', async () => {
    const settings = {
      describe: () => [
        { ns: 'eleckoi-client-models', value: { entries: {
          'config-legacy': { name: '旧配置', provider: 'deepseek', model: 'legacy-model' },
          'deepseek-official': { name: 'DeepSeek', provider: 'deepseek', model: 'deepseek-flash' },
        } }, revision: 6 },
        { ns: 'llm-pi-ai', value: { providers: {
          'config-legacy': { models: [{ id: 'legacy-model' }] },
        } }, revision: 7 },
        { ns: 'llm-deepseek', value: { models: [{ id: 'deepseek-flash' }] }, revision: 8 },
      ],
      mutate: vi.fn(async () => undefined),
    }

    await migrateModelSettings(settings)

    expect(settings.mutate).toHaveBeenCalledExactlyOnceWith('eleckoi-client-models', [
      { op: 'set', path: ['entries', 'config-legacy'], value: {
        name: '旧配置', provider: 'custom', model: 'legacy-model',
      } },
      { op: 'set', path: ['schemaVersion'], value: 2 },
    ], 6)
  })
})
