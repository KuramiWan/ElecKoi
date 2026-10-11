// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ScriptLibrariesPanel } from '../apps/web/src/modules/scripts/components/ScriptLibrariesPanel.jsx';
import { createScriptItem } from '../apps/web/src/modules/scripts/model/scriptEditing.js';
import { EditorPresentationContext } from '../apps/web/src/ui/ui/EditorPresentationContext.jsx';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('React', React);

describe('native script library status display', () => {
  it('shows scoped runtime status and errors for matching source only, then withdraws them with the service', async () => {
    const owners = { global: '', character: 'synthetic-character', preset: 'synthetic-preset' };
    const libraries = Object.fromEntries(Object.entries(owners).map(([scope, ownerId]) => [scope, {
      scope, ownerId, enabled: true, revision: 1, variables: {}, trees: [
        { ...createScriptItem('script', 'synthetic-script'), enabled: true, name: `Synthetic ${scope} script`, content: 'export default () => {}' },
      ],
    }]));
    const statuses = Object.fromEntries(Object.entries(owners).map(([scope, ownerId]) => [JSON.stringify([scope, ownerId, 'synthetic-script']), {
      key: JSON.stringify([scope, ownerId, 'synthetic-script']), id: 'synthetic-script', scope, ownerId,
      source: scope === 'preset' ? 'export default () => { /* previous generation */ }' : 'export default () => {}',
      status: scope === 'global' ? 'error' : 'running', error: scope === 'global' ? 'Synthetic global startup error' : '',
    }]));
    const listeners = new Set(), connectionListeners = new Set();
    const snapshot = { scriptStatuses: statuses, error: '' };
    const runtime = { getSnapshot: () => snapshot,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
    let current = runtime;
    const connection = { getSnapshot: () => current,
      subscribe: listener => { connectionListeners.add(listener); return () => connectionListeners.delete(listener); } };
    const services = {
      activePreset: async () => ({ id: 'synthetic-preset', name: 'Synthetic preset' }),
      read: async (scope, ownerId) => { expect(ownerId).toBe(owners[scope]); return structuredClone(libraries[scope]); },
      subscribe: () => () => {}, subscribeChanges: () => () => {}, saveAll: vi.fn(), openDirectory: vi.fn(async () => {}),
    };
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    try {
      await act(async () => root.render(<ScriptLibrariesPanel characterId="synthetic-character" scriptLibraries={services} scriptRuntimeConnection={connection} />));
      const group = scope => node.querySelector(`[aria-label="${{ global: '全局脚本', character: '角色脚本', preset: '预设脚本' }[scope]}"]`);
      for (const [scope, label] of Object.entries({ global: '全局脚本', character: '角色脚本', preset: '预设脚本' })) {
        await act(async () => node.querySelector(`[aria-label="打开${label}目录"]`).click());
        expect(services.openDirectory).toHaveBeenLastCalledWith(scope, owners[scope]);
      }
      expect(services.saveAll).not.toHaveBeenCalled();
      services.openDirectory.mockRejectedValueOnce(new Error('Synthetic directory open failure'));
      await act(async () => node.querySelector('[aria-label="打开角色脚本目录"]').click());
      expect(node.textContent).toContain('Synthetic directory open failure');
      expect(services.saveAll).not.toHaveBeenCalled();
      expect(group('global').querySelector('.script-state').textContent).toBe('运行错误');
      expect(group('character').querySelector('.script-state').textContent).toBe('运行中');
      expect(group('preset').querySelector('.script-state').textContent).toBe('未启动');
      await act(async () => group('global').querySelector('.script-list-name').click());
      expect(node.querySelector('.script-inspector [role=alert]').textContent).toBe('Synthetic global startup error');
      await act(async () => group('character').querySelector('.script-list-name').click());
      expect(node.querySelector('.script-inspector [role=alert]')).toBeNull();
      await act(async () => { current = null; connectionListeners.forEach(listener => listener()); });
      expect(group('global').querySelector('.script-state').textContent).toBe('运行环境未就绪');
      expect(listeners.size).toBe(0);
    } finally { await act(async () => root.unmount()); node.remove(); }
    expect(connectionListeners.size).toBe(0);
  });
});

describe('script library editing commands', () => {
  async function mount(compact = false) {
    const libraries = Object.fromEntries(['global', 'character', 'preset'].map(scope => [scope, {
      scope, ownerId: scope === 'global' ? '' : `synthetic-${scope}`, enabled: true, revision: 1, variables: {},
      trees: [{ ...createScriptItem('script', 'synthetic-script'), name: `Synthetic ${scope} script` }],
    }]));
    const service = {
      activePreset: async () => ({ id: 'synthetic-preset', name: 'Synthetic preset' }),
      read: async scope => structuredClone(libraries[scope]), subscribe: () => () => {}, subscribeChanges: () => () => {},
      saveAll: vi.fn(async values => values.map(library => ({ ...library, revision: library.revision + 1 }))),
      openDirectory: vi.fn(),
    };
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    await act(async () => root.render(<EditorPresentationContext.Provider value={{ compact }}>
      <ScriptLibrariesPanel characterId="synthetic-character" scriptLibraries={service} />
    </EditorPresentationContext.Provider>));
    const row = scope => node.querySelector(`[aria-label="${{ global: '全局脚本', character: '角色脚本', preset: '预设脚本' }[scope]}"] .script-list-row`);
    const menu = () => document.querySelector('[role="menu"][aria-label="脚本操作"]');
    const rightClick = async scope => act(() => row(scope).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })));
    const action = async label => act(() => [...menu().querySelectorAll('button')].find(button => button.textContent === label).click());
    return { node, service, row, menu, rightClick, action, async close() { await act(() => root.unmount()); node.remove(); } };
  }

  it('uses the shared toolbar-offset inspector and removes folder creation and assignment controls', async () => {
    const page = await mount();
    try {
      expect(page.node.querySelector('[aria-label*="新建"][aria-label*="文件夹"], [aria-label*="新建"][aria-label*="分组"]')).toBeNull();
      await page.rightClick('character'); await page.action('编辑');
      const pane = page.node.querySelector('.editor-sidebar-pane');
      expect(pane.classList.contains('is-overlay')).toBe(true);
      expect(page.node.querySelector('.script-toolbar').closest('.editor-sidebar-pane')).toBeNull();
      expect(page.node.querySelector('.script-inspector select')).toBeNull();
      expect(page.node.querySelector('.script-inspector input').value).toBe('Synthetic character script');
    } finally { await page.close(); }
  });

  it('copies, toggles and deletes the right-clicked script, not a same-ID script selected in another scope', async () => {
    const page = await mount();
    try {
      await act(() => page.row('character').querySelector('button').click());
      await page.rightClick('global'); await page.action('复制');
      const global = page.node.querySelector('[aria-label="全局脚本"]');
      expect(global.querySelectorAll('.script-list-row')).toHaveLength(2);
      expect(page.node.querySelector('[aria-label="角色脚本"]').querySelectorAll('.script-list-row')).toHaveLength(1);
      await page.rightClick('global'); await page.action('启用');
      expect(page.row('global').querySelector('input[type="checkbox"]').checked).toBe(true);
      await act(() => page.row('character').querySelector('button').click());
      await page.rightClick('global'); await page.action('删除');
      const dialog = document.querySelector('[role="alertdialog"]');
      expect(dialog.textContent).toContain('Synthetic global script');
      await act(() => [...dialog.querySelectorAll('button')].find(button => button.textContent === '删除').click());
      expect(page.node.querySelector('.script-inspector input').value).toBe('Synthetic character script');
      expect(global.querySelectorAll('.script-list-row')).toHaveLength(1);
      await act(() => page.node.querySelector('.setting-library-save-button').click());
      expect(page.service.saveAll).toHaveBeenCalledWith([expect.objectContaining({ scope: 'global',
        trees: [expect.objectContaining({ name: 'Synthetic global script 副本' })] })]);
    } finally { await page.close(); }
  });

  it('supports menu keyboard dismissal and keeps saving available in the compact editor', async () => {
    const page = await mount(true);
    try {
      await page.rightClick('character');
      expect(document.activeElement.textContent).toBe('编辑');
      await act(() => page.menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
      expect(document.activeElement.textContent).toBe('复制');
      await act(() => page.menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(page.menu()).toBeNull();
      expect(document.activeElement).toBe(page.row('character').querySelector('button'));
      await page.rightClick('character'); await page.action('编辑');
      expect(page.node.querySelector('.editor-page-list').hidden).toBe(true);
      expect(page.node.querySelector('.editor-page-feedback .setting-library-save-button')).toBeTruthy();
      await act(() => page.node.querySelector('[aria-label="关闭编辑器"]').click());
      expect(page.node.querySelector('.editor-page-list').hidden).toBe(false);
    } finally { await page.close(); }
  });
});
