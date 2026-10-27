import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { createCharacterOpenings, characterOpeningVersionSchema, characterOpeningsSchema, type CharacterOpeningVersion } from '@shared/contracts/characterOpenings/schemas'
import { DesktopError } from '@shared/foundation/DesktopError'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { commonSchemaSql } from './commonSchemaSql'

const openingEntryId = 'fixed-opening-assistant'
type Entry = { entryId: string; revisionId: string; payloadJson: string }
type Version = { versionId: string; name: string; createdAt: string; updatedAt: string }

function openingVersion(entries: Entry[], version: Version, fallback: CharacterOpeningVersion): CharacterOpeningVersion {
  const candidates = entries.map(row => JSON.parse(row.payloadJson) as Record<string, unknown>)
    .filter(entry => entry.id === openingEntryId || entry.kind === 'opening')
  if (candidates.length > 1) throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '旧设定库版本包含多个开场白容器，无法确定归属。', { what: '旧开场白配置' })
  const entry = candidates[0]
  const messages = entry?.opening_messages
  return characterOpeningVersionSchema.parse({
    id: version.versionId, name: version.name, enabled: entry ? entry.enabled : fallback.enabled,
    openingMessages: Array.isArray(messages) && messages.length ? messages.map(value => {
      const message = value as Record<string, unknown>
      return { id: message.id, title: message.title, content: message.content,
        ...(message.variable_version_id === undefined ? {} : { variableVersionId: message.variable_version_id }),
        initialVariableStateJson: message.initial_variable_state }
    }) : [{ ...fallback.openingMessages[0]!, content: entry ? entry.content : fallback.openingMessages[0]!.content }],
    defaultOpeningMessageId: Array.isArray(messages) && messages.length ? entry!.default_opening_message_id : fallback.defaultOpeningMessageId,
    createdAt: version.createdAt, updatedAt: version.updatedAt
  })
}

// RETIRE WHEN: 正式停止支持 schema v13 及更早数据库直接升级时，连同迁移登记和旧库回归删除；
// 本机完成升级不构成删除条件。仅在数据库升级事务中读取旧设定库的开场白。
export const migration0014 = {
  fromVersion: 13, toVersion: 14, name: 'independent-character-openings', acceptedBaselines: [] as const,
  apply(database: Database.Database): void {
    const sql = commonSchemaSql.match(/CREATE TABLE IF NOT EXISTS `character_openings`[^;]+;/)?.[0]
    if (!sql) throw new DesktopError(ELECKOI_FAILURE_CODES.dbSchemaMismatch, '缺少角色开场白存储结构。', { what: '角色开场白存储结构' })
    database.exec(sql)
    const characters = database.prepare('SELECT id, showOpening FROM characters').all() as { id: string; showOpening: number }[]
    const insert = database.prepare('INSERT INTO character_openings(characterId, configurationJson) VALUES (?, ?)')
    for (const character of characters) {
      const legacy = database.prepare("SELECT content FROM character_text_contents WHERE characterId=? AND kind='opening'").get(character.id) as { content: string } | undefined
      const fallback = createCharacterOpenings(character.id, legacy?.content ?? '', !!character.showOpening)
      const metadata = database.prepare('SELECT activeVersionId, name, updatedAt FROM setting_libraries WHERE characterId=?').get(character.id) as { activeVersionId: string; name: string; updatedAt: string } | undefined
      const rows = database.prepare('SELECT versionId, name, createdAt, updatedAt FROM setting_library_versions WHERE characterId=? ORDER BY sortIndex, versionId').all(character.id) as Version[]
      const versionEntries = database.prepare(`SELECT c.entryId, c.revisionId, c.payloadJson FROM setting_library_version_entry_links l JOIN setting_entry_contents c ON c.characterId=l.characterId AND c.entryId=l.entryId AND c.revisionId=l.revisionId WHERE l.characterId=? AND l.versionId=? AND (c.entryId='fixed-opening-assistant' OR json_extract(c.payloadJson, '$.kind')='opening') ORDER BY l.sortIndex`)
      const versions = rows.map(version => openingVersion(versionEntries.all(character.id, version.versionId) as Entry[], version, fallback.versions[0]!))
      if (metadata) {
        const currentEntries = database.prepare(`SELECT c.entryId, c.revisionId, c.payloadJson FROM setting_library_entry_links l JOIN setting_entry_contents c ON c.characterId=l.characterId AND c.entryId=l.entryId AND c.revisionId=l.revisionId WHERE l.characterId=? AND (c.entryId='fixed-opening-assistant' OR json_extract(c.payloadJson, '$.kind')='opening') ORDER BY l.sortIndex`).all(character.id) as Entry[]
        const activeId = metadata.activeVersionId || fallback.activeVersionId
        const previous = versions.find(version => version.id === activeId)
        const current = openingVersion(currentEntries, { versionId: activeId, name: metadata.name,
          createdAt: previous?.createdAt ?? metadata.updatedAt, updatedAt: metadata.updatedAt }, fallback.versions[0]!)
        const index = versions.findIndex(version => version.id === current.id)
        if (index < 0) versions.push(current)
        else {
          const previous = versions[index]!
          const content = (value: CharacterOpeningVersion) => JSON.stringify([value.enabled, value.defaultOpeningMessageId, value.openingMessages])
          if (content(previous) !== content(current)) versions.push({ ...previous, id: `opening-archive-${randomUUID()}`, name: `${previous.name || '开场白'}（原版本快照）` })
          versions[index] = current
        }
      }
      const active = metadata ? versions.find(version => version.id === (metadata.activeVersionId || fallback.activeVersionId))! : fallback.versions[0]!
      const value = characterOpeningsSchema.parse({ characterId: character.id, activeVersionId: active.id, name: active.name,
        enabled: active.enabled, openingMessages: active.openingMessages, defaultOpeningMessageId: active.defaultOpeningMessageId,
        versions: versions.length ? versions : fallback.versions })
      insert.run(character.id, JSON.stringify(value))
    }
    const retired = database.prepare("SELECT characterId, entryId, revisionId FROM setting_entry_contents WHERE entryId=? OR json_extract(payloadJson, '$.kind')='opening'").all(openingEntryId) as { characterId: string; entryId: string; revisionId: string }[]
    for (const entry of retired) {
      database.prepare('DELETE FROM setting_library_entry_links WHERE characterId=? AND entryId=? AND revisionId=?').run(entry.characterId, entry.entryId, entry.revisionId)
      database.prepare('DELETE FROM setting_library_version_entry_links WHERE characterId=? AND entryId=? AND revisionId=?').run(entry.characterId, entry.entryId, entry.revisionId)
      database.prepare('DELETE FROM setting_entry_contents WHERE characterId=? AND entryId=? AND revisionId=?').run(entry.characterId, entry.entryId, entry.revisionId)
    }
    database.prepare("DELETE FROM character_text_contents WHERE kind='opening'").run()
    database.exec('ALTER TABLE characters DROP COLUMN showOpening')
  }
} as const
