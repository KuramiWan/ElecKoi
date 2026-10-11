// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleplayInputMenu } from '../apps/web/src/modules/chat/components/RoleplayInputMenu.jsx';
import { NativeScriptPanel } from '../apps/web/src/modules/scripts/components/NativeScriptPanel.jsx';

let container, root;
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native script chat controls', () => {
  it('expands buttons inside the approved chat menu and invokes only their full identity', async () => {
    const run = vi.fn(), key = JSON.stringify(['synthetic-script', 'synthetic-action']);
    await act(() => root.render(<RoleplayInputMenu scriptsReady scriptButtons={[
      { key, label: 'Synthetic action', scriptName: 'Synthetic script', busy: false, error: '' },
      { key: 'synthetic-busy', label: 'Busy action', scriptName: 'Synthetic script', busy: true, error: '' },
    ]} onRunScriptButton={run} />));
    await act(() => container.querySelector('[aria-label="扮演菜单"]').click());
    const trigger = [...container.querySelectorAll('[role=menuitem]')].find(button => button.textContent === '脚本');
    expect(container.querySelector('[aria-label="脚本按钮"]')).toBeNull();
    await act(() => trigger.click()); expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const buttons = container.querySelectorAll('[aria-label="脚本按钮"] button');
    expect(buttons[1].disabled).toBe(true);
    await act(() => buttons[0].click()); expect(run).toHaveBeenCalledWith(key);
    expect(container.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[aria-label="扮演菜单"]'));
  });

  it('shows an empty menu without fabricating buttons', async () => {
    await act(() => root.render(<RoleplayInputMenu scriptButtons={[]} />));
    await act(() => container.querySelector('[aria-label="扮演菜单"]').click());
    await act(() => [...container.querySelectorAll('[role=menuitem]')].find(button => button.textContent === '脚本').click());
    expect(container.querySelector('[aria-label="脚本按钮"]').textContent).toBe('暂无可用按钮');
  });

  it('mounts the exact script panel, ignores other frames, releases errors and remounts on retry', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
    const getWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get;
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function () {
      const target = getWindow.call(this);
      if (target && this.name && !target.__ElecKoiCompleteDocument) {
        target.__ElecKoiDocumentChannel = this.name; target.__ElecKoiCompleteDocument = vi.fn();
      }
      return target;
    });
    const stop = vi.fn(), runtime = { mountScriptPanelDocument: vi.fn(target => { target.ElecKoi = {}; return stop; }), dismissPanel: vi.fn() };
    const panel = { id: 'synthetic-settings', key: 'synthetic-panel-key', title: 'Synthetic settings',
      html: '<html><head><meta name="eleckoi-author-api" content="0.1.0"></head><body>Settings</body></html>',
      baseUrl: '/eleckoi/scripts/global/_/synthetic-version/scripts/entry.js' };
    const previous = document.createElement('button'); container.append(previous); previous.focus();
    await act(() => root.render(<NativeScriptPanel runtime={runtime} panel={panel} />));
    const dialog = document.querySelector('.native-script-dialog'), frame = dialog.querySelector('iframe');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    await act(() => frame.dispatchEvent(new Event('load')));
    expect(runtime.mountScriptPanelDocument).toHaveBeenCalledWith(frame.contentWindow, panel.key);
    expect(frame.srcdoc).toContain('/eleckoi/scripts/global/_/synthetic-version/scripts/entry.js');
    await act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { channel: frame.name, type: 'eleckoi:frontend-error', message: 'Wrong source' } })));
    expect(dialog.querySelector('[role=alert]')).toBeNull();
    await act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: frame.name, type: 'eleckoi:frontend-error', message: 'Synthetic panel error' } })));
    expect(stop).toHaveBeenCalledOnce(); expect(dialog.querySelector('[role=alert]').textContent).toBe('Synthetic panel error');
    await act(() => dialog.querySelector('[aria-label="重新加载作者面板"]').click());
    const second = dialog.querySelector('iframe'); await act(() => second.dispatchEvent(new Event('load')));
    expect(second).not.toBe(frame); expect(runtime.mountScriptPanelDocument).toHaveBeenCalledTimes(2);
    await act(() => second.contentWindow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(runtime.dismissPanel).toHaveBeenCalledWith(panel.key);
    await act(() => root.render(null)); expect(stop).toHaveBeenCalledTimes(2);
  });
});
