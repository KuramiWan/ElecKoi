import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CharacterTransferService } from '../packages/host/product-data/src/domain/characterTransfer/CharacterTransferService'
import { CharacterRepository } from '../packages/host/product-data/src/domain/personas/CharacterRepository'
import { SettingLibraryRepository } from '../packages/host/product-data/src/domain/settingLibraries'
import { VariableConfigRepository } from '../packages/host/product-data/src/domain/variables/VariableConfigRepository'
import { RegexRuleRepository } from '../packages/host/product-data/src/domain/regexRules/RegexRuleRepository'
import { AgentPresetRepository } from '../packages/host/product-data/src/domain/agentPresets'
import { ScriptLibraryRepository } from '../packages/host/product-data/src/domain/scripts'
import { createScriptLibraryRepository } from './helpers/scriptLibraryOwners'
import { SqliteDatabase } from '../packages/host/product-data/src/storage/sqlite/SqliteDatabase'
import { LocalMediaStore } from '@eleckoi/dsh-product-data/media'

const fixtures: Array<{ database: SqliteDatabase; directory: string }> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) { f.database.close(); rmSync(f.directory, { recursive: true, force: true }) }
})
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-native-transfer-'))
  const database = new SqliteDatabase(join(directory, 'product.sqlite'))
  database.open(); fixtures.push({ database, directory })
  const scripts = createScriptLibraryRepository(database)
  const characters = new CharacterRepository(database, { deleteForCharacter() {}, refreshCharacterIdentity() {} }, new LocalMediaStore(join(directory, 'media')))
  const presets = new AgentPresetRepository(database, undefined, scripts)
  presets.ensureInitialized()
  const transfer = new CharacterTransferService(database, characters, new SettingLibraryRepository(database),
    new VariableConfigRepository(database), new RegexRuleRepository(database, presets), undefined, scripts)
  return { scripts, characters, presets, transfer, database }
}
const script = { type: 'script' as const, id: 'synthetic-module', name: 'Synthetic module', enabled: true,
  content: "import { derive } from '../helpers/derive.mjs'; export default () => derive(3);",
  info: '', data: { setting: 2 }, button: { enabled: false, buttons: [] }, export_with: { data: true, button: true },
  runtime: { kind: 'eleckoi-module', apiVersion: 1 } }
const trees = [{ type: 'folder' as const, id: 'synthetic-folder', name: 'Synthetic folder', enabled: true, icon: '', color: '', scripts: [script] }]
const helper = 'export const derive = n => n * 4;'
const binary = Buffer.from([0, 255, 128, 3, 0, 42])
function files(path: string) {
  mkdirSync(join(path, 'helpers'), { recursive: true }); mkdirSync(join(path, 'assets'), { recursive: true })
  writeFileSync(join(path, 'helpers', 'derive.mjs'), helper)
  writeFileSync(join(path, 'assets', 'data.bin'), binary)
  writeFileSync(join(path, 'helpers', 'empty.json'), '')
}
function input(exported: { fileName: string; mimeType: string; base64: string }) {
  return { displayName: exported.fileName, mimeType: exported.mimeType, base64: exported.base64 }
}
function assertWorkspace(scripts: ScriptLibraryRepository, scope: 'character' | 'preset', ownerId: string) {
  const workspace = scripts.workspace(scope, ownerId)
  expect(readFileSync(join(workspace.path, workspace.entries[0]!.file), 'utf8')).toBe(script.content)
  expect(readFileSync(join(workspace.path, 'helpers', 'derive.mjs'), 'utf8')).toBe(helper)
  expect(Buffer.from(scripts.asset(scope, ownerId, workspace.version, 'assets/data.bin'))).toEqual(binary)
  expect(readFileSync(join(workspace.path, 'helpers', 'empty.json'))).toHaveLength(0)
  expect(scripts.get(scope, ownerId)).toMatchObject({ trees, enabled: false, variables: { librarySetting: 5 } })
}

