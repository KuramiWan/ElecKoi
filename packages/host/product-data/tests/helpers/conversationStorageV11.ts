import type Database from 'better-sqlite3'
import { commonSchemaSql } from '../../src/storage/sqlite/migrations/commonSchemaSql'
import { conversationStatesSql, conversationStatesIndexSql, legacySettingSnapshotsSql } from '../../src/storage/sqlite/migrations/conversationStateStorage'
import { regexLibrariesSql } from '../../src/storage/sqlite/migrations/regexLibraryEnablement'
import { displayTemplatesSql, editorLibraryVersionsSql } from '../../src/storage/sqlite/migrations/0012EditorConfiguration'
import { restoreEditorSchemaV12 } from './editorSchemaV12'

export const legacyResponsesSql = commonSchemaSql.match(/CREATE TABLE IF NOT EXISTS `agent_responses`[^;]+/)![0]
  .replace(', `runtimeThreadId` TEXT NOT NULL', ', `variableStateJson` TEXT NOT NULL, `runtimeThreadId` TEXT NOT NULL')
  .replace(', PRIMARY KEY(`id`)', ", `storedRegexRulesJson` TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(`id`)")

export const legacyCommonSchemaSql = commonSchemaSql.replace(conversationStatesSql + ';', legacySettingSnapshotsSql + ';')
  .replace(/CREATE TABLE IF NOT EXISTS `editor_library_versions`[^;]+;/, editorLibraryVersionsSql + ';')
  .replace(/PRAGMA user_version = \d+;/, displayTemplatesSql + ';\nPRAGMA user_version = 12;')
  .replace(regexLibrariesSql + ';', '')
  .replace(conversationStatesIndexSql + ';', 'CREATE INDEX IF NOT EXISTS `index_agent_setting_snapshots_conversationId` ON `agent_setting_snapshots` (`conversationId`);')
  .replace(/CREATE TABLE IF NOT EXISTS `agent_responses`[^;]+/, legacyResponsesSql)

/** 合成旧结构 fixture；只允许在没有回复和状态历史的测试库中转换。 */
export function restoreLegacyConversationStorage(database: Database.Database): void {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name='display_template_libraries'").get()) restoreEditorSchemaV12(database)
  database.exec('DROP TABLE IF EXISTS regex_libraries')
  if ((database.prepare('SELECT count(*) AS n FROM agent_responses').get() as { n: number }).n) throw new Error('Fixture already has replies')
  if ((database.prepare('SELECT count(*) AS n FROM conversation_state_snapshots').get() as { n: number }).n) throw new Error('Fixture already has state history')
  database.exec('DROP TABLE conversation_state_snapshots; DROP TABLE agent_responses;')
  database.exec(legacyResponsesSql)
  database.exec(commonSchemaSql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS `index_agent_responses_[^;]+;/g)!.join('\n'))
  database.exec(legacySettingSnapshotsSql)
  database.exec('CREATE INDEX IF NOT EXISTS `index_agent_setting_snapshots_conversationId` ON `agent_setting_snapshots` (`conversationId`)')
}

export function insertLegacyReply(database: Database.Database, conversationId: string, options: {
  userId: string; replyId: string; before: string; after: string; turn: number | null; responseIndex?: number
}): void {
  const branch = database.prepare('SELECT activeBranchId FROM agent_conversations WHERE id=?').get(conversationId) as { activeBranchId: string }
  const now = '2026-10-01T00:00:00.000Z'
  for (const [id, kind] of [[`user-${conversationId}`, 'user'], [`assistant-${conversationId}`, 'assistant']]) {
    database.prepare(`INSERT OR IGNORE INTO conversation_speakers
      (id,conversationId,sourceSpeakerId,kind,displayName,avatarAssetId) VALUES (?,?,?,?,?,'')`)
      .run(id, conversationId, id, kind, 'Synthetic speaker')
  }
  if (!database.prepare('SELECT 1 FROM agent_turns WHERE id=?').get(options.userId)) {
    database.prepare("INSERT INTO agent_turns(id,conversationId,speakerId,kind,createdAt,variableStateJson) VALUES (?,?,?,'user',?,?)")
      .run(options.userId, conversationId, `user-${conversationId}`, now, options.before)
    const next = (database.prepare('SELECT COALESCE(MAX(sequence),-1)+1 AS n FROM agent_branch_turns WHERE branchId=?').get(branch.activeBranchId) as { n: number }).n
    database.prepare('INSERT INTO agent_branch_turns VALUES (?,?,?)').run(branch.activeBranchId, next, options.userId)
    database.prepare("INSERT INTO agent_setting_snapshots VALUES (?,'turn',?,'[]')").run(conversationId, options.userId)
  }
  database.prepare(`INSERT INTO agent_responses
    (id,conversationId,turnId,responseIndex,speakerId,status,createdAt,variableStateJson,runtimeThreadId,dshTurn)
    VALUES (?,?,?,?,?,'completed',?,?,?,?)`).run(options.replyId, conversationId, options.userId,
      options.responseIndex ?? 0, `assistant-${conversationId}`, now, options.after, conversationId, options.turn)
}
