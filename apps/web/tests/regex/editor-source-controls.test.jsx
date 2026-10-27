// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScriptLibrariesPanel } from '../../src/modules/scripts/components/ScriptLibrariesPanel.jsx';
import { RegexRulesPanel } from '../../src/modules/regex/components/RegexRulesPanel.jsx';
import { EditorPresentationContext } from '../../src/ui/ui/EditorPresentationContext.jsx';
import { createScriptItem } from '../../src/modules/scripts/model/scriptEditing.js';
import { editorCollectionService } from '../helpers/editorCollectionServices.js';


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
  return kind === 'regex' ? <RegexRulesPanel {...ownerProps(scope)} regexRules={model} ref={ref} /> : <ScriptLibrariesPanel {...ownerProps(scope)} scriptLibraries={model} ref={ref} />;
}

it.each(['scripts'].flatMap(kind => ['character', 'preset'].flatMap(scope => [false, true].map(compact => ({ kind, scope, compact })))))
  ('$kind $scope reuses immersive source editing and saves the exact content (compact=$compact)', async ({ kind, scope, compact }) => {
    const saved = vi.fn(), ref = createRef(), model = editorCollectionService(kind, scope, saved);
    await act(async () => root.render(<EditorPresentationContext.Provider value={{ compact }}>{editor(kind, scope, model, ref)}</EditorPresentationContext.Provider>));
    const group = node.querySelector(`.editor-library-group[aria-label="${scope === 'preset' ? '预设' : '角色'}脚本"]`);
    await act(() => group.querySelector(kind === 'scripts' ? '.script-list-name' : '.editor-library-name').click());
    if (compact) await act(() => [...node.querySelectorAll('.mobile-editor-actions button')].find(button => button.textContent.trim() === '编辑').click());
    const source = node.querySelector('.script-source');
    expect(source.value).toBe('');
    await act(() => [...node.querySelectorAll('button')].find(button => button.textContent.includes('沉浸编辑')).click());
    const dialog = document.querySelector('.immersive-markdown-editor');
    expect(dialog.querySelector('[role=tablist]')).toBeNull();
    const content = 'export default () => {\n  return () => {};\n};\n';
    await type(dialog.querySelector('textarea'), content);
    await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.immersive-markdown-editor')).toBeNull();
    expect(node.querySelector('.script-source').value).toBe(content);
    await act(async () => expect(await ref.current.save()).toBe(true));
    const savedLibrary = saved.mock.lastCall[0].find(value => value.scope === scope);
    expect(savedLibrary.trees[0].content).toBe(content);

  });

it.each(['regex', 'scripts'].flatMap(kind => ['character', 'preset'].flatMap(scope => [false, true].map(compact => ({ kind, scope, compact })))))
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
      await model.saveAll([library]);
    }
    saved.mockClear();
    const render = () => root.render(<EditorPresentationContext.Provider value={{ compact }}>{editor(kind, scope, model, ref)}</EditorPresentationContext.Provider>);
    const group = () => node.querySelector(`.editor-library-group[aria-label="${scope === 'preset' ? '预设' : '角色'}${kind === 'regex' ? '正则' : '脚本'}"]`);
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
    await act(() => [...node.querySelectorAll('.editor-scope-tabs [role=tab]')].find(tab => tab.textContent === '全局').click());
    expect(node.querySelectorAll('.editor-library-group')[0].querySelector('.editor-library-header input').checked).toBe(true);
    await act(() => [...node.querySelectorAll('.editor-scope-tabs [role=tab]')].find(tab => tab.textContent === (scope === 'preset' ? '预设' : '角色')).click());
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
