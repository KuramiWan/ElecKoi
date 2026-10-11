// @vitest-environment jsdom
import React, { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MainPageContext } from '../apps/web/src/app/windows/MainPageContext.jsx';
import { MobileMessagesPage } from '../apps/web/src/mobile/MobileMessagesPage.jsx';
import { MobileConversationPage } from '../apps/web/src/mobile/MobileConversationPage.jsx';
import { MessagesPage } from '../packages/client/features/dsh-client-conversations/src/page.jsx';
import { MessageBubble } from './helpers/officialMarkdown.jsx';

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function conversationView() {
  const goBack = vi.fn();
  const selectView = vi.fn();
  return {
    route: { kind: 'conversation' }, goBack,
    appearance: {}, conversations: {},
    presets: { refresh: async () => ({ presets: [], activePresetId: '' }) },
    renderLayout: ({ mainPanel }) => mainPanel,
    renderRoleplay: ({ component: Component, props }) => <Component {...props} dshConversation={{
      activeView: 'chat', tabs: [{ id: 'chat', label: '对话' }, { id: 'trajectory', label: '轨迹' }, { id: 'plugin-view', label: '扩展视图' }], selectView,
    }} />,
    selectView,
    chat: { sessionId: 'chat-a', characters: { items: [] }, currentTitle: '角色甲', messages: [],
      chatPersona: { user_name: '用户', assistant_name: '角色甲' }, input: '', inputImages: [], inputFiles: [],
      chatModelConfigs: [], scrollRef: { current: null }, filteredSessions: [], pinnedIds: [], keyword: '' },
  };
}

describe('Android conversation header', () => {
  it('uses one title, returns through the mobile route, and keeps official view actions', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const view = conversationView();
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<MainPageContext.Provider value={view}><MobileMessagesPage /></MainPageContext.Provider>));
      expect(container.querySelector('.mobile-header')).toBeNull();
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      const row = container.querySelector('.chat-header-title-row');
      expect(row.firstElementChild.getAttribute('aria-label')).toBe('返回');
      expect(row.querySelector('h1').textContent).toBe('角色甲');
      await act(async () => row.firstElementChild.click());
      expect(view.goBack).toHaveBeenCalledTimes(1);
      await act(async () => [...container.querySelectorAll('[role="tab"]')].find(button => button.textContent === '扩展视图').click());
      expect(view.selectView).toHaveBeenCalledWith('plugin-view');
    } finally {
      await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
    }
  });

  it('leaves the shared PC header without an Android back button', () => {
    const markup = renderToStaticMarkup(<MainPageContext.Provider value={conversationView()}><MessagesPage /></MainPageContext.Provider>);
    expect(markup).not.toContain('mobile-conversation-back');
    expect(markup).not.toContain('aria-label="返回"');
    expect(markup).toContain('对话操作');
  });
});

