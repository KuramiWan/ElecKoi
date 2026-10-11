// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainPageContext } from '../apps/web/src/app/windows/MainPageContext.jsx';
import { ModelPicker } from '../apps/web/src/modules/models/components/ModelPicker.jsx';
import { RequestPreviewDialog } from '../apps/web/src/modules/chat/components/RequestPreviewDialog.jsx';
import { VariableViewerDialog } from '../apps/web/src/modules/chat/components/VariableViewerDialog.jsx';
import { AgentToolsDialog } from '../apps/web/src/modules/chat/components/AgentToolsDialog.jsx';
import { HistoryModal } from '../apps/web/src/modules/chat/components/HistoryModal.jsx';
import { MobileConversationOverlay } from '../apps/web/src/mobile/MobileConversationOverlay.jsx';

let root, host, handlers;
const click = async (element) => {
  expect(element).toBeTruthy();
  await act(async () => element.click());
};
const button = (label) =>
  [...document.querySelectorAll('button')].find(
    (node) => node.textContent === label || node.getAttribute('aria-label') === label,
  );
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function render(children) {
  await act(async () =>
    root.render(
      <MainPageContext.Provider
        value={{
          registerBackHandler: (handler) => {
            handlers.push(handler);
            return () => {
              handlers.splice(handlers.indexOf(handler), 1);
            };
          },
        }}
      >
        {children}
      </MainPageContext.Provider>,
    ),
  );
}
async function nativeBack() {
  await act(async () => {
    handlers.at(-1)();
    await flush();
  });
}
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.dataset.eleckoiMobile = 'true';
  handlers = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.eleckoiMobile;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Android conversation surfaces', () => {
  it('navigates model pages without committing, discards drafts and saves changed parameters through the shared service', async () => {
    const select = vi.fn(async () => {}),
      save = vi.fn(async (config) => config);
    const configs = [
      {
        id: 'config-a',
        provider: 'custom',
        name: '合成配置',
        model: 'model-a',
        model_options: [
          { id: 'model-a', name: '合成模型甲' },
          { id: 'model-b', name: '合成模型乙' },
        ],
      },
    ];
    await render(
      <ModelPicker
        configs={configs}
        selectedConfigId="config-a"
        selectedModel="model-a"
        onSelect={select}
        onSaveModelConfig={save}
      />,
    );
    await click(document.querySelector('.chat-model-trigger'));
    await click(button('查看 合成配置 的模型'));
    expect(document.querySelector('.chat-model-browser')).toBeNull();
    await click(button('合成模型乙'));
    expect(select).not.toHaveBeenCalled();
    await nativeBack();
    expect(document.querySelector('.mobile-provider-choices')).not.toBeNull();
    await nativeBack();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click(button('不保存'));
    expect(select).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await click(document.querySelector('.chat-model-trigger'));
    await click(button('查看 合成配置 的模型'));
    await click(button('合成模型乙'));
    await click(button('参数'));
    const input = [...document.querySelectorAll('label')]
      .find((node) => node.textContent.startsWith('Top P'))
      .querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '0.8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await nativeBack();
    expect(document.querySelector('.mobile-chat-model-list')).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await click(document.querySelector('.chat-model-save'));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        model_options: expect.arrayContaining([expect.objectContaining({ id: 'model-b', topP: 0.8 })]),
      }),
    );
    expect(select).toHaveBeenCalledWith({ capability: 'chat', configId: 'config-a', model: 'model-b' });
  });
  it('keeps a model draft open when saving fails', async () => {
    const save = vi.fn(async () => {
      throw new Error('合成保存失败');
    });
    await render(
      <ModelPicker
        configs={[
          {
            id: 'config-a',
            provider: 'custom',
            name: '合成配置',
            model: 'model-a',
            model_options: [{ id: 'model-a' }],
          },
        ]}
        selectedConfigId=""
        onSelect={save}
      />,
    );
    await click(document.querySelector('.chat-model-trigger'));
    await click(button('使用 合成配置'));
    await click(document.querySelector('.chat-model-save'));
    expect(document.querySelector('.mobile-chat-models')).not.toBeNull();
    await nativeBack();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
  it('reads context only after entering a request and aborts it on Back while restoring list position', async () => {
    let pending;
    const onClose = vi.fn(),
      service = {
        observeRequestPreviews: vi.fn(async (_id, publish) =>
          publish([{ id: 'request-a', round: 1, request: 1, turn: 1, model: 'synthetic-model' }]),
        ),
        readRequestPreview: vi.fn(
          (_id, id, signal) =>
            new Promise((resolve) => {
              pending = { id, signal, resolve };
            }),
        ),
      };
    await render(
      <RequestPreviewDialog conversationId="conversation-a" conversationModel={service} onClose={onClose} />,
    );
    const list = document.querySelector('.request-preview-catalog');
    list.scrollTop = 140;
    expect(service.readRequestPreview).not.toHaveBeenCalled();
    await click(list.querySelector('button'));
    expect(list.hidden).toBe(true);
    expect(pending.id).toBe('request-a');
    await nativeBack();
    expect(pending.signal.aborted).toBe(true);
    expect(list.scrollTop).toBe(140);
    expect(list.hidden).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    await nativeBack();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('returns through variable objects, floor detail and the original timeline before closing', async () => {
    const state = { root: { group: { child: { value: '合成值' } } }, valueCount: 1 };
    const timeline = {
      floors: [
        {
          id: 'floor-a',
          label: '第 1 楼',
          changedPaths: ['/group/child/value'],
          changedValueCount: 1,
          state,
        },
      ],
      current: state,
    };
    const snapshot = { id: 'conversation-a', status: 'ready', timeline, error: '' };
    const service = {
        subscribeTimeline: () => () => {},
        getTimelineSnapshot: () => snapshot,
        openTimeline: vi.fn(async () => timeline),
        closeTimeline: vi.fn(),
      },
      onClose = vi.fn();
    await render(
      <VariableViewerDialog conversationId="conversation-a" conversationModel={service} onClose={onClose} />,
    );
    const list = document.querySelector('.variable-floor-list');
    list.scrollTop = 190;
    expect(document.querySelector('.variable-snapshot')).toBeNull();
    await click(document.querySelector('.variable-floor'));
    document.querySelector('.variable-viewer-tree-scroll').scrollTop = 120;
    await click(document.querySelector('.variable-viewer-tree-row.is-container'));
    document.querySelector('.variable-viewer-tree-scroll').scrollTop = 70;
    await click(document.querySelector('.variable-viewer-tree-row.is-container'));
    expect(document.querySelector('.variable-snapshot-titleline').textContent).toBe('child');
    await nativeBack();
    expect(document.querySelector('.variable-snapshot-titleline').textContent).toBe('group');
    expect(document.querySelector('.variable-viewer-tree-scroll').scrollTop).toBe(70);
    await nativeBack();
    expect(document.querySelector('.variable-snapshot-titleline').textContent).toBe('第 1 楼');
    expect(document.querySelector('.variable-viewer-tree-scroll').scrollTop).toBe(120);
    await nativeBack();
    expect(document.querySelector('.variable-snapshot')).toBeNull();
    expect(list.scrollTop).toBe(190);
    expect(onClose).not.toHaveBeenCalled();
    await nativeBack();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('keeps tool switching and list restoration on the existing preset save contract', async () => {
    const tool = {
      id: 'example-tool',
      name: '合成工具',
      included: true,
      enabled: false,
      source: 'built_in',
      members: [{ name: 'example_operation' }],
    };
    let preset = { id: 'example-preset', toolGroups: [tool], roleplayPlan: {} };
    const catalog = {
        refresh: vi.fn(async () => ({ activePresetId: preset.id })),
        read: vi.fn(async () => preset),
        save: vi.fn(async (value) => {
          preset = value;
          return value;
        }),
      },
      onClose = vi.fn();
    await render(<AgentToolsDialog presetCatalog={catalog} onClose={onClose} />);
    const list = document.querySelector('.mobile-overlay-scroll');
    list.scrollTop = 100;
    await click(document.querySelector('.agent-tool-switch'));
    expect(catalog.save).toHaveBeenCalledWith(
      expect.objectContaining({ toolGroups: [expect.objectContaining({ id: tool.id, enabled: true })] }),
      undefined,
    );
    await click(document.querySelector('.agent-tool-open'));
    expect(document.querySelector('.agent-tool-detail')).not.toBeNull();
    await nativeBack();
    expect(document.querySelector('.mobile-overlay-scroll').scrollTop).toBe(100);
    expect(onClose).not.toHaveBeenCalled();
    await nativeBack();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('cancels a history delete on native Back and preserves the shared load and delete actions', async () => {
    const onClose = vi.fn(),
      onLoadChat = vi.fn(),
      onDeleteChat = vi.fn();
    await render(
      <HistoryModal
        open
        sessions={[
          {
            id: 'session-a',
            character_id: 'character-a',
            character_name: '合成角色',
            summary: '合成记录',
            updated_at: '2026-10-09T01:00:00Z',
          },
        ]}
        sessionId="session-a"
        onClose={onClose}
        onLoadChat={onLoadChat}
        onDeleteChat={onDeleteChat}
      />,
    );
    expect(document.activeElement.tagName).not.toBe('INPUT');
    await click(button('删除这条记录'));
    await nativeBack();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleteChat).not.toHaveBeenCalled();
    await click(button('删除这条记录'));
    await click(button('确认删除'));
    expect(onDeleteChat).toHaveBeenCalledWith('session-a');
    await click(document.querySelector('.history-item-main'));
    expect(onLoadChat).toHaveBeenCalledWith('session-a');
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('waits for the sheet and scrim exit, restores focus and does not wait for unrelated animations', async () => {
    const masks = [];
    const recordMask = (event) => masks.push(event.detail);
    document.addEventListener('eleckoi:system-bar-mask', recordMask);
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    await render(
      <MobileConversationOverlay title="合成弹窗" onClose={onClose}>
        <p>合成内容</p>
      </MobileConversationOverlay>,
    );
    expect(masks).toEqual([expect.objectContaining({ pseudo: '::before', active: true })]);
    const overlay = document.querySelector('.mobile-conversation-overlay');
    let finishSheet, finishScrim;
    overlay.getAnimations = () => [
      {
        animationName: 'mobile-sheet-out',
        finished: new Promise((resolve) => {
          finishSheet = resolve;
        }),
      },
      {
        animationName: 'mobile-sheet-scrim-out',
        finished: new Promise((resolve) => {
          finishScrim = resolve;
        }),
      },
      { animationName: 'other-animation', finished: new Promise(() => {}) },
    ];
    await click(button('关闭'));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      finishScrim();
      await flush();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      finishSheet();
      await flush();
    });
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
    expect(masks.at(-1).active).toBe(false);
    trigger.remove();
    document.removeEventListener('eleckoi:system-bar-mask', recordMask);
  });
});
