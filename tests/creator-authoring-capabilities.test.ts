import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { creatorCapabilities, creatorToolsets } from '../packages/host/product-data/src/domain/creatorStudio/capabilities'
import { VARIABLE_INITIALIZATION_OBJECT_ID } from '../packages/shared/src/contracts/variables/schemas'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs() })
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-creator-authoring-'))
  cleanups.push(() => { const child = relative(tmpdir(), root); if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected cleanup path'); rmSync(root, { recursive: true, force: true }) })
  vi.stubEnv('ELECKOI_DATABASE_PATH', join(root, 'product.sqlite')); vi.stubEnv('ELECKOI_MEDIA_ROOT', join(root, 'media'))
  const ctx = new Context(); cleanups.push(() => ctx.fiber.dispose()); await ctx.plugin(productDataPlugin)
  const data = ctx.eleckoiProductData, characterId = 'synthetic-authoring-character'
  data.createCharacter({ id: characterId, name: '合成编辑目标' })
  data.createCharacter({ id: 'synthetic-other-character', name: '合成其他目标' })
  data.saveSettingLibrary(characterId, data.readSettingLibrary(characterId))
  const operations = creatorCapabilities(data)
  const call = (id: string, input: unknown = {}) => operations.find(item => item.id === id)!.execute(characterId, input) as any
  return { data, call, operations, characterId }
}

describe('Creator authoring matches the native setting, schema, script and regex contracts', { timeout: 30_000 }, () => {
  it('enables and disables keyword matching in an atomic batch, preserving content, keywords, versions and other characters', async () => {
    const f = await fixture(), other = f.data.saveSettingLibrary('synthetic-other-character', f.data.readSettingLibrary('synthetic-other-character'))
    const entries = ['first', 'second'].map(title => f.call('settings.create', { title, content: `Synthetic ${title}`, keywords: ['synthetic-trigger'], keywordIgnoreCase: false }))
    const before = f.data.readSettingLibrary(f.characterId)
    f.call('settings.update_many', { updates: entries.map(entry => ({ id: entry.id, changes: { agentReadStrategy: 'keyword' } })) })
    let library = f.data.readSettingLibrary(f.characterId)
    for (const entry of entries) {
      expect(f.call('settings.read', { id: entry.id })).toMatchObject({ content: entry.content, keywords: ['synthetic-trigger'], keywordIgnoreCase: false, agentReadStrategy: 'keyword' })
      expect(library.versions.find(version => version.id === library.activeVersionId)!.entries.find(item => item.id === entry.id)!.agentReadStrategy).toBe('keyword')
    }
    expect(f.call('settings.list').entries.filter((entry: { keywordMatch: boolean }) => entry.keywordMatch)).toHaveLength(2)
    expect(f.data.readSettingLibrary('synthetic-other-character')).toEqual(other)
    expect(library.activeVersionId).toBe(before.activeVersionId)
    const unchanged = library
    for (const updates of [
      [{ id: entries[0].id, changes: { enabled: false } }, { id: 'synthetic-missing', changes: { enabled: false } }],
      [{ id: entries[0].id, changes: { enabled: false } }, { id: entries[1].id, changes: { agentReadStrategy: 'required', contentMode: 'ejs' } }],
      [{ id: entries[0].id, changes: { enabled: false } }, { id: entries[0].id, changes: { enabled: true } }],
    ]) {
      expect(() => f.call('settings.update_many', { updates })).toThrow()
      expect(f.data.readSettingLibrary(f.characterId)).toEqual(unchanged)
    }
    f.call('settings.update', { id: entries[0].id, changes: { agentReadStrategy: 'normal' } })
    library = f.data.readSettingLibrary(f.characterId)
    expect(library.entries.find(item => item.id === entries[0].id)).toMatchObject({ agentReadStrategy: 'normal', keywords: ['synthetic-trigger'], content: entries[0].content })
    expect(library.entries.find(item => item.id === entries[1].id)!.agentReadStrategy).toBe('keyword')
  })

  it('renames and moves setting folders without changing entry identities, rejects cycles and removes exactly the requested subtree', async () => {
    const f = await fixture(), group = (name: string, parentId = '') => f.call('settings.create_group', { name, parentId, order: 1, treeViewOrder: 1 })
    const root = group('Synthetic root'), child = group('Synthetic child', root.id), sibling = group('Synthetic sibling')
    const entry = f.call('settings.create', { title: 'Synthetic nested entry', groupId: child.id, content: 'Synthetic content' })
    const other = f.call('settings.create', { title: 'Synthetic retained entry', groupId: sibling.id, content: 'Synthetic retained content' })
    expect(f.call('settings.update_group', { id: root.id, changes: { name: 'Synthetic renamed root', parentId: sibling.id } })).toMatchObject({ id: root.id, parentId: sibling.id })
    let library = f.data.readSettingLibrary(f.characterId)
    expect(library.entries.find(item => item.id === entry.id)).toMatchObject({ groupId: child.id, content: entry.content })
    expect(library.versions.find(version => version.id === library.activeVersionId)!.groups.find(item => item.id === root.id)!.name).toBe('Synthetic renamed root')
    for (const input of [{ id: sibling.id, changes: { parentId: child.id } }, { id: root.id, changes: { parentId: 'synthetic-missing' } }, { id: 'synthetic-missing', changes: { name: 'Synthetic name' } }]) {
      expect(() => f.call('settings.update_group', input)).toThrow()
      expect(f.data.readSettingLibrary(f.characterId)).toEqual(library)
    }
    expect(f.call('settings.remove_group', { id: root.id })).toEqual({ removedGroupIds: [root.id, child.id], removedEntryIds: [entry.id] })
    library = f.data.readSettingLibrary(f.characterId)
    expect(library.groups.map(item => item.id)).toEqual([sibling.id])
    expect(library.entries.find(item => item.id === other.id)).toMatchObject({ groupId: sibling.id, content: other.content })
    expect(library.entries.some(item => item.id === entry.id)).toBe(false)
  })

  it('updates only the selected character group and preserves other characters and profile fields', async () => {
    const f = await fixture(), before = f.data.readCharacters()
    const selected = before.items.find(item => item.id === f.characterId)!
    expect(f.call('character.update', { group: 'Synthetic selected group' })).toMatchObject({ group: 'Synthetic selected group', persona: selected.persona })
    expect(f.data.readCharacters().items.filter(item => item.id !== f.characterId)).toEqual(before.items.filter(item => item.id !== f.characterId))
    expect(f.call('character.update', { group: '' }).group).toBe('')
  })

  it('edits variable groups, preserves variable identities, rejects invalid parents and protects runtime configuration', async () => {
    const f = await fixture(), group = (name: string, parentId = '') => f.call('variables.create_object', { name, parentId, enabled: true, description: '', updateRule: '', dynamicKey: false, order: 1, treeViewOrder: 1 })
    const root = group('SyntheticRoot'), child = group('SyntheticChild', root.id), sibling = group('SyntheticSibling')
    const variable = f.call('variables.create', { title: 'score', objectId: child.id, enabled: true, type: 'number', defaultValue: '20', description: '', updateRule: '', readMode: 'required', order: 1, treeViewOrder: 1 })
    expect(f.call('variables.update_object', { id: root.id, changes: { name: 'SyntheticRenamed', description: 'Synthetic description' } })).toMatchObject({ id: root.id, name: 'SyntheticRenamed' })
    const config = f.data.readVariableConfig(f.characterId)
    expect(config.variables.find(item => item.id === variable.id)).toEqual(variable)
    expect(JSON.parse(config.initialStateJson)).toMatchObject({ SyntheticRenamed: { SyntheticChild: { score: 20 } } })
    expect(config.versions.find(version => version.id === config.activeVersionId)!.objects.find(item => item.id === root.id)!.name).toBe('SyntheticRenamed')
    for (const input of [{ id: root.id, changes: { parentId: child.id } }, { id: root.id, changes: { parentId: 'synthetic-missing' } },
      { id: root.id, changes: { parentId: VARIABLE_INITIALIZATION_OBJECT_ID } }, { id: VARIABLE_INITIALIZATION_OBJECT_ID, changes: { name: 'Synthetic forbidden name' } }]) {
      expect(() => f.call('variables.update_object', input)).toThrow()
      expect(f.data.readVariableConfig(f.characterId)).toEqual(config)
    }
    expect(() => f.call('variables.remove_object', { id: VARIABLE_INITIALIZATION_OBJECT_ID })).toThrow('不能删除')
    expect(f.call('variables.remove_object', { id: root.id })).toEqual({ removedObjectIds: [root.id, child.id], removedVariableIds: [variable.id] })
    expect(f.data.readVariableConfig(f.characterId).objects.map(item => item.id)).toEqual([VARIABLE_INITIALIZATION_OBJECT_ID, sibling.id])
    expect(f.data.readVariableConfig(f.characterId).variables).toEqual([])
  })

  it('authors independent display libraries with explicit preset ownership, partial updates and revision conflicts', async () => {
    const f = await fixture(), preset = f.data.readAgentPresetCatalog().activePresetIds.roleplay
    const target = { scope: 'preset', presetId: preset }
    const empty = f.call('displayTemplates.read', target)
    const created = f.call('displayTemplates.create', { target, expectedRevision: empty.revision, template: {
      name: 'Synthetic display', position: 'after', pattern: '', flags: '', source: '<%= getvar("score") %>',
    } })
    expect(created.template.enabled).toBe(false)
    const updated = f.call('displayTemplates.update', { target, id: created.template.id, expectedRevision: created.revision, changes: { source: '<p><%= rawContent %></p>' } })
    expect(updated.template.name).toBe('Synthetic display')
    expect(() => f.call('displayTemplates.update', { target, id: created.template.id, expectedRevision: created.revision, changes: { enabled: true } })).toThrow('重新读取')
    expect(() => f.call('displayTemplates.read', { scope: 'preset' })).toThrow()
    expect(f.data.readDisplayTemplates('preset', preset).templates).toEqual([updated.template])
    expect(f.data.readDisplayTemplates('character', f.characterId).templates).toEqual([])
    const configured = f.call('displayTemplates.configure', { target, expectedRevision: updated.revision, enabled: true, orderedIds: [created.template.id] })
    expect(configured.enabled).toBe(true)
    expect(configured.templates.every((template: any) => template.enabled)).toBe(true)
    const global = f.call('displayTemplates.read', { scope: 'global' })
    expect(global).toMatchObject({ scope: 'global', ownerId: '', revision: 0 })
    const savedGlobal = f.call('displayTemplates.configure', { target: { scope: 'global' }, expectedRevision: global.revision, enabled: true })
    expect(f.data.readDisplayTemplates('global', '')).toEqual(savedGlobal)
    expect(() => f.call('displayTemplates.read', { scope: 'global', presetId: preset })).toThrow()
    const settings = f.data.readSettingLibrary(f.characterId)
    expect(JSON.stringify(settings)).not.toContain('Synthetic display')
    const scripts = f.call('presetScripts.read', { presetId: preset })
    const saved = f.call('presetScripts.save', { presetId: preset, expectedRevision: scripts.revision, enabled: false, variables: { score: 1 }, trees: scripts.trees })
    expect(f.data.readScriptLibrary('preset', preset)).toEqual(saved)
    expect(() => f.call('presetScripts.save', { presetId: preset, expectedRevision: scripts.revision, enabled: false, variables: {}, trees: [] })).toThrow('重新读取')
  })
  it.each(['global', 'character', 'preset'] as const)('bulk configures every %s display template and keeps sort-only changes independent', async scope => {
    const f = await fixture(), presetId = f.data.readAgentPresetCatalog().activePresetIds.roleplay
    const target = scope === 'preset' ? { scope, presetId } : { scope }
    let library = f.call('displayTemplates.read', target)
    for (const example of creatorToolsets.find(toolset => toolset.id === 'displayTemplates')!.examples) {
      f.call('displayTemplates.create', { target, expectedRevision: library.revision, template: example.template })
      library = f.call('displayTemplates.read', target)
    }
    expect(library.templates.every((template: any) => !template.enabled)).toBe(true)
    library = f.call('displayTemplates.configure', { target, expectedRevision: library.revision, enabled: true })
    expect(library.enabled).toBe(true)
    expect(library.templates.every((template: any) => template.enabled)).toBe(true)
    f.call('displayTemplates.update', { target, expectedRevision: library.revision, id: library.templates[0].id, changes: { enabled: false } })
    library = f.call('displayTemplates.read', target)
    const previous = library.templates
    const sorted = f.call('displayTemplates.configure', { target, expectedRevision: library.revision, orderedIds: previous.map((template: any) => template.id).reverse() })
    expect(sorted.templates).toEqual([...previous].reverse())
    const before = f.call('displayTemplates.read', target)
    expect(() => f.call('displayTemplates.configure', { target, expectedRevision: before.revision, orderedIds: [before.templates[0].id, before.templates[0].id] })).toThrow()
    expect(() => f.call('displayTemplates.configure', { target, expectedRevision: library.revision, enabled: false })).toThrow('重新读取')
    expect(f.call('displayTemplates.read', target)).toEqual(before)
    const off = f.call('displayTemplates.configure', { target, expectedRevision: before.revision, enabled: false })
    expect(off.enabled).toBe(false)
    expect(off.templates.every((template: any) => !template.enabled)).toBe(true)
  })
  it('does not advertise or accept removed display parameters', async () => {
    const f = await fixture(), target = { scope: 'character' }
    const create = f.operations.find(operation => operation.id === 'displayTemplates.create')!
    const fields = (create.inputSchema.properties as any).template.properties
    expect(Object.keys(fields).sort()).toEqual(['name', 'position', 'pattern', 'flags', 'source'].sort())
    expect(fields.position.enum).toEqual(['before', 'after', 'replace'])
    const template = { name: '合成模板', position: 'after', pattern: '', flags: '', source: '' }
    for (const extra of [{ delimiter: '%' }, { rmWhitespace: true }, { position: 'partial' }]) {
      expect(() => f.call('displayTemplates.create', { target, expectedRevision: 0, template: { ...template, ...extra } })).toThrow()
    }
    expect(f.call('displayTemplates.read', target).templates).toEqual([])
  })
  it('saves empty disabled script drafts and refuses to enable them without altering valid data', async () => {
    const f = await fixture()
    const draft = f.call('scripts.create', { expectedRevision: 0, name: '合成空白草稿', content: '' })
    expect(draft.item).toMatchObject({ content: '', enabled: false })
    const before = f.call('scripts.read', { id: draft.item.id })
    expect(() => f.call('scripts.update', { id: draft.item.id, expectedRevision: before.revision, changes: { enabled: true } })).toThrow('源码为空')
    expect(f.call('scripts.read', { id: draft.item.id })).toEqual(before)
    const presetId = f.data.readAgentPresetCatalog().activePresetIds.roleplay
    const library = f.call('presetScripts.read', { presetId })
    const saved = f.call('presetScripts.save', { presetId, expectedRevision: library.revision, enabled: false, variables: {}, trees: [draft.item] })
    expect(saved.trees[0]).toMatchObject({ content: '', enabled: false })
    expect(() => f.call('presetScripts.save', { presetId, expectedRevision: saved.revision, enabled: true, variables: {}, trees: [{ ...draft.item, enabled: true }] })).toThrow('源码为空')
    expect(f.call('presetScripts.read', { presetId })).toEqual(saved)
  })
  it('creates a blank character without a selected target and preserves existing character identities', async () => {
    const f = await fixture(), before = f.data.readCharacters()
    const create = f.operations.find(item => item.id === 'character.create')!
    expect(create.target).toBe('new-character')
    const created = create.execute('', { name: '合成新角色', group: '合成新分组' }) as { id: string }
    const after = f.data.readCharacters()
    expect(after.items).toHaveLength(before.items.length + 1)
    expect(after.active_character_id).toBe(before.active_character_id)
    expect(after.items.find(item => item.id === created.id)).toMatchObject({ name: '合成新角色', group: '合成新分组', avatar: '',
      persona: { opening: '', assistant_avatar: '', assistant_square: '', assistant_cover: '', show_opening: false } })
    expect(after.items.filter(item => item.id !== created.id)).toEqual(before.items)
    for (const input of [{ name: '' }, { name: '   ' }, { name: '合成新角色', characterId: f.characterId }, {}]) {
      expect(() => create.execute('', input)).toThrow()
    }
    expect(f.data.readCharacters()).toEqual(after)
    expect(() => f.operations.find(item => item.id === 'character.update')!.execute('', { name: '不能改到其他角色' })).toThrow('重新选择角色')
  })
  it('advertises two reading policies and refuses executable required/reference entries without saving', async () => {
    const f = await fixture()
    const schema = f.operations.find(item => item.id === 'settings.create')!.inputSchema as any
    expect(schema.properties.agentReadStrategy.enum).toEqual(['required', 'keyword', 'normal'])
    const before = f.data.readSettingLibrary(f.characterId)
    expect(() => f.call('settings.create', { title: '合成必读', agentReadStrategy: 'required', contentMode: 'ejs', content: '<%= 1 %>' })).toThrow('选读')
    expect(() => f.call('settings.create', { title: '合成引用', dynamicMode: 'ejs_reference', contentMode: 'ejs' })).toThrow('纯文字')
    expect(() => f.call('settings.create', { title: '合成错误档位', agentReadStrategy: 'unsupported' })).toThrow()
    expect(f.data.readSettingLibrary(f.characterId)).toEqual(before)
    const reference = f.call('settings.create', { title: '合成素材', dynamicMode: 'ejs_reference', content: '合成文字' })
    const controller = f.call('settings.create', { title: '合成控制器', contentMode: 'ejs', content: '<%- await getwi("合成素材") %>' })
    expect(f.call('settings.list').entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: reference.id, readStrategy: '选读', dynamicMode: 'ejs_reference', contentMode: 'plain_text' }),
      expect.objectContaining({ id: controller.id, readStrategy: '选读', contentMode: 'ejs' }),
    ]))
    expect(() => f.call('settings.update', { id: controller.id, changes: { agentReadStrategy: 'required' } })).toThrow('选读')
    expect(f.call('settings.read', { id: controller.id }).contentMode).toBe('ejs')
  })
  it('evaluates the documented Zod example and retains the previous code on invalid output', async () => {
    const f = await fixture()
    f.call('variables.create', { title: 'score', objectId: '', enabled: true, type: 'number', defaultValue: '20', description: '', updateRule: '', readMode: 'required', order: 1, treeViewOrder: 1 })
    const example = creatorToolsets.find(item => item.id === 'variables')!.examples[0]
    expect(f.call('variables.validate_schema', { schemaCode: example.schemaCode, state: example.state }).state).toEqual({ score: 20, flags: { ready: true }, level: 3 })
    f.call('variables.update_schema', { schemaCode: example.schemaCode })
    const before = f.data.readVariableConfig(f.characterId)
    expect(() => f.call('variables.update_schema', { schemaCode: 'z.object({ score: z.number().max(1) })' })).toThrow()
    expect(() => f.call('variables.validate_schema', { schemaCode: 'z.object({}).transform(() => undefined)' })).toThrow('JSON')
    expect(f.data.readVariableConfig(f.characterId)).toEqual(before)
  })
  it('stores native modules as files, uses exact revisions and keeps other libraries unchanged', async () => {
    const f = await fixture(), source = creatorToolsets.find(item => item.id === 'scripts')!.examples[0].content
    const global = f.data.readScriptLibrary('global', ''), other = f.data.readScriptLibrary('character', 'synthetic-other-character')
    const folder = f.call('scripts.create_folder', { name: '合成分组', expectedRevision: 0 })
    const created = f.call('scripts.create', { name: '合成计算脚本', folderId: folder.item.id, content: source, expectedRevision: folder.revision })
    expect(created.item).toMatchObject({ enabled: false, runtime: { kind: 'eleckoi-module', apiVersion: 1 } })
    expect(f.call('scripts.list').enabled).toBe(false)
    const workspace = f.data.readScriptWorkspace('character', f.characterId)
    const file = join(workspace.path, workspace.entries.find(item => item.id === created.item.id)!.file)
    expect(readFileSync(file, 'utf8')).toBe(source)
    expect(() => f.call('scripts.update', { id: created.item.id, expectedRevision: folder.revision, changes: { content: 'export default () => {}' } })).toThrow('重新读取')
    expect(readFileSync(file, 'utf8')).toBe(source)
    expect(() => f.call('scripts.remove_folder', { id: folder.item.id, expectedRevision: created.revision })).toThrow('空脚本文件夹')
    const updated = f.call('scripts.update', { id: created.item.id, expectedRevision: created.revision, changes: { enabled: true, data: { multiplier: 2 } } })
    const moved = f.call('scripts.move', { id: created.item.id, expectedRevision: updated.revision, folderId: '' })
    const configured = f.call('scripts.configure', { expectedRevision: moved.revision, changes: { enabled: true } })
    expect(configured.enabled).toBe(true)
    const removed = f.call('scripts.remove', { id: created.item.id, expectedRevision: configured.revision })
    expect(existsSync(file)).toBe(false)
    f.call('scripts.remove_folder', { id: folder.item.id, expectedRevision: removed.revision })
    expect(f.data.readScriptLibrary('global', '')).toEqual(global)
    expect(f.data.readScriptLibrary('character', 'synthetic-other-character')).toEqual(other)
  })
  it('previews HTML display replacement using the real processor without writing or changing prompt content', async () => {
    const f = await fixture(), collection = f.call('regex.list')
    const created = f.call('regex.create', { expectedRevision: collection.revision, rule: {
      name: '合成展示', pattern: '/<meter>(\\d+)<\\/meter>/g', replacement: '<div>数值：$1</div>', targets: ['AiOutput'], enabled: true,
      displayOnly: true, promptOnly: false, runOnEdit: false, order: 0, minDepth: null, maxDepth: 2,
    } })
    const before = f.data.readRegexRules(f.characterId)
    const preview = (surface: string, depth = 0, isEdit = false) => f.call('regex.test', { text: '<meter>25</meter>', rule: created.rule, target: 'AiOutput', surface, depth, isEdit })
    expect(preview('Display')).toMatchObject({ output: '<div>数值：25</div>', changed: true })
    expect(preview('Prompt')).toMatchObject({ output: '<meter>25</meter>', appliesToSurface: false })
    expect(preview('Display', 3).changed).toBe(false)
    expect(preview('Display', 0, true).changed).toBe(false)
    expect(() => f.call('regex.update', { id: created.rule.id, expectedRevision: created.revision, changes: { pattern: '/(/g' } })).toThrow()
    expect(f.data.readRegexRules(f.characterId)).toEqual(before)
    const changed = f.call('regex.update', { id: created.rule.id, expectedRevision: created.revision, changes: { replacement: '<p>$1</p>' } })
    expect(changed.rule.targets).toEqual(['AiOutput'])
    f.call('regex.remove', { id: created.rule.id, expectedRevision: changed.revision })
    expect(f.call('regex.list').rules).toEqual([])
  })
})
