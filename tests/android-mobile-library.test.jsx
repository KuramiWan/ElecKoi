// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainPageContext } from '../apps/web/src/app/windows/MainPageContext.jsx';
import { MobileCharactersPage } from '../apps/web/src/mobile/MobileCharactersPage.jsx';
import { MobilePresetsPage } from '../apps/web/src/mobile/MobilePresetsPage.jsx';

const fixture = vi.hoisted(() => ({ presets: null }));
vi.mock('../apps/web/src/modules/presets/components/PresetPanel.jsx', () => ({ PresetProvider: ({ children }) => children, PresetWorkspace: () => null, usePresets: () => fixture.presets }));
vi.mock('../apps/web/src/app/windows/CharacterEditorWindow.jsx', () => ({ CharacterEditorWindow: () => null }));
globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, view, saveGroups, start, select, renderSection, maskEvents, backHandlers;
const samples = [
  { id: 'character-a', name: '合成角色甲', description: '正式简介甲', profileLike: '旧字段内容', group: '分组甲', persona: {} },
  { id: 'character-b', name: '合成角色乙', description: '正式简介乙', group: '分组乙', persona: {} },
  { id: 'character-c', name: '合成角色丙', description: '', group: '', persona: {} },
];
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  backHandlers = []; saveGroups = vi.fn(); start = vi.fn(); select = vi.fn(); renderSection = vi.fn((key, owner, fallback) => fallback);
  maskEvents = [];
  document.addEventListener('eleckoi:system-bar-mask', recordMask);
});

