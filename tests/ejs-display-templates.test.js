import { describe, expect, it } from 'vitest';
import { evaluateDisplayTemplates } from '../apps/web/src/modules/displayTemplates/runtime/evaluateDisplayTemplates.js';
import { creatorToolsets } from '../packages/host/product-data/src/domain/creatorStudio/guides';

const template = (source, extra = {}) => ({ id: 'main', name: 'Main', enabled: true, position: 'after',
  pattern: '', flags: '', source, ...extra });

it('composes global, preset and character replacements in order without altering the source message', async () => {
  const message = { id: 'synthetic-message', role: 'assistant', status: 'complete', content: 'Narrative' };
  const libraries = [['global', '', 'Narrative', 'Global'], ['preset', 'synthetic-preset', 'Global', 'Preset'], ['character', 'synthetic-character', 'Preset', 'Character']]
    .map(([scope, ownerId, pattern, source]) => ({ scope, ownerId, enabled: true, revision: 1, templates: [template(source, { position: 'replace', pattern })] }));
  const result = await evaluateDisplayTemplates({ libraries, message, content: message.content, variables: {} });
  expect(result.errors).toEqual([]);
  expect(result.content).toContain('Character');
  expect(result.content).not.toContain('Narrative');
  expect(message.content).toBe('Narrative');
});
const run = (templates, extra = {}) => evaluateDisplayTemplates({
  libraries: [{ scope: 'character', ownerId: 'synthetic-character', enabled: true, revision: 1, templates }],
  message: { id: 'synthetic-message', role: 'assistant', status: 'complete', content: 'Narrative\n<option>One\nTwo\nThree</option>' },
  content: 'Narrative\n<option>One\nTwo\nThree</option>', variables: { score: 12, energy: 20 }, ...extra,
});

describe('EJS display templates', () => {
  it('renders the creation tool examples with their documented message and historical variables', async () => {
    const examples = creatorToolsets.find(toolset => toolset.id === 'displayTemplates').examples;
    for (const example of examples) {
      const result = await run([template(example.template.source, example.template)], {
        message: { id: 'synthetic-message', role: 'assistant', status: 'complete', content: example.testText },
        content: example.testText, variables: example.testVariables,
      });
      expect(result.errors).toEqual([]);
      expect(result.content).toContain('合成剧情');
      if (example.template.position === 'replace') {
        expect(result.content).not.toContain('<option>');
        expect(result.content).toContain('<p>进入大厅</p>');
        expect(result.content).toContain('<p>沿河探索</p>');
      } else expect(result.content).toContain('需要休息');
    }
  });
  it.each(['global', 'preset', 'character'])('does not evaluate a disabled %s library and preserves its individual template switches', async scope => {
    const message = { id: 'synthetic-message', role: 'assistant', status: 'complete', content: 'Narrative' };
    const library = { scope, ownerId: scope === 'global' ? '' : 'synthetic-owner', enabled: false, revision: 1,
      templates: [template('<% throw new Error("must not execute") %>')] };
    expect(await evaluateDisplayTemplates({ libraries: [library], message, content: message.content, variables: {} })).toEqual({ content: 'Narrative', errors: [] });
    expect(library.templates[0].enabled).toBe(true);
    library.enabled = true;
    expect((await evaluateDisplayTemplates({ libraries: [library], message, content: message.content, variables: {} })).errors).toHaveLength(1);
  });
  it('supports escaped output, raw HTML, conditions, loops and calculations', async () => {
    const result = await run([template('<% if (getvar("energy") < 30) { %>Low:<%= "<red>" %><% } %><%- "<b>ready</b>" %><% for (const item of [1,2,3]) { %><%= item * 2 %><% } %>')]);
    expect(result.errors).toEqual([]);
    expect(result.content).toContain('Low:&lt;red&gt;');
    expect(result.content).toContain('<b>ready</b>246');
  });
  it.each([
    ['<%# hidden %>Visible', 'Visible'],
    ['Before\n<% const x = 1; -%>\nAfter', 'Before\nAfter'],
    ['Before  \n <%_ const x = 1; _%> \n After', 'Before  \n After'],
    ['<%%= score %>', '<%= score %>'],
    ['%%>', '%>'],
    ['<%= await Promise.resolve(12) %>', '12'],
  ])('supports standard EJS tags %s', async (source, expected) => {
    const result = await run([template(source)], { content: '' });
    expect(result.errors).toEqual([]);
    expect(result.content).toBe(expected);
  });
  it('uses standard EJS delimiters and preserves authored whitespace', async () => {
    const result = await run([template('  A  \n\n  <%= getvar("score") %>  ')], { content: '' });
    expect(result.errors).toEqual([]);
    expect(result.content).toBe('  A  \n\n  12  ');
  });
  it('reports unsupported template references and preserves the source body', async () => {
    const result = await run([template('<%- await include("Other") %>')]);
    expect(result.errors).toHaveLength(1);
    expect(result.content).toContain('Narrative');
  });
  it('generates the actual number of options from raw message text', async () => {
    const source = '<% const block = rawContent.match(/<option>([\\s\\S]*?)<\\/option>/); const choices = block ? block[1].trim().split("\\n") : []; for (const choice of choices) { %><button><%= choice %></button><% } %>';
    for (const count of [1, 3, 6, 12]) {
      const text = '<option>' + Array.from({ length: count }, (_, index) => `Choice ${index}`).join('\n') + '</option>';
      const result = await run([template(source)], { message: { id: 'synthetic-message', role: 'assistant', status: 'complete', content: text } });
      expect(result.errors).toEqual([]);
      expect(result.content.match(/<button>/g)).toHaveLength(count);
    }
  });
  it('provides captures and named groups to replace templates', async () => {
    const result = await run([template('<%= groups.value.toUpperCase() %>-<%= captures[0] %>', { position: 'replace', pattern: 'Narrative|(?<value>One)', flags: 'g' })]);
    expect(result.errors).toHaveLength(1);
    expect(result.content).toContain('Narrative');
    const valid = await run([template('<%= groups.value.toUpperCase() %>-<%= captures[0] %>', { position: 'replace', pattern: '(?<value>One)', flags: 'g' })]);
    expect(valid.content).toContain('ONE-One');
  });
  it('does not render streaming replies, mutate source variables or read another message state', async () => {
    const variables = { score: 12 };
    const result = await run([template('<% variables.score = 100; %><%= getvar("score") %>')], { variables });
    expect(variables.score).toBe(12);
    expect(result.content).toContain('12');
    const streaming = await run([template('<% throw new Error("Must not run"); %>')], { message: { role: 'assistant', status: 'streaming', content: 'Live' } });
    expect(streaming.errors).toEqual([]);
    const missing = await run([template('<%= getvar("score") %>')], { variables: null });
    expect(missing.errors[0].message).toContain('缺少变量快照');
  });
});
