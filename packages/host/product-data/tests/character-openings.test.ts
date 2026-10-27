import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { SqliteDatabase } from '../src/storage/sqlite/SqliteDatabase'
import { CharacterRepository } from '../src/domain/personas/CharacterRepository'
import { LocalMediaStore } from '../src/storage/media/LocalMediaStore'
import { CharacterOpeningRepository } from '../src/domain/characterOpenings'
import { SettingLibraryRepository } from '../src/domain/settingLibraries/SettingLibraryRepository'
import { emptyEntry } from '../src/domain/settingLibraries/settingLibraryNormalization'
import { VariableConfigRepository } from '../src/domain/variables/VariableConfigRepository'
import { resolveConversationSeed } from '../src/domain/conversations/conversationSeed'
import { schemaV13Sql } from './helpers/openingSchemaV13'
import { installSchema } from '../src/storage/sqlite/installSchema'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()))
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-openings-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const db = new SqliteDatabase(join(directory, 'product.sqlite')); db.open(); cleanups.push(() => db.close())
  const characters = new CharacterRepository(db, { deleteForCharacter() {}, refreshCharacterIdentity() {} }, new LocalMediaStore(join(directory, 'media')))
  characters.create({ id: 'synthetic-character', name: '合成角色', persona: { opening: '合成初始开场' } })
  return { db, characters, openings: new CharacterOpeningRepository(db), settings: new SettingLibraryRepository(db), variables: new VariableConfigRepository(db) }
}

it('keeps openings independent through setting version changes, deletion, variable validation and disk reopen', () => {
  const f = fixture(), characterId = 'synthetic-character'
  const original = f.openings.get(characterId)
  const content = '合成长开场正文。'.repeat(20_001)
  const messages = [{ ...original.openingMessages[0]!, content, variableVersionId: f.variables.get(characterId).activeVersionId },
    { id: 'synthetic-backup', title: '合成备用开场', content: '合成备用正文', initialVariableStateJson: '{"score":9}' }]
  const saved = f.openings.save(characterId, { ...original, openingMessages: messages })
  const library = f.settings.get(characterId)
  expect(library.entries).toEqual([])
  const version = { ...library.versions[0]!, id: 'synthetic-setting-version', name: '合成设定版本', entries: [emptyEntry('synthetic-setting')] }
  f.settings.save(characterId, { ...library, ...version, activeVersionId: version.id, versions: [version] })
  expect(f.openings.get(characterId)).toEqual(saved)
  expect(resolveConversationSeed(characterId, f.db.db, f.openings, f.variables)).toMatchObject({ openingText: content, selectedOpeningId: messages[0]!.id,
    openingOptions: [{ content, variableVersionId: f.variables.get(characterId).activeVersionId }, { id: 'synthetic-backup', initialVariableStateJson: '{"score":9}' }] })
  const independent = { ...saved.versions[0]!, id: 'synthetic-opening-version', name: '合成独立开场版本' }
  f.openings.save(characterId, { ...saved, name: independent.name, activeVersionId: independent.id, versions: [...saved.versions, independent] })
  expect(f.settings.get(characterId).activeVersionId).toBe(version.id)
  f.settings.save(characterId, { ...f.settings.get(characterId), entries: [] })
  f.db.close(); f.db.open()
  expect(f.openings.get(characterId).openingMessages).toEqual(messages)
  expect(f.settings.get(characterId).entries).toEqual([])
  const before = f.openings.get(characterId)
  expect(() => f.openings.save(characterId, { ...before, openingMessages: [{ ...messages[0]!, variableVersionId: 'missing-variable-version' }] })).toThrow('变量版本不存在')
  expect(f.openings.get(characterId)).toEqual(before)
  f.characters.delete([characterId])
  expect(f.db.native.prepare('SELECT * FROM character_openings').all()).toEqual([])
}, 30_000)

