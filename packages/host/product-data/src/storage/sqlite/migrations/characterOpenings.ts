import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { createCharacterOpenings, type CharacterOpeningMessage } from '@shared/contracts/characterOpenings/schemas'
import { appendCharacterOpeningMessages } from '@shared/foundation/characterOpenings'
import { decodeLegacySettingOpening } from '@shared/foundation/legacySettingOpenings'
import { DesktopError } from '@shared/foundation/DesktopError'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { commonSchemaSql } from './commonSchemaSql'

const openingEntryId = 'fixed-opening-assistant'
type Entry = { payloadJson: string }
function entry(rows: Entry[]): Record<string, unknown> | undefined {
  if (rows.length > 1) throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '旧设定库包含多个开场白容器，无法确定归属。', { what: '旧开场白配置' })
  return rows[0] ? JSON.parse(rows[0].payloadJson) as Record<string, unknown> : undefined
}

// RETIRE WHEN: 正式停止支持 schema v12 及更早数据库直接升级时，连同 0013 调用和旧库回归删除。
// 此函数属于 v12→v13 的同一事务，旧设定库的所有不同开场白归入同一列表。
export function extractCharacterOpenings(database: Database.Database): void {
  const sql = commonSchemaSql.match(/CREATE TABLE IF NOT EXISTS `character_openings`[^;]+;/)?.[0]
  if (!sql) throw new DesktopError(ELECKOI_FAILURE_CODES.dbSchemaMismatch, '缺少角色开场白存储结构。', { what: '角色开场白存储结构' })
  database.exec(sql)
  const characters = database.prepare('SELECT id, showOpening FROM characters').all() as { id: string; showOpening: number }[]
  const insert = database.prepare('INSERT INTO character_openings(characterId, configurationJson) VALUES (?, ?)')
  const currentEntries = database.prepare(`SELECT c.payloadJson FROM setting_library_entry_links l JOIN setting_entry_contents c ON c.characterId=l.characterId AND c.entryId=l.entryId AND c.revisionId=l.revisionId WHERE l.characterId=? AND (c.entryId='fixed-opening-assistant' OR json_extract(c.payloadJson, '$.kind')='opening') ORDER BY l.sortIndex`)
  const historicalEntries = database.prepare(`SELECT l.versionId,c.payloadJson FROM setting_library_version_entry_links l JOIN setting_entry_contents c ON c.characterId=l.characterId AND c.entryId=l.entryId AND c.revisionId=l.revisionId JOIN setting_library_versions v ON v.characterId=l.characterId AND v.versionId=l.versionId WHERE l.characterId=? AND (c.entryId='fixed-opening-assistant' OR json_extract(c.payloadJson, '$.kind')='opening') ORDER BY v.sortIndex,v.versionId,l.sortIndex`)
  for (const character of characters) {
    const legacy = database.prepare("SELECT content FROM character_text_contents WHERE characterId=? AND kind='opening'").get(character.id) as { content: string } | undefined
    const fallback = createCharacterOpenings(character.id, legacy?.content ?? '', !!character.showOpening)
    const current = decodeLegacySettingOpening(entry(currentEntries.all(character.id) as Entry[]), fallback)
    const incoming: CharacterOpeningMessage[] = []
    const seenVersions = new Set<string>()
    for (const row of historicalEntries.all(character.id) as (Entry & { versionId: string })[]) {
      if (seenVersions.has(row.versionId)) throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '旧设定库包含多个开场白容器，无法确定归属。', { what: '旧开场白配置' })
      seenVersions.add(row.versionId)
      const alternatives = decodeLegacySettingOpening(entry([row]), fallback)
      for (const message of alternatives.openingMessages) incoming.push(message)
    }
    const value = appendCharacterOpeningMessages(current, incoming, () => `opening-${randomUUID()}`)
    insert.run(character.id, JSON.stringify(value))
  }
  const retired = database.prepare("SELECT characterId, entryId, revisionId FROM setting_entry_contents WHERE entryId=? OR json_extract(payloadJson, '$.kind')='opening'").all(openingEntryId) as { characterId: string; entryId: string; revisionId: string }[]
  for (const item of retired) {
    database.prepare('DELETE FROM setting_library_entry_links WHERE characterId=? AND entryId=? AND revisionId=?').run(item.characterId,item.entryId,item.revisionId)
    database.prepare('DELETE FROM setting_library_version_entry_links WHERE characterId=? AND entryId=? AND revisionId=?').run(item.characterId,item.entryId,item.revisionId)
    database.prepare('DELETE FROM setting_entry_contents WHERE characterId=? AND entryId=? AND revisionId=?').run(item.characterId,item.entryId,item.revisionId)
  }
  database.prepare("DELETE FROM character_text_contents WHERE kind='opening'").run()
  database.exec('ALTER TABLE characters DROP COLUMN showOpening')
}
