import { restoreLegacyOpeningStorage } from './legacyOpeningStorage'
import type Database from 'better-sqlite3'
import { displayTemplatesSql, editorLibraryVersionsSql } from '../../src/storage/sqlite/migrations/0012EditorConfiguration'

/** Recreate the exact v12 editor schema around the fixture's existing product records. */
export function restoreEditorSchemaV12(database: Database.Database): void {
  restoreLegacyOpeningStorage(database)
  database.transaction(() => {
    database.exec('ALTER TABLE editor_library_versions RENAME TO fixture_editor_versions')
    database.exec(editorLibraryVersionsSql)
    database.exec('INSERT INTO editor_library_versions SELECT * FROM fixture_editor_versions; DROP TABLE fixture_editor_versions')
    database.exec(displayTemplatesSql)
    database.pragma('user_version = 12')
  }).immediate()
}
