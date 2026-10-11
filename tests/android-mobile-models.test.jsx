// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MainPageContext } from '../apps/web/src/app/windows/MainPageContext.jsx';
import { MobileModelsPage } from '../apps/web/src/mobile/MobileModelsPage.jsx';
import { blankConfigForProvider } from '../apps/web/src/modules/models/model/modelProviderCatalog.js';
import projectLogo from '../apps/web/src/assets/eleckoi-app-icon.png';

vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../apps/web/src/modules/settings/index.js', () => ({
  LIST_COLLAPSE_AREAS: { models: 'models' },
  usePersistentCollapseState: (_area, initial) => [...React.useState(initial), true],
}));

let root, container, view, snapshot, subscribers;
const config = (provider = 'custom', patch = {}) => ({
  ...blankConfigForProvider(provider), id: `example-${provider}`, name: 'Example configuration', ...patch,
});
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text);
const field = text => [...container.querySelectorAll('label')].find(node => node.textContent.trim().startsWith(text))?.querySelector('input');
async function change(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(configs = [], route = { kind: 'root' }, save = async value => value) {
  snapshot = { configs, status: 'ready', error: '' };
  subscribers = new Set();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const guardRef = { current: null };
  const leave = vi.fn();
  view = {
    models: {
      subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); },
      getSnapshot: () => snapshot, save: vi.fn(save),
    },
    chat: { modelOptionsByKey: {}, notify: vi.fn() }, route, guardRef,
    scrollPositions: new Map(), pushRoute: vi.fn(), openDrawer: vi.fn(),
    registerBackHandler: () => () => {},
    goBack: () => guardRef.current ? guardRef.current(leave) : leave(), leave,
    renderLayout: ({ mainPanel, overlays }) => <>{mainPanel}{overlays}</>,
  };
  await act(async () => root.render(<MainPageContext.Provider value={view}><div className="mobile-shell"><MobileModelsPage /></div></MainPageContext.Provider>));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('Android model library and configuration actions', () => {
  it('omits an unconfigured image section, uses the project logo, and folds the general provider list', async () => {
    await mount([config('deepseek')]);
    expect(container.querySelector('section[aria-label="绘画模型"]')).toBeNull();
    const custom = [...container.querySelectorAll('.mobile-provider-row')].find(node => node.textContent.includes('自定义模型提供商'));
    expect(custom.querySelector('img').getAttribute('src')).toBe(projectLogo);
    const dedicated = [...container.querySelectorAll('.mobile-provider-row')].find(node => node.textContent.includes('DeepSeek'));
    expect(dedicated.querySelector('small').textContent).toBe('官方 API');
    const group = button('通用大模型');
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(group.querySelector('svg')).not.toBeNull();
    await act(async () => group.click());
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#mobile-model-group-general').hidden).toBe(true);
    await act(async () => group.click());
    expect(container.querySelector('#mobile-model-group-general').hidden).toBe(false);
  });

  it('shows an image group only while its saved provider exists, and keeps image creation available from Add', async () => {
    await mount([config('openai_image')]);
    expect(button('绘画模型')).not.toBeUndefined();
    await act(async () => {
      snapshot = { ...snapshot, configs: [] };
      subscribers.forEach(listener => listener());
    });
    expect(container.querySelector('section[aria-label="绘画模型"]')).toBeNull();
    await act(async () => container.querySelector('[aria-label="添加模型提供商"]').click());
    const choices = [...container.querySelectorAll('.mobile-picker-list button')];
    expect(choices.find(node => node.textContent.includes('自定义模型提供商')).querySelector('img').getAttribute('src')).toBe(projectLogo);
    await act(async () => choices.find(node => node.textContent.includes('OpenAI Images')).click());
    expect(view.pushRoute.mock.calls[0][0]).toMatchObject({ kind: 'model-editor', draft: { provider: 'openai_image' } });
  });

  it('requires an explicit configuration selection when a provider has multiple versions', async () => {
    const first = config('custom', { id: 'example-a', name: 'Example A', model: 'example-model-a' });
    const second = config('custom', { id: 'example-b', name: 'Example B', model: 'example-model-b' });
    await mount([first, second]);
    const provider = container.querySelector('.mobile-provider-row');
    expect(provider.querySelector('small').textContent).toBe('2 个配置');
    await act(async () => provider.click());
    expect(view.pushRoute).not.toHaveBeenCalled();
    await act(async () => button('Example B').click());
    expect(view.pushRoute).toHaveBeenCalledExactlyOnceWith({ kind: 'model-editor', configId: second.id });
  });

  it('puts one Save action beside the configuration title and saves the current draft through the existing form', async () => {
    const saved = config();
    let finish;
    const saving = new Promise(resolve => { finish = resolve; });
    await mount([saved], { kind: 'model-editor', configId: saved.id }, () => saving);
    expect(container.querySelector('.mobile-header h1').textContent).toBe('模型配置');
    expect(container.querySelector('.mobile-model-provider-card strong').textContent).toBe('自定义模型提供商');
    expect(container.querySelector('.model-detail-header')).toBeNull();
    expect(button('取消')).toBeUndefined();
    const save = button('保存');
    expect(save.closest('.mobile-header')).not.toBeNull();
    expect(save.disabled).toBe(true);
    await change(field('配置名称'), 'Changed configuration');
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    expect(view.models.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: saved.id, name: 'Changed configuration' }));
    expect(save.disabled).toBe(true);
    expect(save.getAttribute('aria-busy')).toBe('true');
    await act(async () => finish(view.models.save.mock.calls[0][0]));
    expect(save.disabled).toBe(true);
    expect(view.chat.notify).toHaveBeenCalledWith('success', '模型配置已保存');
  });

  it('opens a searchable model dialog and selects through the existing draft without saving', async () => {
    const saved = config('custom', { model: 'example-model-a', model_options: [
      { id: 'example-model-a', name: 'Example Alpha', isUserAdded: true },
      { id: 'example-model-b', name: 'Example Beta', isUserAdded: true },
    ] });
    await mount([saved], { kind: 'model-editor', configId: saved.id });
    await act(async () => container.querySelector('.model-picker-value').click());
    const dialog = container.querySelector('[role="dialog"][aria-label="模型列表"]');
    expect(dialog.closest('.mobile-model-sheet')).not.toBeNull();
    await act(async () => dialog.querySelector('h2').click());
    expect(container.querySelector('[role="dialog"][aria-label="模型列表"]')).toBe(dialog);
    expect(dialog.querySelectorAll('.mobile-model-choice')).toHaveLength(2);
    await change(dialog.querySelector('[aria-label="搜索模型"]'), 'beta');
    expect(dialog.querySelectorAll('.mobile-model-choice')).toHaveLength(1);
    const choice = dialog.querySelector('.mobile-model-choice');
    await act(async () => { choice.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); choice.click(); });
    expect(container.querySelector('[aria-label="模型列表"]')).toBeNull();
    expect(container.querySelector('.model-picker-value').textContent).toBe('example-model-b');
    expect(view.models.save).not.toHaveBeenCalled();
    await act(async () => button('保存').click());
    expect(view.models.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'example-model-b', model_options: saved.model_options }));
  });

  it('adds and removes manual models in dialogs using the same unsaved draft', async () => {
    const saved = config();
    await mount([saved], { kind: 'model-editor', configId: saved.id });
    await act(async () => container.querySelector('.model-picker-value').click());
    await act(async () => button('添加模型').click());
    expect(container.querySelector('[aria-label="模型列表"]')).toBeNull();
    const manual = container.querySelector('[role="dialog"][aria-label="添加模型"]');
    await change(manual.querySelector('input'), 'example-manual-model');
    const add = [...manual.querySelectorAll('button')].find(node => node.textContent === '添加并使用');
    await act(async () => { add.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); add.click(); });
    expect(container.querySelector('.model-picker-value').textContent).toBe('example-manual-model');
    expect(container.querySelector('[aria-label="添加模型"]')).toBeNull();
    await act(async () => container.querySelector('.model-picker-value').click());
    const remove = container.querySelector('[aria-label="删除模型 example-manual-model"]');
    await act(async () => { remove.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); remove.click(); });
    expect(container.querySelector('[role="dialog"][aria-label="模型列表"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="删除模型 example-manual-model"]')).toBeNull();
    expect(view.models.save).not.toHaveBeenCalled();
  });

  it('keeps model capability controls in Parameters and preserves their saved values', async () => {
    const saved = config('custom', { model: 'example-model', model_options: [{ id: 'example-model', name: 'Example model', isUserAdded: true, supportsImageInput: false }] });
    await mount([saved], { kind: 'model-editor', configId: saved.id });
    const parameters = container.querySelector('.mobile-model-parameters');
    expect(parameters.querySelector('h3').textContent).toBe('参数');
    expect(parameters.querySelector('.model-capability-toggle').textContent).toBe('支持图片输入 ');
    expect(parameters.querySelector('.model-reasoning-profile legend').textContent).toContain('接口支持档位');
    await act(async () => parameters.querySelector('.model-capability-toggle input').click());
    await act(async () => parameters.querySelector('[aria-label="声明支持低档位"]').click());
    await act(async () => button('保存').click());
    expect(view.models.save.mock.calls[0][0].model_options[0]).toMatchObject({ supportsImageInput: true, reasoningEfforts: { low: 'low' } });
  });

  it('preserves a draft on failed Save and still asks before leaving an unsaved form', async () => {
    const saved = config();
    await mount([saved], { kind: 'model-editor', configId: saved.id }, async () => { throw new Error('Synthetic save failure'); });
    await change(field('配置名称'), 'Unsaved configuration');
    await act(async () => button('保存').click());
    expect(field('配置名称').value).toBe('Unsaved configuration');
    expect(button('保存').disabled).toBe(false);
    expect(view.chat.notify).toHaveBeenCalledWith('error', 'Synthetic save failure');
    await act(async () => container.querySelector('[aria-label="返回"]').click());
    expect(view.leave).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => [...dialog.querySelectorAll('button')].find(node => node.textContent === '取消').click());
    expect(field('配置名称').value).toBe('Unsaved configuration');
    expect(view.leave).not.toHaveBeenCalled();
  });

  it.each([
    config('custom', { model: 'example-model', model_options: [{ id: 'example-model', topP: 2 }] }),
    config('openai_image', { image_settings: { width: 13, height: 1536 } }),
  ])('uses the existing validation to block header Save for $provider parameters', async saved => {
    await mount([saved], { kind: 'model-editor', configId: saved.id });
    await change(field('配置名称'), 'Changed configuration');
    expect(button('保存').disabled).toBe(true);
    await act(async () => button('保存').click());
    expect(view.models.save).not.toHaveBeenCalled();
  });
});
