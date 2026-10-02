import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../src/renderer/src/modules/chat/components/ChatPanel.jsx';

globalThis.React = React;

describe('conversation switching', () => {
  it('removes the previous conversation content while the new conversation loads', () => {
    const props = {
      hasActiveChat: true,
      currentTitle: '角色乙',
      conversationId: 'conversation-a',
      persona: { user_name: '用户', assistant_name: '角色甲' },
      messages: [{ id: 'message-a', conversationId: 'conversation-a', role: 'assistant', content: '旧会话前端内容' }],
      input: '',
      setInput: () => {},
      isSending: false,
      modelConfigs: [],
      scrollRef: { current: null },
    };
    const previous = renderToStaticMarkup(<ChatPanel {...props} />);
    const switching = renderToStaticMarkup(<ChatPanel {...props} isSwitchingChat />);

    expect(previous).toContain('旧会话前端内容');
    expect(switching).not.toContain('旧会话前端内容');
    expect(switching).toContain('aria-busy="true"');
  });

  it('keeps the native DSH bar and injects the roleplay menu, model picker, and product dock', () => {
    const props = {
      hasActiveChat: true,
      currentTitle: '角色乙',
      conversationId: 'conversation-a',
      persona: { user_name: '用户', assistant_name: '角色甲' },
      messages: [],
      input: '',
      setInput: () => {},
      isSending: false,
      modelConfigs: [],
      scrollRef: { current: null },
      dshComposerOwner: {
        sessionId: 'session-a',
        session: { id: 'session-a' },
        pendingInteraction: undefined,
      },
      dshInputZone: {
        session: { id: 'session-a' },
        input: { text: '' },
      },
    };
    const nativeSlot = vi.fn((name, owner, options) => {
      if (name === 'eleckoi.roleplay.conversation.composer.bar') {
        return <div data-dsh-input-bar="native">
          <button type="button" aria-label="DSH 命令">+</button>
          {owner.leadingAccessory}
          <textarea placeholder={owner.placeholder} />
          {owner.modelAccessory}
          {owner.dockAccessory}
        </div>;
      }
      if (name === 'eleckoi.roleplay.conversation.composer.dock') {
        return <div data-input-dock-extension="active">下方扩展</div>;
      }
      return options?.fallback ?? null;
    });
    const fallbackChain = (_name, _owner, options) => options?.fallback ?? null;
    const nativeMarkup = renderToStaticMarkup(
      <ChatPanel
        {...props}
        renderRoleplaySlot={nativeSlot}
        renderRoleplaySlotChain={fallbackChain}
      />,
    );
    expect(nativeMarkup).toContain('data-dsh-input-bar="native"');
    expect(nativeMarkup).toContain('aria-label="DSH 命令"');
    expect(nativeMarkup).toContain('aria-label="扮演菜单"');
    expect(nativeMarkup).toContain('placeholder="输入消息"');
    expect(nativeMarkup.match(/data-input-dock-extension="active"/g)).toHaveLength(1);
    expect(nativeSlot).toHaveBeenCalledWith('eleckoi.roleplay.conversation.composer.dock', {});
    expect(nativeSlot.mock.calls.some(([name]) => name.startsWith('eleckoi.roleplay.input.')
      || name === 'eleckoi.roleplay.composer.dock')).toBe(false);

    const renderSlot = vi.fn((name, _owner, options) => {
      if (name === 'eleckoi.roleplay.conversation.composer.bar') {
        return <div data-dsh-input-skin="active">插件输入框</div>;
      }
      if (name === 'eleckoi.roleplay.conversation.input.dock') {
        return <div data-dsh-input-dock="active">插件输入区</div>;
      }
      return options?.fallback ?? null;
    });
    const renderSlotChain = vi.fn((_name, _owner, options) => options?.fallback ?? null);
    const skinMarkup = renderToStaticMarkup(
      <ChatPanel
        {...props}
        renderRoleplaySlot={renderSlot}
        renderRoleplaySlotChain={renderSlotChain}
      />,
    );
    expect(skinMarkup).toContain('data-dsh-input-skin="active"');
    expect(skinMarkup).toContain('data-dsh-input-dock="active"');
    expect(skinMarkup).not.toContain('aria-label="扮演菜单"');
    expect(renderSlotChain).toHaveBeenCalledWith(
      'eleckoi.roleplay.conversation.composer',
      expect.objectContaining({ sessionId: 'session-a', renderBridgeSlot: renderSlot }),
      expect.objectContaining({ overlay: true }),
    );
  });
});
