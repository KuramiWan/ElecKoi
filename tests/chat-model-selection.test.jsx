// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useActiveChatModel } from '../src/renderer/src/modules/chat/hooks/useActiveChatModel.js';

describe('chat model selection authority', () => {
  it('commits a valid configured replacement to the same Session when the logged provider was removed', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    const conversations = { readModelSelection: vi.fn(async () => ({ provider: 'removed', model: 'old-model' })),
      selectModel: vi.fn(async (_id, selection) => selection) };
    let current;
    const setStatus = vi.fn();
    const configs = [{ id: 'config-current', model: 'example-model', credentialConfigured: true }];
    function Probe({ id }) {
      current = useActiveChatModel({ conversations, conversationId: id, modelConfigs: configs, setStatus });
      return null;
    }
    try {
      await act(async () => root.render(<Probe id="same-chat" />));
      expect(conversations.selectModel).toHaveBeenCalledExactlyOnceWith('same-chat', { provider: 'config-current', model: 'example-model' });
      expect(current.modelConfig).toMatchObject({ id: 'config-current', model: 'example-model' });
      await act(async () => root.render(<Probe id="" />));
      await act(async () => current.selectChatModel({ configId: 'config-current', model: 'another-model' }));
      expect(current.modelConfig.model).toBe('another-model');
      expect(conversations.selectModel).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
