import { describe, expect, it } from 'vitest'
import { evaluateRegexEjs } from '../src/foundation/regex/RegexEjs.js'
import { transformCollectionSurface } from '../src/foundation/regex/RegexRuleProcessor'
import type { RegexRule, RegexRuleCollection } from '../src/contracts/regex/schemas'

const rule: RegexRule = { id: 'synthetic-rule', name: 'Synthetic choices', pattern: '/<option>([\\s\\S]*?)<\\/option>/g',
  replacement: '<div><% const choices = rawContent.match(/<option>([\\s\\S]*?)<\\/option>/)[1].split("\\n"); for (const choice of choices) { %><button><%= choice %></button><% } %><b><%= await Promise.resolve(getvar("score")) %></b></div>',
  targets: ['AiOutput'], enabled: true, displayOnly: true, promptOnly: false, runOnEdit: true, order: 0 }
const collection = (rules: RegexRule[]): RegexRuleCollection => ({ characterId: 'synthetic-character', agentPresetId: 'synthetic-preset', agentPresetName: 'Synthetic preset',
  agentPresetRegexRevision: '0'.repeat(64), globalRules: [], agentPresetRules: [], characterRules: rules, versions: [], activeVersionId: '', revision: 0 })
const render = async (rawContent: string, content: string, variables: Record<string, unknown> | null = { score: 12 }, surface: 'Display' | 'Prompt' = 'Display') => evaluateRegexEjs({
  content: content.includes('<!-- eleckoi:regex-ejs:start -->') || !content.includes('<%') ? content : '<!-- eleckoi:regex-ejs:start -->'+content+'<!-- eleckoi:regex-ejs:end -->', rawContent, variables, surface, message: { id: 'synthetic-message', conversationId: 'synthetic-chat', role: 'assistant', status: 'complete', content: rawContent },
})

describe('EJS in regex output', () => {
  it('keeps template examples in the original text literal while evaluating authored replacements', async () => {
    const literal = '<% throw new Error("Literal example must not run") %>'
    const source = literal + ' TOKEN'
    const content = transformCollectionSurface(source, collection([{ ...rule, pattern: 'TOKEN', replacement: '<%= 6 * 7 %>' }]), 'AiOutput', 'Display')
    expect(await render(source, content)).toBe(literal + ' 42')
    expect(await evaluateRegexEjs({ content: literal, rawContent: literal, variables: null, surface: 'Display', message: {
      id: 'synthetic-literal', conversationId: 'synthetic-chat', role: 'assistant', status: 'complete', content: literal,
    } })).toBe(literal)
  })
  it('renders variable-length choices after normal regex matching, with standard escaping and await', async () => {
    for (const count of [1, 6, 12, 10001]) {
      const source = `<option>${Array.from({ length: count }, (_, i) => `Choice ${i}<`).join('\n')}</option>`
      const result = await render(source, transformCollectionSurface(source, collection([rule]), 'AiOutput', 'Display'))
      expect(result.match(/<button>/g)).toHaveLength(count)
      expect(result).toContain(`Choice ${count - 1}&lt;</button>`)
      expect(result).toContain('<b>12</b>')
    }
  })
  it.each([
    [true, false, 'Display', true], [true, false, 'Prompt', false],
    [false, true, 'Display', false], [false, true, 'Prompt', true],
    [true, true, 'Display', true], [true, true, 'Prompt', true],
  ] as const)('respects displayOnly=%s promptOnly=%s on %s', async (displayOnly, promptOnly, surface, applies) => {
    const source = '<option>One</option>', configured = { ...rule, displayOnly, promptOnly }
    const content = transformCollectionSurface(source, collection([configured]), 'AiOutput', surface)
    expect(await render(source, content, { score: 0 }, surface)).toBe(applies ? '<div><button>One</button><b>0</b></div>' : source)
  })
  it('retains ordering, capture substitutions, flags, trim and depth behavior', async () => {
    const rules = [
      { ...rule, id: 'first', pattern: '/v=(?<number>\\d+)/g', replacement: '<%= Number("$<number>") * getvar("factor") %>', trimStrings: ['0'], minDepth: 2, maxDepth: 3 },
      { ...rule, id: 'second', pattern: '/TAIL/g', replacement: '$&:<%= content.includes("Number") %>', order: 1 },
    ]
    const source = 'v=20 TAIL'
    const content = transformCollectionSurface(source, collection(rules), 'AiOutput', 'Display', { depth: 2 })
    expect(await render(source, content, { factor: 3 })).toBe('6 TAIL:true')
    expect(transformCollectionSurface(source, collection(rules), 'AiOutput', 'Display', { depth: 1 })).toContain('v=20')
    expect(transformCollectionSurface(source, collection([{ ...rule, enabled: false }]), 'AiOutput', 'Display')).toBe(source)
  })
  it('does not substitute current variables for a missing snapshot and keeps locals immutable', async () => {
    await expect(render('source', '<%= getvar("score", {defaults:0}) %>', null)).rejects.toThrow('快照')
    const variables = { score: 12 }
    expect(await render('source', '<% variables.score=99; message.content="changed"; %><%= variables.score %>:<%= message.content %>', variables)).toBe('12:source')
    expect(variables).toEqual({ score: 12 })
  })
  it('keeps standard literal EJS, whitespace controls, and complete long output', async () => {
    expect(await render('source', '<%%= example %%>\n<%# comment %><%- "<b>raw</b>" %><%= "<" %>')).toBe('<%= example %>\n<b>raw</b>&lt;')
    expect((await render('source', '<%= "x".repeat(2_000_001) %>')).length).toBe(2_000_001)
    await expect(render('source', '<% throw new Error("Synthetic EJS error") %>')).rejects.toThrow('Synthetic EJS error')
  })
})
