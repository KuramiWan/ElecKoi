import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import type Database from 'better-sqlite3'
import { commonSchemaSql } from './commonSchemaSql'

/** Remove retired template storage; regex and script versions retain their exact rows. */
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
  },
} as const
