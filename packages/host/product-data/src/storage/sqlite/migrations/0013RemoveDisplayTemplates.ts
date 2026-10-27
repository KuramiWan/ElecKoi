import { extractCharacterOpenings } from './characterOpenings'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import type Database from 'better-sqlite3'
import { commonSchemaSql } from './commonSchemaSql'

/** Remove retired template storage; regex and script versions retain their exact rows; openings belong to the character. */
export const migration0013 = {
  fromVersion: 12, toVersion: 13, name: 'remove-display-templates', acceptedBaselines: [] as const,
  apply(database: Database.Database): void {
    database.exec('DROP TABLE display_template_libraries')
    database.exec('ALTER TABLE editor_library_versions RENAME TO retired_editor_library_versions')
    const sql = commonSchemaSql.match(/CREATE TABLE IF NOT EXISTS `editor_library_versions`[^;]+;/)?.[0]
    if (!sql) throw new DesktopError(ELECKOI_FAILURE_CODES.dbSchemaMismatch, '缺少正式编辑器版本结构。', { what: '正式编辑器版本结构' })
    database.exec(sql)
    database.exec("INSERT INTO editor_library_versions SELECT * FROM retired_editor_library_versions WHERE kind IN ('scripts', 'regex')")
    database.exec('DROP TABLE retired_editor_library_versions')
    extractCharacterOpenings(database)
    // RETIRE WHEN: 停止支持 v12 及更早数据库直接升级后，连同整个 0013 步骤和旧库回归一起移除；当前开发库只做一次性补齐。
    for (const table of ['global_setting_libraries', 'global_setting_library_state']) {
      const ddl = commonSchemaSql.match(new RegExp('CREATE TABLE IF NOT EXISTS `' + table + '`[^;]+;'))?.[0]
      if (!ddl) throw new DesktopError(ELECKOI_FAILURE_CODES.dbSchemaMismatch, '缺少全局设定库结构。', { what: '全局设定库结构' })
      database.exec(ddl)
    }
  },
} as const