describe('Android composer toolbar focus', () => {
  it.each(['blur', 'focus', 'pagehide'])('revokes a text press on window %s even without a visibility change', async eventName => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<MobileConversationPage><div data-composer-card><div data-input-scroll>
        <div data-composer-input contentEditable suppressContentEditableWarning>合成草稿</div>
      </div></div></MobileConversationPage>));
      const input = container.querySelector('[data-composer-input]');
      await act(async () => { input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); input.focus(); });
      const range = document.createRange(); range.setStart(input.firstChild, 2); range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      expect(input.getAttribute('inputmode')).toBeNull();
      await act(async () => window.dispatchEvent(new Event(eventName)));
      expect(input.getAttribute('inputmode')).toBe('none');
      expect(document.activeElement).toBe(input);
      expect(selection.anchorOffset).toBe(2);
      expect(input.textContent).toBe('合成草稿');
      await act(async () => input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      expect(input.getAttribute('inputmode')).toBeNull();
    } finally {
      await act(async () => root.unmount()); container.remove();
    }
  });

  it.each([true, false])('opens message editing with mobile=%s and preserves save behavior', async mobile => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    document.documentElement.dataset.eleckoiMobile = String(mobile);
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const onEdit = vi.fn(async () => true);
    const message = { id: 'message-a', role: 'assistant', content: '合成正文' };
    try {
      const bubble = <MessageBubble message={message} name="角色甲" onEdit={onEdit} />;
      await act(async () => root.render(mobile ? <MobileConversationPage>{bubble}</MobileConversationPage> : bubble));
      await act(async () => container.querySelector('[aria-label="编辑"]').click());
      const input = container.querySelector('.message-inline-editor textarea');
      expect(input.value).toBe('合成正文');
      expect(document.activeElement === input).toBe(!mobile);
      if (mobile) {
        await act(async () => { input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); input.focus(); });
        expect(input.getAttribute('inputmode')).toBeNull();
        input.setSelectionRange(2, 2);
        await act(async () => window.dispatchEvent(new Event('blur')));
        expect(input.getAttribute('inputmode')).toBe('none');
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(2);
        await act(async () => window.dispatchEvent(new Event('focus')));
        expect(input.getAttribute('inputmode')).toBe('none');
        await act(async () => input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
        expect(input.getAttribute('inputmode')).toBeNull();
      }
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '修改正文');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => [...container.querySelectorAll('.message-inline-editor button')].find(button => button.textContent === '保存').click());
      expect(onEdit).toHaveBeenCalledWith(message, '修改正文');
      expect(container.querySelector('.message-inline-editor')).toBeNull();
    } finally {
      await act(async () => root.unmount()); container.remove(); delete document.documentElement.dataset.eleckoiMobile; vi.unstubAllGlobals();
    }
  });

  it('requires a new text press after returning from the background and preserves the draft selection', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      await act(async () => root.render(<MobileConversationPage><div data-composer-card><div data-input-scroll>
        <div data-composer-input contentEditable suppressContentEditableWarning>合成草稿</div>
      </div></div></MobileConversationPage>));
      const input = container.querySelector('[data-composer-input]');
      await act(async () => {
        input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        input.focus();
      });
      const range = document.createRange(); range.setStart(input.firstChild, 2); range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      expect(input.getAttribute('inputmode')).toBeNull();
      await act(async () => {
        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(input.getAttribute('inputmode')).toBe('none');
      expect(input.textContent).toBe('合成草稿');
      expect(document.activeElement).toBe(input);
      expect(selection.anchorNode).toBe(input.firstChild);
      expect(selection.anchorOffset).toBe(2);
      await act(async () => {
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        input.blur(); input.focus();
      });
      expect(input.getAttribute('inputmode')).toBe('none');
      await act(async () => input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      expect(input.getAttribute('inputmode')).toBeNull();
    } finally {
      await act(async () => root.unmount()); container.remove(); visibility.mockRestore();
    }
  });

  it('keeps the soft keyboard gated when the official editor focuses on entry', async () => {
    function AutofocusedEditor() {
      const ref = useRef(null);
      useLayoutEffect(() => { ref.current.focus(); }, []);
      return <div data-composer-card><div data-input-scroll><div ref={ref} data-composer-input contentEditable suppressContentEditableWarning /></div></div>;
    }
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<MobileConversationPage><AutofocusedEditor key="session-a" /></MobileConversationPage>));
      const first = container.querySelector('[data-composer-input]');
      expect(document.activeElement).toBe(first);
      expect(first.getAttribute('inputmode')).toBe('none');
      await act(async () => first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      expect(first.getAttribute('inputmode')).toBeNull();
      await act(async () => root.render(<MobileConversationPage><AutofocusedEditor key="session-b" /></MobileConversationPage>));
      const second = container.querySelector('[data-composer-input]');
      expect(document.activeElement).toBe(second);
      expect(second.getAttribute('inputmode')).toBe('none');
    } finally {
      await act(async () => root.unmount()); container.remove();
    }
  });

  it.each([null, 'text'])('preserves editor focus and restores input mode %s on a text press', async mode => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const toggleMenu = vi.fn();
    try {
      await act(async () => root.render(<MobileConversationPage><div data-composer-card>
        <div data-input-scroll><div data-composer-input contentEditable suppressContentEditableWarning inputMode={mode ?? undefined} /></div>
        <button type="button" onMouseDown={event => {
          event.preventDefault();
          const input = container.querySelector('[data-composer-input]');
          expect(input.getAttribute('inputmode')).toBe('none');
          input.focus();
        }} onClick={toggleMenu}><span>添加</span></button>
      </div></MobileConversationPage>));
      const input = container.querySelector('[data-composer-input]');
      const icon = container.querySelector('button span');
      await act(async () => {
        icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        icon.click();
      });
      expect(document.activeElement).toBe(input);
      expect(toggleMenu).toHaveBeenCalledOnce();
      await act(async () => input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      expect(input.getAttribute('inputmode')).toBe(mode);
      await act(async () => icon.click());
      expect(input.getAttribute('inputmode')).toBe('none');
      await act(async () => root.unmount());
      expect(input.getAttribute('inputmode')).toBe(mode);
    } finally {
      await act(async () => root.unmount()); container.remove();
    }
  });
});
