import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { creatorCapabilities, creatorToolsets } from '../packages/host/product-data/src/domain/creatorStudio/capabilities'

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
  it('advertises two reading policies and refuses executable required/reference entries without saving', async () => {
    const f = await fixture()
    const schema = f.operations.find(item => item.id === 'settings.create')!.inputSchema as any
    expect(schema.properties.agentReadStrategy.enum).toEqual(['required', 'normal'])
    const before = f.data.readSettingLibrary(f.characterId)
    expect(() => f.call('settings.create', { title: '合成必读', agentReadStrategy: 'required', contentMode: 'ejs', content: '<%= 1 %>' })).toThrow('选读')
    expect(() => f.call('settings.create', { title: '合成引用', dynamicMode: 'ejs_reference', contentMode: 'ejs' })).toThrow('纯文字')
    expect(() => f.call('settings.create', { title: '合成错误档位', agentReadStrategy: 'keyword' })).toThrow()
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
