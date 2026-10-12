import { AuthorApiError, AUTHOR_SETTING_ENTRY_MUTABLE_FIELDS, type AuthorSettingLibrary, type AuthorSettingEntryUpdate, type AuthorPreset, type AuthorPresetCatalog } from '@eleckoi/author-sdk'
import type { AuthorVariableBinding } from '@eleckoi/author-sdk/browser'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingLibrary, AgentPreset, AgentPresetCatalog } from '@eleckoi/dsh-product-api/types'
import type {} from '@eleckoi/dsh-product-api/remote'

function content(library: SettingLibrary): AuthorSettingLibrary {
  const { characterId, name, entries, groups, promptPositions } = library
  return structuredClone({ characterId, name, entries, groups, promptPositions })
}

function entryId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new AuthorApiError('INVALID_PARAMS', '条目编号不能为空')
  return value
}

function findEntry(entries: AuthorSettingLibrary['entries'], value: unknown) {
  const id = entryId(value), entry = entries.find(item => item.id === id)
  if (!entry) throw new AuthorApiError('ENTRY_NOT_FOUND', `找不到条目：${id}`)
  return structuredClone(entry)
}

function entryUpdates(value: unknown): AuthorSettingEntryUpdate[] {
  if (!Array.isArray(value)) throw new AuthorApiError('INVALID_PARAMS', '条目修改必须是数组')
  const allowed = new Set<string>(AUTHOR_SETTING_ENTRY_MUTABLE_FIELDS)
  for (const update of value) {
    if (!update || typeof update !== 'object' || Array.isArray(update)
      || Object.keys(update).some(key => key !== 'id' && key !== 'changes')) {
      throw new AuthorApiError('INVALID_PARAMS', '条目修改只能包含编号和 changes')
    }
    entryId(update.id)
    if (!update.changes || typeof update.changes !== 'object' || Array.isArray(update.changes)) {
      throw new AuthorApiError('INVALID_PARAMS', '条目 changes 必须是对象')
    }
    for (const field of Object.keys(update.changes)) {
      if (!allowed.has(field)) throw new AuthorApiError('INVALID_PARAMS', `不支持修改条目字段：${field}`)
    }
  }
  return value
}

/** Reads and writes the bound character's original library, without expanding author text. */
export function createNativeSettingLibraryBindings(
  remote: Context['remote']['eleckoiCharacterConfiguration'],
  characterId: string,
  assertActive: () => void
): Record<string, AuthorVariableBinding> {
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); assertActive() }
  const read = async (signal: AbortSignal) => {
    signal.throwIfAborted()
    if (!characterId) return null
    const result = await remote.readSettingLibrary(characterId)
    if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
    return result.value
  }
  const requireCharacter = () => {
    if (!characterId) throw new AuthorApiError('CHARACTER_REQUIRED', '页面尚未绑定角色设定库')
    return characterId
  }
  const methods: Record<string, AuthorVariableBinding> = {
    'settingLibrary.current': async (_params, { signal }) => {
      const library = await read(signal)
      return library ? content(library) : null
    },
    'settingLibrary.getSummary': async (_params, { signal }) => {
      const library = await read(signal)
      return library ? { characterId: library.characterId, name: library.name, activeVersionId: library.activeVersionId,
        entryCount: library.entries.length, groupCount: library.groups.length } : null
    },
    'settingLibrary.replace': async (params, { signal }) => {
      const result = await remote.replaceSettingLibraryContent(requireCharacter(), params.library as AuthorSettingLibrary, signal)
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return content(result.value)
    },
    'settingLibrary.getEntry': async (params, { signal }) => {
      const library = await read(signal)
      if (!library) throw new AuthorApiError('CHARACTER_REQUIRED', '页面尚未绑定角色设定库')
      return findEntry(library.entries, params.id)
    },
    'settingLibrary.updateEntry': async (params, { signal }) => {
      const result = await remote.updateSettingLibraryEntries(requireCharacter(),
        entryUpdates([{ id: entryId(params.id), changes: params.changes }]), signal)
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return structuredClone(result.value[0]!)
    },
    'settingLibrary.updateEntries': async (params, { signal }) => {
      const result = await remote.updateSettingLibraryEntries(requireCharacter(), entryUpdates(params.updates), signal)
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return structuredClone(result.value)
    },
  }
  return Object.fromEntries(Object.entries(methods).map(([method, run]) => [method, async (params, options) => {
    check(options.signal)
    const result = await run(params, options)
    check(options.signal)
    return result
  }]))
}