describe('native script file transfer', () => {
  it.each(['json', 'png'] as const)('carries character helper paths and exact binary bytes through %s into a different workspace', format => {
    const source = setup(), target = setup()
    source.characters.create({ id: 'synthetic-character', name: 'Synthetic character' })
    source.scripts.save({ ...source.scripts.get('character', 'synthetic-character'), trees, enabled: true, variables: { librarySetting: 5 } })
    files(source.scripts.workspace('character', 'synthetic-character').path)
    source.scripts.save({ ...source.scripts.get('global', ''), trees: [{ ...script, id: 'synthetic-global', content: 'export const globalValue = 7;' }] })
    const exported = source.transfer.export('synthetic-character', format)
    const preview = target.transfer.prepare([input(exported)], 'eleckoi')
    expect(preview.items[0]).toMatchObject({ importable: true, errorMessage: '' })
    const id = target.transfer.commit(preview.token).importedCharacterIds[0]!
    assertWorkspace(target.scripts, 'character', id)
    expect(target.scripts.get('global', '').trees).toEqual([])
    const row = target.database.native.prepare('SELECT * FROM script_libraries WHERE scope=? AND ownerId=?').get('character', id)
    expect(JSON.stringify(row)).not.toContain(script.content)
    expect(JSON.stringify(row)).not.toContain(helper)
    expect(target.database.native.pragma('foreign_key_check')).toEqual([])
  }, 30000)

  it.each(['json', 'png'] as const)('carries preset helper files through %s without copying shared or role scripts', format => {
    const source = setup(), target = setup(), presetId = source.presets.create('Synthetic preset').id
    source.scripts.save({ ...source.scripts.get('preset', presetId), trees, enabled: true, variables: { librarySetting: 5 } })
    files(source.scripts.workspace('preset', presetId).path)
    const exported = source.presets.export(presetId, format)
    const imported = target.presets.import(input(exported), 'eleckoi')
    assertWorkspace(target.scripts, 'preset', imported.preset.id)
    expect(target.scripts.get('global', '').trees).toEqual([])
    expect(target.characters.get().items).toEqual([])
    expect(target.database.native.pragma('foreign_key_check')).toEqual([])
  }, 30000)

  it('does not store registered entry bodies a second time among portable helper files', () => {
    const f = setup()
    f.scripts.save({ ...f.scripts.get('global', ''), trees })
    files(f.scripts.workspace('global', '').path)
    const portable = f.scripts.portable('global', '')
    expect(portable.files?.map(file => file.path)).toEqual(['assets/data.bin', 'helpers/derive.mjs', 'helpers/empty.json'])
    expect(portable.trees).toEqual(trees)
  }, 30000)

  it.each([
    { files: [{ path: '../outside.js', data: '' }] },
    { files: [{ path: 'helpers\\derive.js', data: '' }] },
    { files: [{ path: 'helpers/derive.js', data: 'not-base64!' }] },
    { files: [{ path: 'helpers/derive.js', data: '' }, { path: 'helpers/derive.js', data: '' }] },
  ])('reports malformed attachments before importing a card: %j', ({ files: attachments }) => {
    const source = setup(), target = setup()
    source.characters.create({ id: 'synthetic-character', name: 'Synthetic character' })
    const root = JSON.parse(Buffer.from(source.transfer.export('synthetic-character', 'json').base64, 'base64').toString('utf8'))
    root.script_library.files = attachments
    const preview = target.transfer.prepare([{ displayName: 'synthetic.json', mimeType: 'application/json',
      base64: Buffer.from(JSON.stringify(root)).toString('base64') }], 'eleckoi')
    expect(preview.items[0]).toMatchObject({ importable: false, errorMessage: expect.any(String) })
    expect(preview.items[0]!.errorMessage.length).toBeGreaterThan(0)
    expect(target.characters.get().items).toEqual([])
    expect(target.database.native.prepare('SELECT * FROM script_libraries').all()).toEqual([])
  }, 30000)

  it('rejects an attachment that overwrites the registered entry and preserves other libraries', () => {
    const source = setup(), target = setup()
    source.characters.create({ id: 'synthetic-character', name: 'Synthetic character' })
    source.scripts.save({ ...source.scripts.get('character', 'synthetic-character'), trees })
    const root = JSON.parse(Buffer.from(source.transfer.export('synthetic-character', 'json').base64, 'base64').toString('utf8'))
    root.script_library.files = [{ path: source.scripts.workspace('character', 'synthetic-character').entries[0]!.file,
      data: Buffer.from('export const wrong = true;').toString('base64') }]
    const shared = target.scripts.save({ ...target.scripts.get('global', ''), trees })
    const preview = target.transfer.prepare([{ displayName: 'synthetic.json', mimeType: 'application/json',
      base64: Buffer.from(JSON.stringify(root)).toString('base64') }], 'eleckoi')
    expect(() => target.transfer.commit(preview.token)).toThrow('不能覆盖登记的入口')
    expect(target.characters.get().items).toEqual([])
    expect(target.scripts.get('global', '')).toEqual(shared)
    expect(target.database.native.prepare('SELECT scope FROM script_libraries').all()).toEqual([{ scope: 'global' }])
  }, 30000)

  it('rolls back entry and binary helper files together when the import commit fails', () => {
    const source = setup(), target = setup(), presetId = source.presets.create('Synthetic preset').id
    source.scripts.save({ ...source.scripts.get('preset', presetId), trees })
    files(source.scripts.workspace('preset', presetId).path)
    const previous = target.presets.catalog(), exported = source.presets.export(presetId, 'json')
    const transaction = target.database.withWriteTx.bind(target.database)
    const failure = vi.spyOn(target.database, 'withWriteTx').mockImplementation(operation => transaction(db => {
      const result = operation(db)
      if (target.database.native.prepare('SELECT scope FROM script_libraries').get()) throw new Error('Synthetic commit failure')
      return result
    }))
    expect(() => target.presets.import(input(exported), 'eleckoi')).toThrow('Synthetic commit failure')
    failure.mockRestore()
    expect(target.presets.catalog()).toEqual(previous)
    expect(target.database.native.prepare('SELECT * FROM script_libraries').all()).toEqual([])
    expect(target.scripts.files.names('preset').length).toBe(0)
    expect(readFileSync(join(source.scripts.workspace('preset', presetId).path, 'assets/data.bin'))).toEqual(binary)
  }, 30000)

  it('refuses a mixed export if helper files change during the snapshot', () => {
    const f = setup()
    f.scripts.save({ ...f.scripts.get('global', ''), trees })
    const workspace = f.scripts.workspace('global', '')
    files(workspace.path)
    const read = f.scripts.files.readBytes.bind(f.scripts.files)
    let changed = false
    vi.spyOn(f.scripts.files, 'readBytes').mockImplementation(name => {
      const bytes = read(name)
      if (!changed && name.endsWith('/helpers/derive.mjs')) {
        changed = true; writeFileSync(join(workspace.path, 'helpers', 'derive.mjs'), 'export const derive = n => n * 8;')
      }
      return bytes
    })
    expect(() => f.scripts.portable('global', '')).toThrow('导出期间发生变化')
    expect(readFileSync(join(workspace.path, workspace.entries[0]!.file), 'utf8')).toBe(script.content)
  }, 30000)

  it.each([false, true])('removes only the deleted preset workspace, with a saved library record: %s', saved => {
    const f = setup(), presetId = f.presets.create('Synthetic preset').id
    if (saved) f.scripts.save({ ...f.scripts.get('preset', presetId), trees })
    const owned = f.scripts.workspace('preset', presetId).path, shared = f.scripts.workspace('global', '').path
    files(owned); files(shared)
    expect(f.scripts.exists('preset', presetId)).toBe(saved)
    f.presets.delete(presetId)
    expect(existsSync(join(owned, 'helpers', 'derive.mjs'))).toBe(false)
    expect(existsSync(join(owned, 'assets', 'data.bin'))).toBe(false)
    expect(readFileSync(join(shared, 'assets', 'data.bin'))).toEqual(binary)
  }, 30000)

  it('does not treat a database-only snapshot in another directory as a portable source backup', async () => {
    const source = setup(), target = setup()
    source.scripts.save({ ...source.scripts.get('global', ''), trees })
    files(source.scripts.workspace('global', '').path)
    const backupPath = join(fixtures[fixtures.length - 1]!.directory, 'database-only.sqlite')
    await source.database.backupTo(backupPath)
    const database = new SqliteDatabase(backupPath)
    database.open()
    try {
      const scripts = createScriptLibraryRepository(database)
      expect(scripts.exists('global', '')).toBe(true)
      expect(() => scripts.get('global', '')).toThrow()
      expect(scripts.files.names('global')).toEqual([])
      expect(source.scripts.get('global', '').trees).toEqual(trees)
      expect(target.scripts.get('global', '').trees).toEqual([])
    } finally { database.close() }
  }, 30000)

  it('restores an unsaved workspace after an interrupted owner deletion, using the owner commit state', () => {
    const f = setup(), presetId = f.presets.create('Synthetic preset').id
    const owned = f.scripts.workspace('preset', presetId).path
    files(owned)
    const transaction = f.database.withWriteTx.bind(f.database)
    const failure = vi.spyOn(f.database, 'withWriteTx').mockImplementation(operation => transaction(db => {
      operation(db); throw new Error('Synthetic SQL failure')
    }))
    const interrupted = vi.spyOn(f.scripts.files as any, 'rollback').mockImplementation(() => { throw new Error('Synthetic process interruption') })
    expect(() => f.presets.delete(presetId)).toThrow('Synthetic process interruption')
    expect(existsSync(join(owned, 'assets', 'data.bin'))).toBe(false)
    failure.mockRestore(); interrupted.mockRestore()
    f.database.close(); f.database.open()
    const scripts = createScriptLibraryRepository(f.database)
    expect(scripts.exists('preset', presetId)).toBe(false)
    expect(f.presets.catalog().presets.some(preset => preset.id === presetId)).toBe(true)
    expect(readFileSync(join(owned, 'helpers', 'derive.mjs'), 'utf8')).toBe(helper)
    expect(readFileSync(join(owned, 'assets', 'data.bin'))).toEqual(binary)
  }, 30000)
})
