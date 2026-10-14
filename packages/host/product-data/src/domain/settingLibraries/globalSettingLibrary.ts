import { GLOBAL_SETTING_LIBRARY_ID, GLOBAL_SETTING_RUNTIME_PREFIX } from '@shared/contracts/settingLibrary/scope'
import type { SettingLibrary } from '@shared/contracts/settingLibrary/schemas'
import type { AgentSettingLibraryRuntimeContext } from '@shared/contracts/agent/runtime'

/** Stable scoped identities allow the existing Agent and per-chat overlay to handle global entries. */
export function globalSettingRuntimeContext(library: SettingLibrary): AgentSettingLibraryRuntimeContext | undefined {
  if (!library.entries.length) return undefined
  const id = (value: string) => value ? `${GLOBAL_SETTING_RUNTIME_PREFIX}${value}` : ''
  return {
    characterId: GLOBAL_SETTING_LIBRARY_ID, name: library.name,
    entries: library.entries.map(entry => ({ ...entry, id: id(entry.id), groupId: id(entry.groupId), promptPositionId: id(entry.promptPositionId), sendGroupId: id(entry.sendGroupId || '') })),
    groups: library.groups.map(group => ({ ...group, id: id(group.id), parentId: id(group.parentId) })),
    promptPositions: library.promptPositions.map(position => ({ ...position, id: id(position.id) }))
  }
}
