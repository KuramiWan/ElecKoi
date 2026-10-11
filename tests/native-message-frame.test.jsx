// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichMessageFrame } from '../apps/web/src/modules/authorFrontend/components/RichMessageFrame.jsx';
import { MainPageContext } from '../apps/web/src/app/windows/MainPageContext.jsx';

let container, root, runtime, current, listeners, stop;
const message = { id: 'synthetic-message', conversationId: 'synthetic-chat' };
const documentSource = '<html><head><meta name="eleckoi-author-api" content="0.1.0"></head><body><button>Confirm</button></body></html>';
const documentValue = { source: documentSource, contentKey: 'synthetic-content' };
const render = document => act(() => root.render(<MainPageContext.Provider value={{ characterConfiguration: { scriptRuntimeConnection: {
  getSnapshot: () => current, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
} } }}><RichMessageFrame message={message} document={document} /></MainPageContext.Provider>));
const load = async frame => {
  await act(() => frame.dispatchEvent(new Event('load')));
  return frame.contentWindow.__ElecKoiCompleteDocument;
};
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // JSDOM does not execute srcdoc; represent its bootstrap for the React owner test.
  const getWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get;
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function () {
    const target = getWindow.call(this);
    if (target && this.name && !target.__ElecKoiCompleteDocument) {
      target.__ElecKoiDocumentChannel = this.name;
      target.__ElecKoiCompleteDocument = vi.fn();
    }
    return target;
  });
  delete window.__ElecKoiClientCompatibility;
  stop = vi.fn(); listeners = new Set();
  runtime = { mountDocument: vi.fn(target => { target.ElecKoi = { api: { version: '0.1.0' } }; return stop; }) }; current = runtime;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native interactive message in the production renderer', () => {
  it('mounts the injected native SDK in the exact message scope, preserves unchanged DOM and releases on withdrawal', async () => {
    await render(documentValue);
    const frame = container.querySelector('iframe'), complete = await load(frame);
    expect(runtime.mountDocument).toHaveBeenCalledWith(frame.contentWindow, 'synthetic-chat', 'synthetic-message');
    expect(complete).toHaveBeenCalledWith(frame.contentWindow.ElecKoi);
    expect(frame.srcdoc).not.toContain('__ElecKoiClientCompatibility');
    await render({ ...documentValue }); await load(frame);
    expect(container.querySelector('iframe')).toBe(frame);
    expect(runtime.mountDocument).toHaveBeenCalledOnce();
    await act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: frame.name, type: 'eleckoi:rich-height', height: 240 } })));
    expect(frame.style.height).toBe('240px');
    await act(() => { current = null; listeners.forEach(listener => listener()); });
    expect(stop).toHaveBeenCalledOnce();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[role=alert]').textContent).toBe('原生作者插件未启用');
  });

  it('never falls back to a legacy SDK for unsupported or missing native services', async () => {
    current = null; await render(documentValue);
    expect(container.textContent).toContain('原生作者插件未启用');
    await render({ source: documentSource.replace('0.1.0', '9.0.0') });
    expect(container.textContent).toContain('不支持的原生作者 SDK 版本');
    expect(runtime.mountDocument).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('closes a failed page and mounts a new identity after source changes, ignoring other frames', async () => {
    await render(documentValue);
    const first = container.querySelector('iframe'); await load(first);
    await act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { channel: first.name, type: 'eleckoi:frontend-error', message: 'Other document error' } })));
    expect(container.querySelector('[role=alert]')).toBeNull();
    await act(() => window.dispatchEvent(new MessageEvent('message', { source: first.contentWindow, data: { channel: first.name, type: 'eleckoi:frontend-error', message: 'Synthetic author failure' } })));
    expect(stop).toHaveBeenCalledOnce(); expect(container.textContent).toContain('Synthetic author failure');
    await render({ ...documentValue, source: documentSource.replace('Confirm', 'Retry') });
    const second = container.querySelector('iframe'); await load(second);
    expect(second).not.toBe(first); expect(second.srcdoc).toContain('Retry');
    expect(runtime.mountDocument).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role=alert]')).toBeNull();
  });
});
