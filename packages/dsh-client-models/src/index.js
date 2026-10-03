import z from '@deepseek-ai/schemastery'

export const name = 'eleckoi-client-models'
export const inject = ['settings']
export const Config = z.object({
  entries: z.any().default({}).volatile(),
  schemaVersion: z.number().step(1).min(0).default(0).volatile()
})

const SETTINGS_NAMESPACE = 'eleckoi-client-models'
const PI_AI_NAMESPACE = 'llm-pi-ai'
const DEEPSEEK_PROVIDER = 'deepseek-official'
const SUBAGENT_MODEL_NAMESPACE = 'subagent-model-selection-settings'
const MODEL_SETTINGS_SCHEMA_VERSION = 2
const OBSOLETE_SUBAGENT_PROVIDERS = new Set(['deepseek-default'])

/**
 * Migrate model settings that were persisted by older ElecKoi releases.
 * Registered DSH and third-party providers are deliberately left untouched.
 */
export async function migrateModelSettings(settings) {
  const descriptors = settings.describe()
  const modelSettings = descriptors.find(row => row.ns === SETTINGS_NAMESPACE)
  const piAi = descriptors.find(row => row.ns === PI_AI_NAMESPACE)
  const entries = modelSettings?.value?.entries ?? {}

  // One-time settings migrations. They can be removed once the minimum
  // supported ElecKoi version has already persisted the current schema.
  if (modelSettings && (modelSettings.value?.schemaVersion ?? 0) < MODEL_SETTINGS_SCHEMA_VERSION) {
    const previousVersion = modelSettings.value?.schemaVersion ?? 0
    const migratedEntries = { ...entries }
    // schema v0 -> v1: generic pi-ai profiles were sometimes labelled as the
    // dedicated DeepSeek provider even though their actual adapter was custom.
    if (previousVersion < 1) {
      for (const [id, entry] of Object.entries(migratedEntries)) {
        if (id !== DEEPSEEK_PROVIDER && entry?.provider === 'deepseek' && piAi?.value?.providers?.[id]) {
          migratedEntries[id] = { ...entry, provider: 'custom' }
        }
      }
    }
    // schema v1 -> v2: the official route is permanent. Older clients used a
    // product-side hidden marker when its configuration was cleared, leaving a
    // visible provider card backed by an empty form.
    if (previousVersion < 2 && migratedEntries[DEEPSEEK_PROVIDER]?.hidden === true) {
      const { hidden: _hidden, ...entry } = migratedEntries[DEEPSEEK_PROVIDER]
      if (Object.keys(entry).length === 0) delete migratedEntries[DEEPSEEK_PROVIDER]
      else migratedEntries[DEEPSEEK_PROVIDER] = entry
    }
    const ops = Object.entries(migratedEntries)
      .filter(([id, entry]) => entry !== entries[id])
      .map(([id, entry]) => ({ op: 'set', path: ['entries', id], value: entry }))
    for (const id of Object.keys(entries)) {
      if (!(id in migratedEntries)) ops.push({ op: 'unset', path: ['entries', id] })
    }
    ops.push({ op: 'set', path: ['schemaVersion'], value: MODEL_SETTINGS_SCHEMA_VERSION })
    await settings.mutate(SETTINGS_NAMESPACE, ops, modelSettings.revision)
  }

  // Temporary upgrade cleanup for the known pre-0.2.3 placeholder route.
  // Remove together with the settings migrations after the supported upgrade floor
  // guarantees that no persisted subagent selection can still contain it.
  const subagent = descriptors.find(row => row.ns === SUBAGENT_MODEL_NAMESPACE)
  const allowedModels = Array.isArray(subagent?.value?.allowedModels) ? subagent.value.allowedModels : []
  const retainedModels = allowedModels.filter(route => !OBSOLETE_SUBAGENT_PROVIDERS.has(route?.provider))
  if (subagent && retainedModels.length !== allowedModels.length) {
    const ops = [{ op: 'set', path: ['allowedModels'], value: retainedModels }]
    if (subagent.value?.enabled === true && retainedModels.length === 0) {
      ops.push({ op: 'set', path: ['enabled'], value: false })
    }
    await settings.mutate(SUBAGENT_MODEL_NAMESPACE, ops, subagent.revision)
  }
}

export async function apply(ctx) {
  await migrateModelSettings(ctx.settings)
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
}
