import type Database from 'better-sqlite3'
import {
  applyCurrentStorageCleanup,
  hasPreReleaseV2PresetStorage,
  isLegacyDevelopmentV2Storage,
  migration0002,
  normalizeAgentPresetStorage
} from './migrations/0002RuntimeClean'
import { migration0003 } from './migrations/0003SettingPlacements'
import { migration0004 } from './migrations/0004DshTurnBinding'
import { migration0005 } from './migrations/0005RemoveRichMessageHeights'
import { migration0006 } from './migrations/0006RemoveDshOwnedConfiguration'
import { commonSchemaSql } from './migrations/commonSchemaSql'
import { BASELINE_ID, CURRENT_SCHEMA_VERSION } from './schemaVersion'

export { BASELINE_ID, CURRENT_SCHEMA_VERSION } from './schemaVersion'
const PRE_RELEASE_V2_SCHEMA_VERSION = 2
const PRE_RELEASE_V2_BASELINES = [BASELINE_ID, 'eleckoi-common-v1-2026-09-14-runtime-clean'] as const
const migrations = [migration0002, migration0003, migration0004, migration0005, migration0006] as const

function normalized(sql: string): string {
  return sql.replace(/\bIF NOT EXISTS\s+/gi, '').replace(/\s+/g, ' ').replace(/;$/, '').trim()
}

function validateSchema(database: Database.Database): void {
  const installed = database.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL").all() as { name: string; sql: string }[]
  const objects = new Map(installed.map((row) => [row.name, normalized(row.sql)]))
  for (const match of commonSchemaSql.matchAll(/(CREATE (?:TABLE|(?:UNIQUE )?INDEX|VIEW)[\s\S]*?);/g)) {
    const sql = match[1]!
    const name = sql.match(/^CREATE (?:TABLE|(?:UNIQUE )?INDEX|VIEW) (?:IF NOT EXISTS )?`?([\w]+)`?/)?.[1]
    if (!name || objects.get(name) !== normalized(sql)) throw new Error(`公共数据库结构不匹配：${name ?? 'unknown'}。`)
  }
}

function requiredTableNames(): string[] {
  return [...commonSchemaSql.matchAll(/^CREATE TABLE IF NOT EXISTS `([^`]+)`/gm)]
    .map((match) => match[1]!)
}

function validateTableInventory(database: Database.Database): void {
  const installed = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  const required = requiredTableNames()
  if (required.some((name) => !installed.some((table) => table.name === name)) || installed.length !== required.length) {
    throw new Error('数据库业务表不完整或包含未知表，拒绝启动。')
  }
}

function migrate(database: Database.Database, baseline: string, version: number): void {
  let nextVersion = version
  let nextBaseline = baseline
  while (nextVersion < CURRENT_SCHEMA_VERSION) {
    const step = migrations.find((candidate) => candidate.fromVersion === nextVersion)
    if (!step) throw new Error(`数据库迁移链缺少 v${nextVersion} 的下一步，拒绝修改数据。`)
    if (nextBaseline !== BASELINE_ID && !(step.acceptedBaselines as readonly string[]).includes(nextBaseline)) {
      throw new Error(`无法识别数据库 v${nextVersion} 的结构标识，拒绝猜测或删除数据。`)
    }
    database.transaction(() => {
      step.apply(database)
      if (step.toVersion < CURRENT_SCHEMA_VERSION) {
        database.prepare('UPDATE desktop_schema SET baseline = ? WHERE id = 1').run(BASELINE_ID)
      }
      database.pragma(`user_version = ${step.toVersion}`)
    }).immediate()
    nextVersion = step.toVersion
    nextBaseline = BASELINE_ID
  }
}

function normalizePreReleaseV2(database: Database.Database, baseline: string, version: number): void {
  const oldStorage = isLegacyDevelopmentV2Storage(database)
  const oldPresetStorage = !oldStorage && hasPreReleaseV2PresetStorage(database)
  if (version !== PRE_RELEASE_V2_SCHEMA_VERSION || (baseline === BASELINE_ID && !oldStorage && !oldPresetStorage)) return
  if (!(PRE_RELEASE_V2_BASELINES as readonly string[]).includes(baseline)) {
    throw new Error('无法识别开发数据库 v2 的结构标识，拒绝猜测或删除数据。')
  }
  database.transaction(() => {
    if (oldStorage) {
      applyCurrentStorageCleanup(database)
    } else if (oldPresetStorage) {
      normalizeAgentPresetStorage(database)
    } else {
      validateTableInventory(database)
      validateSchema(database)
    }
    database.prepare('UPDATE desktop_schema SET baseline = ? WHERE id = 1').run(BASELINE_ID)
  }).immediate()
}

/**
 * Schema v6 has not shipped yet. Early development databases may still carry
 * execution and file-cleanup tables that are now owned by DSH Session/Agent
 * services, plus retired preference and schema-marker tables. Consolidate
 * that development baseline in place without touching current product data.
 */
function normalizePreReleaseV6(database: Database.Database, version: number): void {
  if (version !== CURRENT_SCHEMA_VERSION) return
  const retired = ['generation_attempts', 'cleanup_operations', 'desktop_preferences', 'desktop_schema'].filter((name) => database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name))
  if (retired.length === 0) return
  database.transaction(() => {
    for (const name of retired) database.exec(`DROP TABLE ${name}`)
  }).immediate()
}

export function installSchema(database: Database.Database): void {
  database.pragma('foreign_keys = ON')
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
  if (tables.length > 0) {
    const version = database.pragma('user_version', { simple: true }) as number
    if (version < CURRENT_SCHEMA_VERSION) {
      if (!tables.some(({ name }) => name === 'desktop_schema')) throw new Error('此文件不是 ElecKoi 数据库的可迁移版本，拒绝修改数据。')
      const registration = database.prepare('SELECT baseline FROM desktop_schema WHERE id = 1').get() as { baseline: string } | undefined
      if (!registration) throw new Error('旧版 ElecKoi 数据库缺少结构登记，拒绝修改数据。')
      normalizePreReleaseV2(database, registration.baseline, version)
      migrate(database, registration.baseline, version)
    }
    normalizePreReleaseV6(database, version)
    if (database.pragma('user_version', { simple: true }) !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`数据库迁移未到达当前版本 ${CURRENT_SCHEMA_VERSION}。`)
    }
    validateTableInventory(database)
    validateSchema(database)
    const foreignKeyErrors = database.pragma('foreign_key_check') as unknown[]
    if (foreignKeyErrors.length > 0 || database.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('数据库迁移后的完整性校验失败。')
    }
    return
  }
  // The canonical schema stamps user_version only after all tables and views exist.
  const ddl = commonSchemaSql.replace(/^PRAGMA foreign_keys = ON;\s*/m, '')
    .replace(/^BEGIN TRANSACTION;\s*/m, '').replace(/^COMMIT;\s*/m, '')
  database.transaction(() => {
    database.exec(ddl)
  }).immediate()
}