function presetContent(preset: AgentPreset): AuthorPreset {
  const { id, name, activeVersionId, entries, groups, promptPositions } = preset
  return structuredClone({ id, name, activeVersionId, entries, groups, promptPositions })
}

function presetCatalog(catalog: AgentPresetCatalog): AuthorPresetCatalog {
  return { activePresetId: catalog.activePresetIds.roleplay, items: catalog.presets.filter(preset => preset.purpose === "roleplay").map(({ id, name, activeVersionId, entryCount }) =>
    ({ id, name, activeVersionId, entryCount })) }
}

/** Preset writes explicitly target the existing shared original, not a chat-local mirror. */
export function createNativePresetBindings(
  remote: Context['remote']['eleckoiAgentPresets'],
  assertActive: () => void
): Record<string, AuthorVariableBinding> {
  const read = async (id: unknown, signal: AbortSignal) => {
    if (typeof id !== 'string' || !id) throw new AuthorApiError('INVALID_PARAMS', '预设编号不能为空')
    signal.throwIfAborted()
    const result = await remote.read(id)
    if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
    return result.value
  }
  const catalog = async (signal: AbortSignal) => {
    signal.throwIfAborted()
    const result = await remote.catalog()
    if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
    return result.value
  }
  const update = async (presetId: unknown, updates: AuthorSettingEntryUpdate[], signal: AbortSignal) => {
    if (typeof presetId !== 'string' || !presetId) throw new AuthorApiError('INVALID_PARAMS', '预设编号不能为空')
    const result = await remote.updateEntries(presetId, entryUpdates(updates), signal)
    if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
    return structuredClone(result.value)
  }
  const methods: Record<string, AuthorVariableBinding> = {
    'presets.list': async (_params, { signal }) => presetCatalog(await catalog(signal)),
    'presets.current': async (_params, { signal }) => {
      const selected = await catalog(signal)
      return selected.activePresetIds.roleplay ? presetContent(await read(selected.activePresetIds.roleplay, signal)) : null
    },
    'presets.get': async (params, { signal }) => presetContent(await read(params.presetId, signal)),
    'presets.getEntry': async (params, { signal }) => findEntry((await read(params.presetId, signal)).entries, params.id),
    'presets.updateEntry': async (params, { signal }) => (await update(params.presetId,
      [{ id: entryId(params.id), changes: params.changes as AuthorSettingEntryUpdate['changes'] }], signal))[0]!,
    'presets.updateEntries': async (params, { signal }) => update(params.presetId, params.updates as AuthorSettingEntryUpdate[], signal),
    'presets.select': async (params, { signal }) => {
      if (typeof params.presetId !== 'string' || !params.presetId) throw new AuthorApiError('INVALID_PARAMS', '预设编号不能为空')
      if ((await read(params.presetId, signal)).purpose !== 'roleplay') throw new AuthorApiError('INVALID_PARAMS', '角色对话只能选择角色扮演预设')
      signal.throwIfAborted()
      const result = await remote.setActive(params.presetId)
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return presetCatalog(result.value)
    },
  }
  return Object.fromEntries(Object.entries(methods).map(([method, run]) => [method, async (params, options) => {
    options.signal.throwIfAborted(); assertActive()
    const result = await run(params, options)
    options.signal.throwIfAborted(); assertActive()
    return result
  }]))
}
