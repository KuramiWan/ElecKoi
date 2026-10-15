// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { withLibraryVersions } from '../helpers/editorLibraryVersions.js';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DisplayTemplatesPanel, newDisplayTemplate } from '../../src/modules/displayTemplates/DisplayTemplatesPanel.jsx';
import { ScriptLibrariesPanel } from '../../src/modules/scripts/components/ScriptLibrariesPanel.jsx';
import { createScriptItem } from '../../src/modules/scripts/model/scriptEditing.js';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('React', React);
const type = async (element, value) => act(() => {
  const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('preset configuration shared ownership', () => {
  it('refreshes both EJS editor entries on save and keeps a conflicting unsaved draft', async () => {
    let library = { scope: 'global', ownerId: '', revision: 1, enabled: false,
      templates: [{ ...newDisplayTemplate('synthetic-template'), name: 'Synthetic template', source: '<p>Initial</p>' }] };
    const listeners = new Set(), refs = [createRef(), createRef()];
    const service = { read: vi.fn(async (scope, ownerId) => { return scope === 'global' ? structuredClone(library) : { scope, ownerId, revision: 0, enabled: false, templates: [] }; }),
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      saveAll: vi.fn(async drafts => drafts.map(draft => {
        if (draft.revision !== library.revision) throw new Error('Synthetic revision conflict');
        library = { ...structuredClone(draft), revision: draft.revision + 1 };
        listeners.forEach(listener => listener(library.scope, library.ownerId, { status: 'ready', value: structuredClone(library), error: '' }));
        return structuredClone(library);
      })) };
    withLibraryVersions(service, 'displayTemplates');
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    try {
      await act(async () => root.render(<>{refs.map((ref, index) => <div key={index} data-entry={index}>
        <DisplayTemplatesPanel ref={ref} scope={index === 0 ? "character" : "preset"} ownerId={index === 0 ? "synthetic-character" : "synthetic-preset"} displayTemplates={service} />
      </div>)}</>));
      const panels = [...node.querySelectorAll('[data-entry]')];
      for (const panel of panels) await act(() => panel.querySelector('.editor-library-name').click());
      const source = index => panels[index].querySelector('.script-source');
      await type(source(0), '<p>Saved first</p>');
      await act(async () => expect(await refs[0].current.save()).toBe(true));
      expect(source(1).value).toBe('<p>Saved first</p>');
      await type(source(1), '<p>Unsaved draft</p>');
      await type(source(0), '<p>Saved second</p>');
      await act(async () => expect(await refs[0].current.save()).toBe(true));
      expect(source(1).value).toBe('<p>Unsaved draft</p>');
      expect(panels[1].querySelector('[role=alert]').getAttribute('title')).toContain('其他窗口更新');
      await act(async () => expect(await refs[1].current.save()).toBe(false));
      expect(library.templates[0].source).toBe('<p>Saved second</p>');
      await act(() => refs[1].current.discard());
      expect(source(1).value).toBe('<p>Saved second</p>');
    } finally { await act(() => root.unmount()); node.remove(); }
    expect(listeners.size).toBe(0);
  });

  it('isolates owner scripts while sharing global scripts in both directions and preserving drafts on rename', async () => {
    const owners = { global: '', preset: 'synthetic-preset', character: 'synthetic-character' };
    const libraries = Object.fromEntries(Object.entries(owners).map(([scope, ownerId]) => [scope, { scope, ownerId, revision: 1, enabled: false, variables: {},
      trees: [{ ...createScriptItem('script', 'synthetic-module'), name: `Synthetic ${scope}` }] }]));
    const listeners = new Set(), refs = [createRef(), createRef()];
    const service = { activePreset: vi.fn(async () => ({ id: owners.preset, name: 'Synthetic preset' })),
      read: vi.fn(async (scope, ownerId) => { expect(ownerId).toBe(owners[scope]); return structuredClone(libraries[scope]); }),
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, subscribeChanges: () => () => {},
      saveAll: vi.fn(async drafts => drafts.map(draft => {
        if (draft.revision !== libraries[draft.scope].revision) throw new Error('Synthetic conflict');
        const next = libraries[draft.scope] = { ...structuredClone(draft), revision: draft.revision + 1 };
        listeners.forEach(listener => listener(next.scope, next.ownerId, { status: 'ready', value: structuredClone(next) }));
        return structuredClone(next);
      })), openDirectory: vi.fn() };
    withLibraryVersions(service, 'scripts');
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    try {
      await act(async () => root.render(<><div data-entry="character"><ScriptLibrariesPanel ref={refs[0]} characterId={owners.character} scriptLibraries={service} /></div>
        <div data-entry="preset"><ScriptLibrariesPanel ref={refs[1]} presetId={owners.preset} presetName="Synthetic preset" scriptLibraries={service} /></div></>));
      expect(service.activePreset).not.toHaveBeenCalled();
      const character = node.querySelector('[data-entry=character]'), preset = node.querySelector('[data-entry=preset]');
      expect([...character.querySelectorAll('.script-group')].map(group => group.getAttribute('aria-label'))).toEqual(['全局脚本', '角色脚本']);
      expect([...preset.querySelectorAll('.script-group')].map(group => group.getAttribute('aria-label'))).toEqual(['全局脚本', '预设脚本']);
      await act(() => character.querySelector('[aria-label=全局脚本] .script-list-name').click());
      await type(character.querySelector('.script-inspector input'), 'Synthetic updated preset');
      await act(async () => expect(await refs[0].current.save()).toBe(true));
      expect(service.saveAll).toHaveBeenLastCalledWith([expect.objectContaining({ scope: 'global', ownerId: '' })]);
      expect(preset.textContent).toContain('Synthetic updated preset');
      await act(() => preset.querySelector('.script-list-name').click());
      await type(preset.querySelector('.script-inspector input'), 'Synthetic reverse update');
      await act(async () => expect(await refs[1].current.save()).toBe(true));
      expect(character.querySelector('.script-inspector input').value).toBe('Synthetic reverse update');
      expect(libraries.character.trees[0].name).toBe('Synthetic character');
      expect(libraries.preset.trees[0].name).toBe('Synthetic preset');
      await type(preset.querySelector('.script-inspector input'), 'Synthetic unsaved script');
      await act(async () => root.render(<><div data-entry="character"><ScriptLibrariesPanel ref={refs[0]} characterId={owners.character} scriptLibraries={service} /></div>
        <div data-entry="preset"><ScriptLibrariesPanel ref={refs[1]} presetId={owners.preset} presetName="Synthetic renamed preset" scriptLibraries={service} /></div></>));
      expect(preset.querySelector('.script-inspector input').value).toBe('Synthetic unsaved script');
      expect(preset.textContent).toContain('Synthetic renamed preset');
    } finally { await act(() => root.unmount()); node.remove(); }
    expect(listeners.size).toBe(0);
  });
});


describe('shared globals arriving during an owner save', () => {
  it.each(['ejs', 'scripts'])('retains the accepted global refresh after %s finishes saving', async kind => {
    const owners = { global: '', character: 'synthetic-character' };
    const libraries = Object.fromEntries(Object.entries(owners).map(([scope, ownerId]) => [scope, kind === 'ejs'
      ? { scope, ownerId, revision: 1, enabled: false, templates: [{ ...newDisplayTemplate(scope), name: `Synthetic ${scope}` }] }
      : { scope, ownerId, revision: 1, enabled: false, variables: {}, trees: [{ ...createScriptItem('script', scope), name: `Synthetic ${scope}` }] }]));
    const listeners = new Set(), ref = createRef(); let finish, task;
    const service = { read: async scope => structuredClone(libraries[scope]),
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, subscribeChanges: () => () => {},
      saveAll: vi.fn(drafts => new Promise(resolve => {
        const global = libraries.global = { ...libraries.global, revision: 2 };
        const field = kind === 'ejs' ? 'templates' : 'trees'; global[field] = [{ ...global[field][0], name: 'Synthetic concurrent global' }];
        listeners.forEach(listener => listener('global', '', { status: 'ready', value: structuredClone(global) }));
        finish = () => resolve(drafts.map(draft => libraries[draft.scope] = { ...draft, revision: draft.revision + 1 }));
      })) };
    withLibraryVersions(service, kind === 'ejs' ? 'displayTemplates' : 'scripts');
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    try {
      await act(async () => root.render(kind === 'ejs'
        ? <DisplayTemplatesPanel scope="character" ownerId={owners.character} ref={ref} displayTemplates={service} />
        : <ScriptLibrariesPanel characterId={owners.character} ref={ref} scriptLibraries={service} />));
      const rows = node.querySelectorAll(kind === 'ejs' ? '.editor-library-name' : '.script-list-name'); await act(() => rows[1].click());
      await type(node.querySelector('.script-inspector input'), 'Synthetic accepted owner');
      await act(() => { task = ref.current.save(); });
      await act(async () => { finish(); expect(await task).toBe(true); });
      expect(node.textContent).toContain('Synthetic concurrent global');
      expect(node.querySelector('.script-inspector input').value).toBe('Synthetic accepted owner');
      expect(service.saveAll).toHaveBeenCalledWith([expect.objectContaining({ scope: 'character', ownerId: owners.character })]);
    } finally { await act(() => root.unmount()); node.remove(); }
  });
});
