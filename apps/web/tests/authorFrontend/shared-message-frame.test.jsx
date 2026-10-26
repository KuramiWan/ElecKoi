// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installElecKoiAuthorApi } from '@eleckoi/author-sdk/browser';
import * as libraries from '@eleckoi/dsh-client-html-resources/browser-libraries';
import { RichMessageFrame } from '../../src/modules/authorFrontend/components/RichMessageFrame.jsx';
import { MainPageContext } from '../../src/app/windows/MainPageContext.jsx';

let container, root, runtime, request, release;
const message = { id: 'synthetic-message', conversationId: 'synthetic-chat' };
const render = key => act(() => root.render(<MainPageContext.Provider value={{ characterConfiguration: { scriptRuntimeConnection: {
  getSnapshot: () => runtime, subscribe: () => () => {},
} } }}><RichMessageFrame message={message} document={{ source: `<section>synthetic ${key}</section>`, contentKey: key }} /></MainPageContext.Provider>));

beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const getWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get;
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function () {
    const page = getWindow.call(this);
    // JSDOM does not parse srcdoc; represent the explicit production bootstrap marker.
    if (page && this.name && !page.__ElecKoiDocumentChannel) {
      page.__ElecKoiDocumentChannel = this.name; page.__ElecKoiCompleteSharedDocument = vi.fn();
    }
    return page;
  });
  const methods = {
    'app.getCapabilities': () => Object.keys(methods).map(method => ({ method })),
    'context.current': () => ({ surface: 'message-renderer', scope: 'current-character', conversationId: message.conversationId, messageId: message.id, characterId: 'synthetic-character' }),
    'messages.getPage': () => ({ items: [{ id: message.id, role: 'assistant', content: 'Synthetic message', speakerName: 'Synthetic character', variableState: {} }], hasMore: false }),
    'input.set': params => ({ text: params.text }), 'events.list': () => ({ items: [] }),
  };
  request = vi.fn(async (method, params) => methods[method](params)); release = vi.fn();
  runtime = { mountDocument: vi.fn(page => {
    installElecKoiAuthorApi(page, { request, on: () => () => {} });
    return () => { release(); page.dispatchEvent(new page.Event('pagehide')); };
  }) };
  const ready = { status: 'ready', error: '' };
  window.__ElecKoiHtmlResources = { assetsBaseUrl: '/eleckoi/html/', sdk: libraries, getSnapshot: () => ready, subscribe: () => () => {} };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount()); container.remove(); delete window.__ElecKoiHtmlResources;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('shared message compatibility in the production component', () => {
  it('mounts the existing SDK before readiness and revokes the old realm when content changes', async () => {
    await render('first');
    const first = container.querySelector('iframe'), page = first.contentWindow;
    await act(async () => { first.dispatchEvent(new Event('load')); });
    await vi.waitFor(() => expect(page.TavernHelper).toBeDefined());
    expect(runtime.mountDocument).toHaveBeenCalledWith(page, message.conversationId, message.id);
    expect(page.__ElecKoiCompleteSharedDocument).toHaveBeenCalledOnce();
    expect(page.getChatMessages(0)[0].message).toBe('Synthetic message');
    await page.setInputText('Synthetic draft');
    expect(request).toHaveBeenCalledWith('input.set', { text: 'Synthetic draft' }, expect.anything());
    const retained = page.getChatMessages;
    await render('second');
    expect(container.querySelector('iframe')).not.toBe(first);
    expect(release).toHaveBeenCalledOnce();
    expect(() => retained()).toThrow(/已关闭/);
  });
});
