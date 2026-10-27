import { randomUUID } from 'node:crypto'
import { DesktopError } from '@shared/foundation/DesktopError'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { createCharacterOpenings, type CharacterOpenings } from '@shared/contracts/characterOpenings/schemas'
import { appendCharacterOpeningMessages } from '@shared/foundation/characterOpenings'
import { decodeLegacySettingOpening } from '@shared/foundation/legacySettingOpenings'

// RETIRE WHEN: 正式停止支持不含 character_openings 的 v1 角色卡导入时，删除本解码器、
// CharacterTransferService 的 v1 导入分支及对应导入回归。当前列表只由独立开场白配置读写。
export function decodeLegacyOpeningSnapshot(json: string, characterId: string): CharacterOpenings | undefined {
  const root = JSON.parse(json) as { active_version_id: string; versions: Array<{ id: string; entries: Array<Record<string, unknown>> }> }
  const decoded = root.versions.map(item => {
    const matches = item.entries.filter(entry => entry.id === 'fixed-opening-assistant' || entry.kind === 'opening')
    if (matches.length > 1) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '旧角色卡包含多个开场白容器。', { what: '旧角色卡开场白' })
    return { id: item.id, value: matches[0] ? decodeLegacySettingOpening(matches[0], createCharacterOpenings(characterId)) : undefined }
  })
  if (!decoded.some(item => item.value)) return undefined
  const active = decoded.find(item => item.id === root.active_version_id)
  if (!active) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '旧角色卡选中的设定库不存在。', { what: '旧角色卡设定库' })
  return appendCharacterOpeningMessages(active.value ?? createCharacterOpenings(characterId), decoded.flatMap(item => item.value?.openingMessages ?? []), () => `opening-${randomUUID()}`)
}
