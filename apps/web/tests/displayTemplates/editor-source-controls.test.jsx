// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DisplayTemplatesPanel, newDisplayTemplate } from '../../src/modules/displayTemplates/DisplayTemplatesPanel.jsx';
import { ScriptLibrariesPanel } from '../../src/modules/scripts/components/ScriptLibrariesPanel.jsx';
import { RegexRulesPanel } from '../../src/modules/regex/components/RegexRulesPanel.jsx';
import { EditorPresentationContext } from '../../src/ui/ui/EditorPresentationContext.jsx';
import { createScriptItem } from '../../src/modules/scripts/model/scriptEditing.js';
import { editorCollectionService } from '../helpers/editorCollectionServices.js';
import { displayTemplateSchema } from '../../../../packages/shared/src/contracts/displayTemplates/schemas';
import { evaluateDisplayTemplates } from '../../src/modules/displayTemplates/runtime/evaluateDisplayTemplates.js';

vi.mock('../../src/modules/displayTemplates/runtime/runDisplayTemplates.js', () => ({
  runDisplayTemplates: input => evaluateDisplayTemplates(input),
}));

let node, root;
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(() => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
const type = async (element, value) => act(() => {
  const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
const ownerProps = scope => scope === 'preset' ? { presetId: `synthetic-${scope}` } : { characterId: `synthetic-${scope}` };
function editor(kind, scope, model, ref) {
  return kind === 'regex' ? <RegexRulesPanel {...ownerProps(scope)} regexRules={model} ref={ref} />
    : kind === 'scripts' ? <ScriptLibrariesPanel {...ownerProps(scope)} scriptLibraries={model} ref={ref} />
      : <DisplayTemplatesPanel scope={scope} ownerId={`synthetic-${scope}`} displayTemplates={model} ref={ref} />;
}

it.each(['templates', 'scripts'].flatMap(kind => ['character', 'preset'].flatMap(scope => [false, true].map(compact => ({ kind, scope, compact })))))
  ('$kind $scope reuses immersive source editing and saves the exact content (compact=$compact)', async ({ kind, scope, compact }) => {
    const saved = vi.fn(), ref = createRef(), model = editorCollectionService(kind, scope, saved);
    await act(async () => root.render(<EditorPresentationContext.Provider value={{ compact }}>{editor(kind, scope, model, ref)}</EditorPresentationContext.Provider>));
    const group = node.querySelector(`.editor-library-group[aria-label="${scope === 'preset' ? '预设' : '角色'}${kind === 'scripts' ? '脚本' : '显示模板'}"]`);
    await act(() => group.querySelector(kind === 'scripts' ? '.script-list-name' : '.editor-library-name').click());
    if (compact) await act(() => [...node.querySelectorAll('.mobile-editor-actions button')].find(button => button.textContent.trim() === '编辑').click());
    const source = node.querySelector('.script-source');
    if (kind === 'templates') {
      expect(source.value).toBe('');
      expect(node.textContent).toContain('AI 消息显示方式');
      expect(node.textContent).not.toMatch(/语法选项|移除多余空白/);
      expect([...node.querySelector('.script-inspector select').options].map(option => option.value)).toEqual(['before', 'after', 'replace']);
      expect(node.querySelector('.script-inspector > header [aria-label="测试显示模板"]')).toBeNull();
      expect(node.querySelector('.setting-library-content-actions [aria-label="测试显示模板"]')).toBeTruthy();
    } else expect(source.value).toBe('');
    await act(() => [...node.querySelectorAll('button')].find(button => button.textContent.includes('沉浸编辑')).click());
    const dialog = document.querySelector('.immersive-markdown-editor');
    expect(dialog.querySelector('[role=tablist]')).toBeNull();
    const content = kind === 'templates' ? '<div>合成显示</div>\n<%= rawContent %>' : 'export default () => {\n  return () => {};\n};\n';
    await type(dialog.querySelector('textarea'), content);
    await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.immersive-markdown-editor')).toBeNull();
    expect(node.querySelector('.script-source').value).toBe(content);
    await act(async () => expect(await ref.current.save()).toBe(true));
    const savedLibrary = saved.mock.lastCall[0].find(value => value.scope === scope);
    expect(kind === 'scripts' ? savedLibrary.trees[0].content : savedLibrary.templates[0].source).toBe(content);
    if (kind === 'templates') expect(Object.keys(savedLibrary.templates[0]).sort()).toEqual(['enabled', 'flags', 'id', 'name', 'pattern', 'position', 'source']);
  });

it.each(['regex', 'templates', 'scripts'].flatMap(kind => ['character', 'preset'].flatMap(scope => [false, true].map(compact => ({ kind, scope, compact })))))
  ('$kind $scope bulk switches include hidden entries and survive reopening (compact=$compact)', async ({ kind, scope, compact }) => {
    const saved = vi.fn(), ref = createRef(), model = editorCollectionService(kind, scope, saved);
    if (kind === 'regex') {
      const collection = await model.read(`synthetic-${scope}`), key = scope === 'preset' ? 'agentPresetRules' : 'characterRules';
      const second = { ...collection[key][0], id: 'synthetic-hidden-rule', name: '其他规则', enabled: false };
      const ids = field => collection[field].filter(rule => rule.enabled).map(rule => rule.id);
      const combination = { globalEnabledIds: ids('globalRules'), agentPresetEnabledIds: ids('agentPresetRules'), characterEnabledIds: ids('characterRules') };
      await model.save(`synthetic-${scope}`, { ...collection, [key]: [...collection[key], second], activeVersionId: 'synthetic-active',
        versions: [{ id: 'synthetic-active', name: '合成当前组合', ...combination }, { id: 'synthetic-other', name: '合成其他组合', ...combination }] });
    } else {
      const library = await model.read(scope);
      if (kind === 'scripts') library.trees.push({ ...createScriptItem('folder', 'synthetic-hidden-folder'), name: '其他分组', enabled: false,
        scripts: [{ ...createScriptItem('script', 'synthetic-hidden-script'), enabled: false }] });
      else library.templates.push({ ...newDisplayTemplate('synthetic-hidden-template'), name: '其他模板' });
      await model.saveAll([library]);
    }
    saved.mockClear();
    const render = () => root.render(<EditorPresentationContext.Provider value={{ compact }}>{editor(kind, scope, model, ref)}</EditorPresentationContext.Provider>);
    const group = () => node.querySelectorAll('.editor-library-group')[1];
    const header = () => group().querySelector('.editor-library-header input');
    const itemSwitches = () => [...group().querySelectorAll('.editor-library-rows input[type=checkbox]')];
    await act(async () => render());
    await type(node.querySelector('.editor-collection-search input'), '合成');
    await act(() => header().click());
    expect(itemSwitches().every(input => !input.checked)).toBe(true);
    await act(async () => expect(await ref.current.save()).toBe(true));
    if (kind === 'regex') {
      const value = saved.mock.lastCall[0], key = scope === 'preset' ? 'agentPresetEnabledIds' : 'characterEnabledIds';
      expect(value.versions.find(version => version.id === 'synthetic-active')[key]).toEqual([]);
      expect(value.versions.find(version => version.id === 'synthetic-other')[key]).toEqual([`synthetic-${scope}`]);
    }
    await act(() => root.unmount()); root = createRoot(node); await act(async () => render());
    expect(header().checked).toBe(false);
    expect(itemSwitches().length).toBeGreaterThan(1);
    expect(itemSwitches().every(input => !input.checked)).toBe(true);
    expect(node.querySelectorAll('.editor-library-group')[0].querySelector('.editor-library-header input').checked).toBe(true);
    await act(() => header().click());
    expect(itemSwitches().every(input => input.checked)).toBe(true);
    await act(async () => expect(await ref.current.save()).toBe(true));
    if (kind === 'regex') {
      const value = saved.mock.lastCall[0], key = scope === 'preset' ? 'agentPresetEnabledIds' : 'characterEnabledIds';
      expect(value.versions.find(version => version.id === 'synthetic-active')[key]).toEqual([`synthetic-${scope}`, 'synthetic-hidden-rule']);
      expect(value.versions.find(version => version.id === 'synthetic-other')[key]).toEqual([`synthetic-${scope}`]);
    }
    await act(() => root.unmount()); root = createRoot(node); await act(async () => render());
    expect(header().checked).toBe(true);
    expect(itemSwitches().every(input => input.checked)).toBe(true);
  });

it('tests only the selected template and displays failures inside the test dialog', async () => {
  const model = editorCollectionService('templates', 'character'), library = await model.read('character');
  library.enabled = false;
  library.templates = [
    { ...newDisplayTemplate('synthetic-selected'), name: '合成当前模板', source: '<div>Selected</div>' },
    { ...newDisplayTemplate('synthetic-other'), name: '合成其他模板', enabled: true, source: '<% throw new Error("Other template must not run") %>' },
  ];
  await model.saveAll([library]);
  await act(async () => root.render(editor('templates', 'character', model, createRef())));
  await act(() => node.querySelectorAll('.editor-library-group')[1].querySelector('.editor-library-name').click());
  await act(() => node.querySelector('.setting-library-content-actions [aria-label="测试显示模板"]').click());
  const dialog = () => document.querySelector('.editor-management-modal');
  const run = () => [...dialog().querySelectorAll('button')].find(button => button.textContent.trim() === '测试模板');
  await type(dialog().querySelector('textarea'), 'Synthetic narrative');
  await act(async () => run().click());
  expect(dialog().querySelector('textarea[readonly]').value).toContain('Selected');
  expect(dialog().querySelector('[role=alert]')).toBeNull();
  await type(dialog().querySelectorAll('textarea')[1], '[]');
  await act(async () => run().click());
  expect(dialog().querySelector('[role=alert]').textContent).toBe('测试变量必须是 JSON 对象。');
  expect(dialog().querySelector('textarea[readonly]').value).toBe('');
  await act(() => dialog().querySelector('[aria-label="关闭"]').click());
  expect(document.querySelector('.editor-management-modal')).toBeNull();
});

it('rejects the removed shared-template mode without converting it into another mode', () => {
  expect(displayTemplateSchema.safeParse({ ...newDisplayTemplate('synthetic-template'), position: 'partial' }).success).toBe(false);
});
