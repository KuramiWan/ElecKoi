import { describe, expect, it } from 'vitest'
import { decodeCharacterCard } from '../src/domain/characterTransfer/characterCardFormats'
import { generatedInitialStateJson } from '../../../shared/src/foundation/variables/initialState'
import { ELECKOI_FAILURE_CODES } from '../../../shared/src/contracts/errors/codes'
import { assertMvuJson, extractMvuSchema, loadMvuSchema } from '../src/domain/characterTransfer/mvuSchema'

const registrationModule = 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js'
const registeredScript = (source: string) => `import { registerMvuSchema } from '${registrationModule}';\n${source}`

function decode(options: { scripts?: string[]; entries?: Array<{ name: string; content: string }>; openings?: string[]; variables?: object } = {}) {
  const openings = options.openings ?? ['Synthetic opening']
  return decodeCharacterCard(Buffer.from(JSON.stringify({
    spec: 'chara_card_v3', spec_version: '3.0', data: {
      name: 'Synthetic character', description: '', first_mes: openings[0], alternate_greetings: openings.slice(1),
      character_book: { entries: (options.entries ?? []).map(entry => ({ ...entry, enabled: false })) },
      extensions: { tavern_helper: {
        variables: options.variables ?? {},
        scripts: (options.scripts ?? []).map(source => ({ type: 'script', enabled: true, content: registeredScript(source) }))
      } }
    }
  })), 'sillytavern')
}

function openingBindings(card: ReturnType<typeof decode>) {
  return card.settingLibrary!.entries.find(entry => entry.kind === 'opening')!.openingMessages
}

