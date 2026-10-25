// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MainPageContext } from '../../src/app/windows/MainPageContext.jsx';
import { MobileCreatorStudioConversation } from '../../src/mobile/MobileCreatorStudioConversation.jsx';
import { CreatorStudioConversation } from '../../src/modules/creatorStudio/components/CreatorStudioConversation.jsx';

vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root, node;
afterEach(async () => { if (root) await act(() => root.unmount()); node?.remove(); });
async function mount(initialView = 'chat', Component = MobileCreatorStudioConversation) {
  let store = { view: initialView, viewRequest: null };
  const listeners = new Set(), snapshot = () => store, subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const openView = vi.fn((view, focus) => { store = { view, viewRequest: { view, focus } }; listeners.forEach(listener => listener()); });
  const completeViewRequest = vi.fn(), inspectCall = vi.fn();
  let tabs = [{ id: 'chat', label: '对话' }, { id: 'trajectory', label: '轨迹' }];
  const tabSnapshot = () => tabs;
  const model = { readDefaultModel: vi.fn(async () => null), refresh: vi.fn(async () => {}), selectModel: vi.fn(), regenerate: vi.fn() };
  const models = { subscribe: () => () => {}, getSnapshot: () => modelsSnapshot }, modelsSnapshot = { configs: [] };
  const renderSlot = vi.fn((name, owner, options) => name === 'eleckoi.creator-studio.view'
    ? <div data-slot={name} data-view={options.only}>合成 {options.only}</div>
    : name === 'eleckoi.creator-studio.composer.bar' ? <input data-composer-input="" aria-label="合成输入" /> : null);
  const props = { sessionId: 'synthetic-studio-session', model, models, onError: vi.fn(),
    useSession: select => select({ running: false, blank: false }), useInput: select => select({}), useSessionStatus: select => select(new Map()),
    useProjection: () => null, useInspectCall: select => select(inspectCall), useStore: select => select(useSyncExternalStore(subscribe, snapshot)),
    useConversationViews: select => select(useSyncExternalStore(subscribe, tabSnapshot)),
    useEntryPins: select => select([]), useEntryActions: select => select(false), setPinned: vi.fn(),
    actions: { completeViewRequest }, openView, selectView: id => openView(id),
    renderHeaderSlot: name => name.endsWith('.corner') ? <button data-sidebar-right-expand="" aria-label="展开右侧栏">侧栏</button> : null,
    renderSlot, renderSlotChain: (_name, _owner, options) => options.fallback };
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await act(() => root.render(<MainPageContext.Provider value={{ models, registerBackHandler: () => () => {} }}><Component {...props} /></MainPageContext.Provider>));
  return { openView, completeViewRequest, inspectCall, model, renderSlot, getStore: snapshot,
    publishTabs(next) { tabs = next; listeners.forEach(listener => listener()); }, getTabs: tabSnapshot };
}
async function select(label) { await act(() => [...node.querySelectorAll('[role=tab]')].find(button => button.textContent === label).click()); }
it('switches the shared Studio view while keeping the same composer and official inspection focus', async () => {
  const f = await mount(), input = node.querySelector('[data-composer-input]'); input.value = '合成草稿';
  expect([...node.querySelectorAll('[role=tab]')].map(button => button.textContent)).toEqual(['对话', '轨迹']);
  await select('轨迹');
  expect(f.openView).toHaveBeenLastCalledWith('trajectory');
  expect(node.querySelector('.creator-studio-trajectory [data-view]').dataset.view).toBe('trajectory');
  expect(node.querySelector('.creator-studio-native-detail')).toBeNull();
  expect(node.querySelector('[data-composer-input]')).toBe(input); expect(input.value).toBe('合成草稿');
  const owner = f.renderSlot.mock.calls.filter(call => call[0] === 'eleckoi.creator-studio.view').at(-1)[1];
  expect(owner).toMatchObject({ inspectCall: f.inspectCall, viewRequest: f.getStore().viewRequest, completeViewRequest: f.completeViewRequest, openView: f.openView });
  await act(() => f.openView('trajectory', 'synthetic-focus'));
  const focused = f.renderSlot.mock.calls.filter(call => call[0] === 'eleckoi.creator-studio.view').at(-1)[1];
  expect(focused.viewRequest).toEqual({ view: 'trajectory', focus: 'synthetic-focus' });
  await select('对话');
  expect(node.querySelector('[data-conversation-scroll] [data-view]').dataset.view).toBe('chat');
  expect(node.querySelector('[data-composer-input]')).toBe(input); expect(input.value).toBe('合成草稿');
  expect(f.model.selectModel).not.toHaveBeenCalled(); expect(f.model.regenerate).not.toHaveBeenCalled(); expect(f.model.refresh).toHaveBeenCalledOnce();
});
it.each([MobileCreatorStudioConversation, CreatorStudioConversation])('follows plugin view registration, restore and unload with the same composer in $name', async Component => {
  const f = await mount('synthetic-gallery', Component), input = node.querySelector('[data-composer-input]');
  input.value = '保留草稿';
  expect(node.querySelector('[data-sidebar-right-expand]')).toBeTruthy();
  await act(() => f.publishTabs([...f.getTabs(), { id: 'synthetic-gallery', label: '插件画廊' }]));
  expect(node.querySelector('[role=tab][aria-selected=true]').textContent).toBe('插件画廊');
  expect(node.querySelector('[data-view]').dataset.view).toBe('synthetic-gallery');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await select('对话'); await select('插件画廊');
  expect(f.openView).toHaveBeenLastCalledWith('synthetic-gallery');
  await act(() => f.publishTabs(f.getTabs().filter(tab => tab.id !== 'synthetic-gallery')));
  expect(node.querySelector('[role=tab][aria-selected=true]').textContent).toBe('对话');
  expect(node.querySelector('[data-view]').dataset.view).toBe('chat');
  expect(node.querySelector('[data-composer-input]')).toBe(input); expect(input.value).toBe('保留草稿');
});
it('restores and follows the official trajectory view without opening a details dialog', async () => {
  const f = await mount('trajectory');
  expect(node.querySelector('[role=tab][aria-selected=true]').textContent).toBe('轨迹');
  expect(node.querySelector('.creator-studio-native-detail')).toBeNull();
  await act(() => f.openView('chat'));
  expect(node.querySelector('[role=tab][aria-selected=true]').textContent).toBe('对话');
  expect(node.querySelector('[data-conversation-scroll] [data-view]').dataset.view).toBe('chat');
});
