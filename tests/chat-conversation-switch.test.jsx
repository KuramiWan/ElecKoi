import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
});
