import type Database from 'better-sqlite3'
import { commonSchemaSql } from '../../packages/host/product-data/src/storage/sqlite/migrations/commonSchemaSql'

/** Exact pre-purpose schema for migration fixtures. */
export const schemaV10Sql = commonSchemaSql
  .replaceAll(", `purpose` TEXT NOT NULL DEFAULT 'roleplay'", '')
  .replace('`purpose` TEXT NOT NULL, `activePresetId` TEXT NOT NULL, PRIMARY KEY(`purpose`)', '`singletonId` INTEGER NOT NULL, `activePresetId` TEXT NOT NULL, PRIMARY KEY(`singletonId`)')
  .replace('PRAGMA user_version = 11', 'PRAGMA user_version = 10')

export function restoreV10PresetFixture(database: Database.Database): void {
  const selected = database.prepare("SELECT activePresetId FROM agent_preset_state WHERE purpose='roleplay'").get() as { activePresetId: string } | undefined
  database.exec('ALTER TABLE agent_presets DROP COLUMN purpose; ALTER TABLE agent_preset_library_groups DROP COLUMN purpose; DROP TABLE agent_preset_state;')
  database.exec('CREATE TABLE IF NOT EXISTS `agent_preset_state` (`singletonId` INTEGER NOT NULL, `activePresetId` TEXT NOT NULL, PRIMARY KEY(`singletonId`))')
  if (selected) database.prepare('INSERT INTO agent_preset_state VALUES (1,?)').run(selected.activePresetId)
}
