import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
// @ts-expect-error The installed browser test runtime does not publish declarations.
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { assertVariableJson, describeVariableRuleFailure, loadVariableSchema } from '../packages/host/product-data/src/domain/variables/variableSchema'
// @ts-expect-error The browser library contract is a JavaScript entry point.
import { BROWSER_LIBRARY_VERSIONS } from '../packages/client/features/dsh-client-html-resources/src/browser-libraries.js'

describe('author variable schema runtime', () => {
  it('uses the same pinned Zod version as the bundled author browser runtime', () => {
    const require = createRequire(resolve('packages/host/product-data/package.json'))
    expect(require('zod/package.json').version).toBe(BROWSER_LIBRARY_VERSIONS.zod)
  })

  it.each([
    { source: 'z.looseObject({ nested: z.object({ score: z.coerce.number().min(0) }), total: z.number().prefault(0) }).transform(value => ({ ...value, total: value.nested.score + 1 }))',
      input: { nested: { score: '3', extra: 'nested' }, extra: 'root' }, expected: { nested: { score: 3 }, total: 4, extra: 'root' } },
    { source: 'z.object({ values: z.array(z.preprocess(Number, z.number())), note: z.string().nullable().prefault(null) }).transform(value => ({ ...value, total: value.values.reduce((a, b) => a + b, 0) }))',
      input: { values: ['2', '3'] }, expected: { values: [2, 3], note: null, total: 5 } },
  ])('matches browser defaults, preprocessing and transforms for $source', ({ source, input, expected }) => {
    const page = new JSDOM('', { runScripts: 'outside-only' })
    try {
      page.window.eval(readFileSync(resolve('packages/client/features/dsh-client-html-resources/assets/zod.global.js'), 'utf8'))
      const browserSchema = page.window.eval(`(${source})`)
      const browserInput = page.window.JSON.parse(JSON.stringify(input))
      expect(JSON.parse(JSON.stringify(browserSchema.parse(browserInput)))).toEqual(expected)
      expect(loadVariableSchema(source).parse(input)).toEqual(expected)
    } finally { page.window.close() }
  })

  it('returns the same validation paths and codes as the author browser runtime', () => {
    const page = new JSDOM('', { runScripts: 'outside-only' })
    try {
      page.window.eval(readFileSync(resolve('packages/client/features/dsh-client-html-resources/assets/zod.global.js'), 'utf8'))
      const source = 'z.object({ nested: z.object({ score: z.number().max(5) }) })'
      const input = { nested: { score: 8 } }
      const browser = page.window.eval(`(${source})`).safeParse(page.window.JSON.parse(JSON.stringify(input)))
      expect(browser.success).toBe(false)
      let failure
      try { loadVariableSchema(source).parse(input) }
      catch (error) { failure = describeVariableRuleFailure(error) }
      expect(failure).toMatchObject({ error_stage: 'validation', issues: browser.error.issues.map((issue: any) => ({
        path: '/' + issue.path.join('/'), code: issue.code,
      })) })
    } finally { page.window.close() }
  })

  it.each([
    'const Schema = z.object({ value: z.number().prefault(2) });',
    'export const Schema = z.object({ value: z.number().prefault(2) });',
    'export default z.object({ value: z.number().prefault(2) });',
    'z.object({ value: z.number().prefault(2) })',
  ])('evaluates the explicit schema form without guessing another declaration: %s', source => {
    expect(loadVariableSchema(source).parse({})).toEqual({ value: 2 })
  })

  it('retains declared aliases, preprocessing, defaults and transformations without mutating the input', () => {
    const runtime = loadVariableSchema(`
      import { z as types } from 'zod';
      import utility from 'lodash';
      const Schema = types.object({ values: types.array(types.preprocess(Number, types.number())),
        note: types.string().nullable().prefault(null) })
        .transform(value => ({ ...value, total: utility.sum(value.values) }));
    `)
    const input = { values: ['2', '3'] }
    expect(runtime.parse(input)).toEqual({ values: [2, 3], note: null, total: 5 })
    expect(input).toEqual({ values: ['2', '3'] })
  })

  it('rejects invalid inputs, asynchronous results and non-JSON transformations', () => {
    expect(() => loadVariableSchema('z.object({ value: z.number().max(5) })').parse({ value: 8 })).toThrow()
    expect(() => loadVariableSchema('z.object({}).transform(async value => value)').parse({})).toThrow()
    for (const expression of ['undefined', 'NaN', 'new Date()', 'new Map()', 'new (class Result {})()', '[, 2]']) {
      expect(() => loadVariableSchema(`z.object({}).transform(() => ({ value: ${expression} }))`).parse({})).toThrow()
    }
    expect(() => loadVariableSchema('z.object({}).transform(() => Object.defineProperty({}, "value", { enumerable: true, get() { throw new Error("accessor invoked"); } }))').parse({}))
      .toThrow('访问器')
  })

  it('does not execute accessors during JSON validation and rejects discarded array fields', () => {
    let accessed = 0
    const value = Object.defineProperty({}, 'value', { enumerable: true, get() { accessed++; return 1 } })
    expect(() => assertVariableJson(value)).toThrow('访问器')
    expect(accessed).toBe(0)
    expect(() => assertVariableJson(Object.assign([1], { extra: 2 }))).toThrow('附加字段')
    const circular: Record<string, unknown> = {}; circular.self = circular
    expect(() => assertVariableJson(circular)).toThrow('循环')
  })

  it('bounds both schema construction and transformation execution', () => {
    expect(() => loadVariableSchema('const Schema = (() => { while (true) {} })();')).toThrow('timed out')
    const runtime = loadVariableSchema('z.object({}).transform(() => { while (true) {} })')
    expect(() => runtime.parse({})).toThrow('timed out')
  }, 5000)

  it('retains valid transported rule failures without undefined optional fields', () => {
    const variableRuleFailure = { error_stage: 'execution', detail: 'Synthetic rule failure', issues: undefined, issues_truncated: undefined }
    const failure = describeVariableRuleFailure(Object.assign(new Error('Callback failed'), { variableRuleFailure }))
    expect(failure).toEqual({ error_stage: 'execution', detail: 'Synthetic rule failure' })
    expect(Object.hasOwn(failure, 'issues')).toBe(false)
    expect(Object.hasOwn(failure, 'issues_truncated')).toBe(false)
    const invalid = describeVariableRuleFailure(Object.assign(new Error('Callback failed'), {
      variableRuleFailure: { error_stage: 'unrecognized', detail: 'Invalid diagnostic' },
    }))
    expect(invalid).toEqual({ error_stage: 'execution', detail: 'Callback failed' })
  })

  it('distinguishes invalid values from broken rules and unserializable results', () => {
    const diagnose = (source: string, state = {}) => {
      try { loadVariableSchema(source).parse(state) }
      catch (error) { return describeVariableRuleFailure(error) }
      throw new Error('Expected the authored rule to fail')
    }
    expect(diagnose('z.object({ "a/b": z.number().max(5) })', { 'a/b': 8 })).toMatchObject({
      error_stage: 'validation', issues: [{ path: '/a~1b', code: 'too_big' }], issues_truncated: false,
    })
    expect(diagnose('const Schema = ;')).toMatchObject({ error_stage: 'schema' })
    expect(diagnose('z.object({}).transform(() => { throw new Error("calculation failed") })'))
      .toMatchObject({ error_stage: 'execution', detail: 'Error: calculation failed' })
    expect(diagnose('z.object({}).transform(() => ({ invalid: NaN }))')).toMatchObject({ error_stage: 'output' })
  })
})