function recordMask(event) { maskEvents.push(event.detail); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; document.body.replaceChildren(); document.removeEventListener('eleckoi:system-bar-mask', recordMask); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(page = 'character', initialRoute = { kind: 'root' }) {
  function Harness() {
    const [route, setRoute] = useState(initialRoute);
    const [collection, setCollection] = useState({ items: structuredClone(samples), groups: ['分组甲', '分组乙'], active_character_id: 'character-a' });
    view = { route, routeBusy: false, scrollPositions: new Map(), guardRef: { current: null }, characters: { exportCharacters: vi.fn() },
      openDrawer: vi.fn(), pushRoute: setRoute, replaceRoute: setRoute, goBack: () => setRoute({ kind: 'root' }), openCharacterConversation: start,
      registerBackHandler: callback => { backHandlers.push(callback); return () => { backHandlers = backHandlers.filter(item => item !== callback); }; },
      renderCharacterPageSection: renderSection,
      chat: { characters: collection, selectCharacter: select, persona: { user_name: '合成用户' }, notify: vi.fn(),
        saveCharacterGroups: async (groups, assignments = []) => { await saveGroups(groups, assignments); setCollection(current => ({ ...current, groups, items: current.items.map(item => ({ ...item, group: assignments.find(value => value.characterId === item.id)?.group ?? item.group })) })); },
        deleteCharacterIds: vi.fn() },
    };
    return <MainPageContext.Provider value={view}><main className="mobile-shell">{page === 'character' ? <MobileCharactersPage /> : <MobilePresetsPage />}</main></MainPageContext.Provider>;
  }
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(<Harness />));
}
async function click(label, within = document) {
  const button = [...within.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label);
  expect(button, label).toBeTruthy(); await act(async () => button.click());
}
async function input(value) {
  const node = document.querySelector('input[aria-label="名称"]');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('Android character and preset library contracts', () => {
  it('uses a single portrait through the official slot and keeps actions outside the long introduction scroll', async () => {
    await mount('character', { kind: 'character-profile', characterId: 'character-a' });
    expect(document.querySelector('.character-deck')).toBeNull();
    expect(document.querySelector('.character-profile-portrait')).toBeTruthy();
    expect(document.querySelector('.character-profile-scroll .character-profile-actions')).toBeNull();
    expect(document.querySelector('.character-profile-scroll').nextElementSibling.className).toBe('character-profile-actions');
    expect(document.querySelector('.mobile-header [aria-label="编辑角色"]')).toBeNull();
    expect(document.querySelector('select')).toBeNull();
    expect(document.querySelector('.character-profile-copy').textContent).toContain('正式简介甲');
    expect(document.querySelector('.character-profile-copy').textContent).not.toContain('旧字段内容');
    expect(renderSection.mock.calls[0][0]).toBe('profile');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(select).not.toHaveBeenCalled();
    await click('开始对话'); expect(start).toHaveBeenCalledWith('character-a');
    await click('编辑角色'); expect(view.route).toEqual({ kind: 'character-editor', characterId: 'character-a' });
  });
  it('opens the anchored action menu, restores focus and enters a full-page manager', async () => {
    await mount(); await click('角色操作');
    const menu = document.querySelector('.mobile-bubble-menu');
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(5);
    expect(menu.querySelectorAll('hr')).toHaveLength(2);
    expect(document.querySelector('.mobile-dialog')).toBeNull();
    expect(maskEvents.filter(event => event.active)).toHaveLength(1);
    await act(async () => backHandlers.at(-1)());
    expect(document.activeElement.getAttribute('aria-label')).toBe('角色操作'); expect(maskEvents.filter(event => !event.active)).toHaveLength(1);
    await click('角色操作'); await click('分组管理');
    expect(view.route.kind).toBe('character-groups');
    expect(document.querySelector('.mobile-group-manager')).toBeTruthy(); expect(document.querySelector('.mobile-bubble-menu')).toBeNull();
  });
  it('renames memberships atomically, rejects duplicate names, and confirms deletion with the PC destination', async () => {
    await mount('character', { kind: 'character-groups' });
    await click('分组甲 (1)'); await input('分组乙'); await click('保存');
    expect(saveGroups).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]').textContent).toContain('已存在');
    await input('分组丙'); await click('保存');
    expect(saveGroups).toHaveBeenLastCalledWith(['分组丙', '分组乙'], [{ characterId: 'character-a', group: '分组丙' }]);
    await click('删除分组'); await click('删除分组 分组丙');
    expect(saveGroups).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.mobile-library-dialog').textContent).toContain('移至“分组乙”');
    await click('删除', document.querySelector('.mobile-library-dialog'));
    expect(saveGroups).toHaveBeenLastCalledWith(['分组乙'], [{ characterId: 'character-a', group: '分组乙' }]);
  });
  it('saves explicit group membership without touching other unselected groups and keeps failed saves open', async () => {
    await mount('character', { kind: 'character-groups' }); await click('管理分组 分组甲 的角色');
    await click('合成角色甲'); await click('合成角色丙');
    saveGroups.mockRejectedValueOnce(new Error('保存失败'));
    await click('保存'); expect(document.querySelector('.mobile-library-selection-header')).toBeTruthy();
    expect(document.querySelector('[role="alert"]').textContent).toContain('保存失败');
    await click('保存');
    expect(saveGroups).toHaveBeenLastCalledWith(['分组甲', '分组乙'], [{ characterId: 'character-a', group: '' }, { characterId: 'character-c', group: '分组甲' }]);
  });
  it('keeps group order in the formal group list and supports keyboard reordering', async () => {
    await mount('character', { kind: 'character-groups' });
    await act(async () => document.querySelector('[aria-label="调整分组 分组乙 的顺序"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(saveGroups).toHaveBeenLastCalledWith(['分组乙', '分组甲'], []);
  });
  it('excludes the protected default preset from batch deletion and retries only failed IDs', async () => {
    const presets = ['agent-preset-standard', 'preset-a', 'preset-b'].map((id, index) => ({ id, name: `合成预设${index}`, libraryGroupId: '', profile: {}, modelTags: [] }));
    const remove = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('写入失败')).mockResolvedValue({});
    fixture.presets = { catalog: { presets, groups: [], activePresetId: 'agent-preset-standard' }, catalogModel: { delete: remove }, setSelectedPresetId: vi.fn(), refresh: vi.fn() };
    await mount('presets'); await click('预设操作');
    expect([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['新建预设', '导入预设', '导出预设', '批量删除']);
    await click('批量删除'); await click('全选');
    expect(document.querySelector('.mobile-selection-bar').textContent).toContain('2 项');
    expect(document.querySelector('.mobile-preset-open').disabled).toBe(true);
    await click('删除'); await click('删除', document.querySelector('.mobile-library-dialog'));
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['preset-a', 'preset-b']);
    expect(document.querySelector('.mobile-selection-bar').textContent).toContain('1 项');
    expect(document.querySelector('.mobile-library-dialog [role="alert"]').textContent).toContain('写入失败');
    await click('删除', document.querySelector('.mobile-library-dialog'));
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['preset-a', 'preset-b', 'preset-b']);
    expect(document.querySelector('.mobile-library-selection-header')).toBeNull();
  });
});
