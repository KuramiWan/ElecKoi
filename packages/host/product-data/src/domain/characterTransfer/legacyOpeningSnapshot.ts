import { DesktopError } from '@shared/foundation/DesktopError'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { characterOpeningsSchema, createCharacterOpenings, type CharacterOpenings } from '@shared/contracts/characterOpenings/schemas'

// RETIRE WHEN: 正式停止支持不含 character_openings 的 v1 角色卡导入时，删除本解码器、
// CharacterTransferService 的 v1 导入分支及对应导入回归。该分支不参与当前配置读写。
export function decodeLegacyOpeningSnapshot(json: string, characterId: string): CharacterOpenings | undefined {
  const root = JSON.parse(json) as { active_version_id: string; versions: Array<{ id: string; name: string; created_at: string; updated_at: string; entries: Array<Record<string, any>> }> }
  const fallback = createCharacterOpenings(characterId)
  let found = false
  const versions = root.versions.map(version => {
    const matches = version.entries.filter(entry => entry.id === 'fixed-opening-assistant' || entry.kind === 'opening')
    if (matches.length > 1) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '旧角色卡版本包含多个开场白容器。', { what: '旧角色卡开场白' })
    const entry = matches[0]
    found ||= Boolean(entry)
    return { id: version.id, name: version.name, enabled: entry ? entry.enabled : true,
      openingMessages: entry?.opening_messages?.length ? entry.opening_messages.map((message: Record<string, unknown>) => ({
        id: message.id, title: message.title, content: message.content,
        ...(message.variable_version_id === undefined ? {} : { variableVersionId: message.variable_version_id }), initialVariableStateJson: message.initial_variable_state
      })) : [{ ...fallback.openingMessages[0]!, content: entry?.content ?? '' }],
      defaultOpeningMessageId: entry?.opening_messages?.length ? entry.default_opening_message_id : fallback.defaultOpeningMessageId,
      createdAt: version.created_at, updatedAt: version.updated_at }
  })
  if (!found) return undefined
  const active = versions.find(version => version.id === root.active_version_id)
  return characterOpeningsSchema.parse({ characterId, activeVersionId: root.active_version_id, name: active?.name,
    enabled: active?.enabled, openingMessages: active?.openingMessages, defaultOpeningMessageId: active?.defaultOpeningMessageId, versions })
}
