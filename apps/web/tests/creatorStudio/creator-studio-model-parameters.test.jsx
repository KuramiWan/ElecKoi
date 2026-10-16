// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MainPageContext } from '../../src/app/windows/MainPageContext.jsx';
import { CreatorStudioConversation } from '../../src/modules/creatorStudio/components/CreatorStudioConversation.jsx';
import { MobileCreatorStudioConversation } from '../../src/mobile/MobileCreatorStudioConversation.jsx';

let root, container;
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function fixture() {
  const configs = [{ id: 'synthetic-studio-provider', name: '合成工作室接口', provider: 'custom', model: 'synthetic-main',
    model_options: [{ id: 'synthetic-main', topP: 0.8 }, { id: 'synthetic-peer', topP: 0.6 }] }];
  const modelSnapshot = { configs };
  const models = { subscribe: () => () => {}, getSnapshot: () => modelSnapshot,
    save: vi.fn(async config => config), discover: vi.fn() };
  const session = { running: false, blank: true };
  const model = { readDefaultModel: vi.fn(async () => ({ provider: configs[0].id, model: 'synthetic-main' })),
    refresh: vi.fn(async () => {}), selectModel: vi.fn(async () => {}) };
  const projection = { next: { provider: configs[0].id, model: 'synthetic-peer' } };
  const props = { model, models, title: '合成工作室', presetName: '合成创作预设', onError: vi.fn(), sessionId: 'synthetic-studio-session',
    useSession: select => select(session), useInput: select => select({}), useSessionStatus: select => select(new Map()),
    useProjection: key => key === 'modelSelection' ? projection : null, useInspectCall: select => select({}), useStore: select => select({ view: 'chat' }),
    useConversationViews: select => select([{ id: 'chat', label: '对话' }, { id: 'trajectory', label: '轨迹' }]),
    actions: {}, openView: vi.fn(), selectView: vi.fn(), renderHeaderSlot: () => null,
    renderSlot: (name, owner) => name === 'eleckoi.creator-studio.composer.bar' ? owner.modelAccessory : null,
    renderSlotChain: (_name, _owner, options) => options.fallback };
  return { props, models, model, configs };
}
async function openAndEdit() {
  await act(async () => container.querySelector('button[title="选择模型"]').click());
  const dialog = document.querySelector('.chat-model-panel');
  await act(async () => [...dialog.querySelectorAll('[role="tab"]')].find(button => button.textContent === '参数').click());
  const field = [...dialog.querySelectorAll('label')].find(label => label.textContent.startsWith('Top P')).querySelector('input');
  expect(field.value).toBe('0.6');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '0.93');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return dialog;
}
it.each([false, true])('saves the current Studio model parameters with an explicit service (mobile assembly: %s)', async mobile => {
  const f = fixture();
  const roleplayModels = { save: vi.fn() };
  const view = { models: mobile ? f.models : roleplayModels };
  await act(async () => root.render(<MainPageContext.Provider value={view}>
    {mobile ? <MobileCreatorStudioConversation {...f.props} /> : <CreatorStudioConversation {...f.props} />}
  </MainPageContext.Provider>));
  const dialog = await openAndEdit();
  await act(async () => dialog.querySelector('.chat-model-save').click());
  expect(f.models.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic-studio-provider',
    model_options: [expect.objectContaining({ id: 'synthetic-main', topP: 0.8 }), expect.objectContaining({ id: 'synthetic-peer', topP: 0.93 })] }));
  expect(roleplayModels.save).not.toHaveBeenCalled();
  expect(f.model.selectModel).toHaveBeenCalledWith({ provider: 'synthetic-studio-provider', model: 'synthetic-peer' });
  expect(f.configs[0].model_options[1].topP).toBe(0.6);
});
it('offers the parameter tab in the separate desktop window without a main-page context', async () => {
  const f = fixture();
  await act(async () => root.render(<CreatorStudioConversation {...f.props} />));
  await openAndEdit();
  expect(f.models.save).not.toHaveBeenCalled();
  expect(f.model.selectModel).not.toHaveBeenCalled();
});
it('retains the parameter draft and Studio selection when saving fails', async () => {
  const f = fixture(); f.models.save.mockRejectedValueOnce(new Error('合成保存失败'));
  await act(async () => root.render(<CreatorStudioConversation {...f.props} />));
  const dialog = await openAndEdit();
  await act(async () => dialog.querySelector('.chat-model-save').click());
  expect(document.querySelector('.chat-model-panel')).not.toBeNull();
  expect(f.model.selectModel).not.toHaveBeenCalled();
  expect(f.props.onError).toHaveBeenCalledWith('合成保存失败');
  expect(f.configs[0].model_options[1].topP).toBe(0.6);
});