it('migrates every v13 opening version atomically and retains all settings and selected IDs', () => {
  const f = fixture(); f.db.close()
  const database = new Database(':memory:'); cleanups.push(() => database.close()); database.exec(schemaV13Sql)
  database.prepare(`INSERT INTO characters VALUES (${Array.from({ length: 22 }, () => '?').join(',')})`).run(
    'synthetic-character', '合成旧角色', '', '', '', '', 0, 0, '', 0, '合成旧角色', '', '', '', '', '', '', 1, '', 1, 0, 0)
  database.prepare('INSERT INTO setting_libraries VALUES (?, ?, ?, 1, ?, ?, ?)').run('synthetic-character', '合成版本乙', 'version-b', '[]', '[]', '')
  for (const [index, id] of ['version-a', 'version-b'].entries()) {
    database.prepare('INSERT INTO setting_library_versions VALUES (?,?,?, ?,1,?,?,?,?)').run('synthetic-character', id, index, `合成版本${index}`, '[]', '[]', '', '')
    const opening = { id: 'fixed-opening-assistant', kind: 'opening', enabled: index === 1, content: `合成开场${index}`,
      opening_messages: [{ id: `opening-${index}`, title: '合成主开场', content: `合成开场${index}`, variable_version_id: 'synthetic-variable', initial_variable_state: '{"score":7}' },
        { id: `backup-${index}`, title: '合成备用开场', content: '合成备用正文', initial_variable_state: '' }], default_opening_message_id: `opening-${index}` }
    database.prepare('INSERT INTO setting_entry_contents VALUES (?,?,?,?)').run('synthetic-character', opening.id, id, JSON.stringify(opening))
    database.prepare('INSERT INTO setting_library_version_entry_links VALUES (?,?,?,?,?)').run('synthetic-character', id, opening.id, 0, id)
  }
  database.prepare('INSERT INTO setting_library_entry_links VALUES (?,?,0,?)').run('synthetic-character', 'fixed-opening-assistant', 'version-b')
  const rollback = new Database(database.serialize()); cleanups.push(() => rollback.close())
  rollback.prepare("UPDATE setting_entry_contents SET payloadJson=json_set(payloadJson, '$.default_opening_message_id', 'missing') WHERE revisionId='version-b'").run()
  expect(() => installSchema(rollback)).toThrow('主开场白编号必须存在')
  expect(rollback.pragma('user_version', { simple: true })).toBe(13)
  expect(rollback.prepare("SELECT 1 FROM sqlite_master WHERE name='character_openings'").get()).toBeUndefined()
  expect(rollback.prepare('SELECT * FROM setting_entry_contents').all()).toHaveLength(2)
  const divergent = new Database(database.serialize()); cleanups.push(() => divergent.close())
  const currentOpening = JSON.parse((divergent.prepare("SELECT payloadJson FROM setting_entry_contents WHERE revisionId='version-b'").get() as { payloadJson: string }).payloadJson)
  currentOpening.opening_messages[0].content = '合成已保存的当前正文'
  divergent.prepare('INSERT INTO setting_entry_contents VALUES (?,?,?,?)').run('synthetic-character', currentOpening.id, 'live-revision', JSON.stringify(currentOpening))
  divergent.prepare("UPDATE setting_library_entry_links SET revisionId='live-revision'").run()
  installSchema(divergent)
  const separated = JSON.parse((divergent.prepare('SELECT configurationJson FROM character_openings').get() as { configurationJson: string }).configurationJson)
  expect(separated.openingMessages[0].content).toBe('合成已保存的当前正文')
  expect(separated.versions).toHaveLength(3)
  expect(separated.versions.filter((version: any) => version.id !== 'version-a' && version.id !== 'version-b').map((version: any) => version.openingMessages[0].content)).toEqual(['合成开场1'])
  installSchema(database)
  expect(database.pragma('user_version', { simple: true })).toBe(14)
  const value = JSON.parse((database.prepare('SELECT configurationJson FROM character_openings').get() as { configurationJson: string }).configurationJson)
  expect(value.activeVersionId).toBe('version-b')
  expect(value.openingMessages[0]).toMatchObject({ id: 'opening-1', content: '合成开场1', variableVersionId: 'synthetic-variable' })
  expect(value.versions.map((version: any) => [version.id, version.enabled, version.openingMessages.length])).toEqual([['version-a', false, 2], ['version-b', true, 2]])
  expect(database.prepare('SELECT * FROM setting_entry_contents').all()).toEqual([])
  expect(database.prepare('SELECT * FROM setting_library_versions').all()).toHaveLength(2)
  expect(database.pragma('foreign_key_check')).toEqual([])
  expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
}, 30_000)