describe('MVU variable import', () => {
  it('keeps the registered object root loose while retaining the authored nested object behavior', () => {
    const schema = loadMvuSchema([registeredScript(`
      const Schema = z.object({ status: z.object({ value: z.number() }) });
      registerMvuSchema(Schema);
    `)])!
    expect(schema.initialize({ status: { value: 2, nestedExtra: true }, topExtra: { value: 3 } }))
      .toEqual({ status: { value: 2 }, topExtra: { value: 3 } })
  })

  it('throws contract-coded failures from the generated MVU template instead of bare errors', () => {
    const failureOf = (run: () => unknown): { code?: string; details?: Record<string, unknown> } => {
      try { run() }
      catch (error) { return error as { code?: string; details?: Record<string, unknown> } }
      throw new Error('Expected the generated MVU template to fail')
    }
    expect(failureOf(() => loadMvuSchema([registeredScript('registerMvuSchema(() => ({}));')]))).toMatchObject({
      code: ELECKOI_FAILURE_CODES.inputUnsupported, details: { what: 'MVU Schema 的注册结果' }
    })
    const generated = loadMvuSchema([registeredScript('registerMvuSchema(z.object({}).transform(() => []));')])!
    expect(failureOf(() => generated.initialize({}))).toMatchObject({
      code: ELECKOI_FAILURE_CODES.dataShapeInvalid, details: { what: 'MVU Schema 处理结果' }
    })
  })

  it('keeps root fields from the input when a registered transform returns only derived fields', () => {
    const schema = loadMvuSchema([registeredScript(`
      const Schema = z.object({ value: z.number() }).transform(value => ({ derived: value.value * 2 }));
      registerMvuSchema(Schema);
    `)])!
    expect(schema.initialize({ value: 3, retained: true })).toEqual({ value: 3, retained: true, derived: 6 })
  })

  it('accepts a stateless registered schema factory and does not identify an unknown module by its export name', () => {
    const schema = loadMvuSchema([registeredScript(`registerMvuSchema(() => z.object({ value: z.number().prefault(2) }));`)])!
    expect(schema.initialize({})).toEqual({ value: 2 })
    expect(() => extractMvuSchema(`import { registerMvuSchema } from 'unknown-schema-module';
      registerMvuSchema(z.object({}));`)).toThrow(/注册模块/)
    expect(() => extractMvuSchema('registerMvuSchema(z.object({}));')).toThrow(/无法确定/)
    expect(() => extractMvuSchema(`import { anotherExport as registerMvuSchema } from '${registrationModule}';
      registerMvuSchema(z.object({}));`)).toThrow(/注册模块/)
    expect(extractMvuSchema(`import { anotherExport as registerMvuSchema } from '${registrationModule}';
      registerMvuSchema(z.object({}));`, { recognizedModuleOnly: true })).toBeUndefined()
  })

  it('uses the registered schema and retains factories, preprocessing, transforms and defaults', () => {
    const card = decode({ scripts: [`
      const energy = initial => z.preprocess(value => Number(value ?? initial), z.number()).prefault(initial);
      const Item = z.object({ energy: energy(6), labels: z.array(z.string()).prefault([]) }).prefault({});
      const Registered = z.object({ item: Item }).transform(state => ({ ...state, total: state.item.energy + 1 }));
      $(() => registerMvuSchema(Registered));
      const Unrelated = z.object({ unrelated: z.string() });
      throw new Error('Unrelated script body must not execute during import');
    `] })
    const config = card.variableConfig!
    expect(JSON.parse(config.initialStateJson)).toEqual({ item: { energy: 6, labels: [] }, total: 7 })
    expect(config.variables.map(variable => variable.title)).toEqual(expect.arrayContaining(['energy', 'labels', 'total']))
    expect(config.variables.some(variable => variable.title === 'unrelated')).toBe(false)
    expect(config.schemaCode).toContain('preprocess')
    expect(config.schemaCode).toContain('transform')
    expect(config.schemaCode).not.toContain('Unrelated script body')
  })

  it('reads every marked initializer, ignores script settings and lets inline initialization replace the book seed', () => {
    const card = decode({
      entries: [
        { name: 'Prefix [InitVar] A', content: 'status:\n  energy: 4\nbookOnly: true' },
        { name: '[InitVar] B', content: '<initvar>\nstatus:\n  labels: [a, b]\n</initvar>' }
      ],
      variables: { scriptSettings: { enabled: true }, scriptIds: ['synthetic-id'] },
      openings: ['Default', '<initvar>\nstatus:\n  energy: 12\n</initvar>']
    })
    const config = card.variableConfig!
    const bindings = openingBindings(card)
    expect(config.versions).toHaveLength(2)
    const selected = bindings.map(binding => config.versions.find(version => version.id === binding.variableVersionId)!)
    expect(JSON.parse(selected[0]!.initialStateJson)).toEqual({ status: { energy: 4, labels: ['a', 'b'] }, bookOnly: true })
    expect(JSON.parse(selected[1]!.initialStateJson)).toEqual({ status: { energy: 12 } })
    expect(bindings[0]!.variableVersionId).not.toBe(bindings[1]!.variableVersionId)
    expect(config.variables.some(variable => variable.title === 'scriptSettings')).toBe(false)
  })

  it('applies array and pointer operations in every opening patch block without corrupting arrays', () => {
    const card = decode({
      entries: [{ name: '[InitVar] A', content: '{"items":["a","b"],"stats":{"energy":4},"a/b":2}' }],
      openings: ['Default', `
        <JSONPatch>[{"op":"add","path":"/stat_data/items/1","value":"c"},{"op":"delta","path":"/stats/energy","value":3}]</JSONPatch>
        <JSONPatch>[{"op":"copy","from":"/a~1b","path":"/copied"},{"op":"remove","path":"/items/0"}]</JSONPatch>
      `]
    })
    const binding = openingBindings(card)[1]!
    const version = card.variableConfig!.versions.find(item => item.id === binding.variableVersionId)!
    expect(JSON.parse(version.initialStateJson)).toEqual({ items: ['c', 'b'], stats: { energy: 7 }, 'a/b': 2, copied: 2 })
  })

  it('keeps seeded dictionary entries, templates, unknown object fields and nullable defaults', () => {
    const card = decode({
      entries: [{ name: '[InitVar] A', content: '{"members":{"one":{"energy":8,"note":null}},"extra":{"ready":true}}' }],
      scripts: [`
        const Member = z.object({ energy: z.number().prefault(2), note: z.string().nullable().prefault(null) });
        const Schema = z.object({ members: z.record(z.string(), Member).prefault({}) }).passthrough();
        registerMvuSchema(Schema);
      `]
    })
    const config = card.variableConfig!
    expect(JSON.parse(config.initialStateJson)).toEqual({ members: { one: { energy: 8, note: null } }, extra: { ready: true } })
    expect(config.objects.some(item => item.name === 'members' && item.dynamicKey)).toBe(true)
    expect(config.objects.some(item => item.name === 'extra')).toBe(true)
    expect(config.variables.map(item => item.title)).toEqual(expect.arrayContaining(['energy', 'note', 'ready']))
  })

  it('preserves a fixed null value when native defaults are regenerated', () => {
    const card = decode({ entries: [{ name: '[InitVar] A', content: '{"note":null,"ready":true}' }] })
    expect(JSON.parse(generatedInitialStateJson(card.variableConfig!.objects, card.variableConfig!.variables))).toEqual({ note: null, ready: true })
  })

  it('does not turn ordinary script variables into a native variable configuration', () => {
    expect(decode({ variables: { theme: 'light' } }).variableConfig).toBeUndefined()
  })

  it('imports the character with explicit warnings when variable configuration cannot be converted', () => {
    const malformed = decode({ entries: [{ name: '[InitVar] A', content: 'value: [' }] })
    expect(malformed.warnings).toEqual([expect.stringContaining('初始化')])
    expect(malformed.variableConfig).toBeUndefined()
    expect(malformed.settingLibrary!.entries.some(entry => entry.content === 'value: [')).toBe(true)
    const conflicting = decode({ scripts: [
      'const A = z.object({ a: z.number() }); registerMvuSchema(A);',
      'const B = z.object({ b: z.number() }); registerMvuSchema(B);'
    ] })
    expect(conflicting.warnings).toEqual([expect.stringContaining('多个')])
    expect(conflicting.variableConfig).toBeUndefined()
    const invalidPatch = decode({ entries: [{ name: '[InitVar] A', content: '{"value":1}' }], openings: [
      '<JSONPatch>[{"op":"replace","path":"/missing/field","value":2}]</JSONPatch>'
    ] })
    expect(invalidPatch.warnings).toEqual([expect.stringContaining('开场白')])
    expect(invalidPatch.variableConfig).toBeUndefined()
    expect(openingBindings(invalidPatch)[0]!.content).toContain('/missing/field')
  })

  it('retains explicit seeds for all openings when schema dependencies are shared with script handlers', () => {
    const card = decode({ entries: [{ name: '[InitVar] Initial', content: '{"status":{"energy":4},"items":[]}' }],
      openings: ['Opening A', '<initvar>{"status":{"energy":8},"items":["synthetic"]}</initvar>'], scripts: [`
        const Schema = z.object({ status: z.object({ energy: z.number() }), items: z.array(z.string()) });
        registerMvuSchema(Schema);
        eventOn('synthetic-event', candidate => Schema.parse(candidate));
      `] })
    expect(card.warnings).toEqual([expect.stringContaining('其他脚本流程')])
    expect(card.variableConfig!.versions.map(version => JSON.parse(version.initialStateJson)))
      .toEqual([{ status: { energy: 4 }, items: [] }, { status: { energy: 8 }, items: ['synthetic'] }])
    expect(card.variableConfig!.versions.every(version => version.schemaCode === '')).toBe(true)
    expect(openingBindings(card).every(opening => opening.variableVersionId)).toBe(true)
  })

  it('retains explicit dependency aliases and the supported document-ready registration', () => {
    const schema = loadMvuSchema([registeredScript(`
      import { z as types } from 'zod';
      import utility from 'lodash';
      const Schema = types.object({ values: types.array(types.number()).prefault([2, 3]) })
        .transform(state => ({ ...state, total: utility.sum(state.values) }));
      $(async () => { await waitGlobalInitialized('Mvu'); registerMvuSchema(Schema); });
    `)])!
    expect(schema.initialize({})).toEqual({ values: [2, 3], total: 5 })
  })

  it.each([
    registeredScript('const Schema = z.object({}); if (false) registerMvuSchema(Schema);'),
    registeredScript('const Schema = z.object({}); eventOn("ready", () => registerMvuSchema(Schema));'),
    registeredScript('$(() => { const Schema = z.object({}); registerMvuSchema(Schema); });'),
    registeredScript('const fields = {}; fields.value = z.number(); const Schema = z.object(fields); registerMvuSchema(Schema);'),
    registeredScript('const fields = {}; mutate(fields); const Schema = z.object(fields); registerMvuSchema(Schema);'),
    'const registerMvuSchema = () => {}; registerMvuSchema(z.object({}));',
  ])('does not extract a different program from dynamic registration or omitted dependency effects: %s', source => {
    expect(() => extractMvuSchema(source)).toThrow(/无法|覆盖/)
  })

  it('does not invoke accessors or silently discard non-JSON initializer fields', () => {
    let accessed = false
    const state = Object.defineProperty({}, 'value', { enumerable: true, get() { accessed = true; return 1 } })
    expect(() => assertMvuJson(state)).toThrow('访问器')
    expect(accessed).toBe(false)
    expect(() => assertMvuJson(Object.assign([1], { extra: 2 }))).toThrow('附加字段')
  })
})
