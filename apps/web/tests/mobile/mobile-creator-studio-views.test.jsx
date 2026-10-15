// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MainPageContext } from '../../src/app/windows/MainPageContext.jsx';
import { MobileCreatorStudioConversation } from '../../src/mobile/MobileCreatorStudioConversation.jsx';

vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root, node;
afterEach(async () => { if (root) await act(() => root.unmount()); node?.remove(); });
async function mount(initialView = 'chat') {
  let store = { view: initialView, viewRequest: null };
  const listeners = new Set(), snapshot = () => store, subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const openView = vi.fn((view, focus) => { store = { view, viewRequest: { view, focus } }; listeners.forEach(listener => listener()); });
  const completeViewRequest = vi.fn(), inspectCall = vi.fn();
  const model = { readDefaultModel: vi.fn(async () => null), refresh: vi.fn(async () => {}), selectModel: vi.fn(), regenerate: vi.fn() };
  const models = { subscribe: () => () => {}, getSnapshot: () => modelsSnapshot }, modelsSnapshot = { configs: [] };
  const renderSlot = vi.fn((name, owner, options) => name === 'eleckoi.creator-studio.view'
    ? <div data-slot={name} data-view={options.only}>合成 {options.only}</div>
    : name === 'eleckoi.creator-studio.composer.bar' ? <input data-composer-input="" aria-label="合成输入" /> : null);
  const props = { sessionId: 'synthetic-studio-session', model, onError: vi.fn(),
    useSession: select => select({ running: false, blank: false }), useInput: select => select({}), useSessionStatus: select => select(new Map()),
    useProjection: () => null, useInspectCall: select => select(inspectCall), useStore: select => select(useSyncExternalStore(subscribe, snapshot)),
    actions: { completeViewRequest }, openView, renderSlot, renderSlotChain: (_name, _owner, options) => options.fallback };
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(() => root.render(<MainPageContext.Provider value={{ models, registerBackHandler: () => () => {} }}><MobileCreatorStudioConversation {...props} /></MainPageContext.Provider>));
  return { openView, completeViewRequest, inspectCall, model, renderSlot, getStore: snapshot };
}
async function select(label) { await act(() => [...node.querySelectorAll('[role=tab]')].find(button => button.textContent === label).click()); }
it('switches the shared Studio view while keeping the same composer and routes details back to the selected tab', async () => {
  const f = await mount(), input = node.querySelector('[data-composer-input]'); input.value = '合成草稿';
  expect([...node.querySelectorAll('[role=tab]')].map(button => button.textContent)).toEqual(['对话', '轨迹']);
  await select('轨迹');
  expect(f.openView).toHaveBeenLastCalledWith('trajectory');
  expect(node.querySelector('.creator-studio-trajectory [data-view]').dataset.view).toBe('trajectory');
  expect(node.querySelector('.creator-studio-native-detail')).toBeNull();
  expect(node.querySelector('[data-composer-input]')).toBe(input); expect(input.value).toBe('合成草稿');
  const owner = f.renderSlot.mock.calls.filter(call => call[0] === 'eleckoi.creator-studio.view').at(-1)[1];
  expect(owner).toMatchObject({ inspectCall: f.inspectCall, viewRequest: f.getStore().viewRequest, completeViewRequest: f.completeViewRequest, openView: f.openView });
  await act(() => f.openView('synthetic-detail', 'synthetic-focus'));
  expect(node.querySelector('.creator-studio-native-detail [data-view]').dataset.view).toBe('synthetic-detail');
  await act(() => node.querySelector('.creator-studio-native-detail [aria-label="关闭"]').click());
  expect(f.openView).toHaveBeenLastCalledWith('trajectory'); expect(node.querySelector('.creator-studio-native-detail')).toBeNull();
  await select('对话');
  expect(node.querySelector('[data-conversation-scroll] [data-view]').dataset.view).toBe('chat');
  expect(node.querySelector('[data-composer-input]')).toBe(input); expect(input.value).toBe('合成草稿');
  expect(f.model.selectModel).not.toHaveBeenCalled(); expect(f.model.regenerate).not.toHaveBeenCalled(); expect(f.model.refresh).toHaveBeenCalledOnce();
});
it('restores and follows the official trajectory view without opening a details dialog', async () => {
  const f = await mount('trajectory');
  expect(node.querySelector('[role=tab][aria-selected=true]').textContent).toBe('轨迹');
  expect(node.querySelector('.creator-studio-native-detail')).toBeNull();
  await act(() => f.openView('chat'));
  expect(node.querySelector('[role=tab][aria-selected=true]').textContent).toBe('对话');
  expect(node.querySelector('[data-conversation-scroll] [data-view]').dataset.view).toBe('chat');
});
