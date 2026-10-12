// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleplayInputMenu } from '../apps/web/src/modules/chat/components/RoleplayInputMenu.jsx';
import { NativeScriptPanel } from '../apps/web/src/modules/scripts/components/NativeScriptPanel.jsx';

let container, root;
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal = vi.fn(function () { this.setAttribute('open', ''); this.querySelector('button')?.focus(); });
  HTMLDialogElement.prototype.close = vi.fn(function () { this.removeAttribute('open'); });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native script chat controls', () => {
  it('opens script buttons in a separate dialog and invokes only their full identity', async () => {
    const run = vi.fn(), key = JSON.stringify(['synthetic-script', 'synthetic-action']);
    await act(() => root.render(<RoleplayInputMenu scriptsReady scriptButtons={[
      { key, label: 'Synthetic action', scriptName: 'Synthetic script', busy: false, error: '' },
      { key: 'synthetic-busy', label: 'Busy action', scriptName: 'Synthetic script', busy: true, error: '' },
    ]} onRunScriptButton={run} />));
    await act(() => container.querySelector('[aria-label="扮演菜单"]').click());
    const trigger = [...container.querySelectorAll('[role=menuitem]')].find(button => button.textContent === '脚本');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(trigger.querySelectorAll('svg')).toHaveLength(1);
    expect(document.querySelector('.native-script-actions-dialog')).toBeNull();
    await act(() => trigger.click());
    expect(container.querySelector('[role=menu]')).toBeNull();
    const dialog = document.querySelector('.native-script-actions-dialog');
    expect(dialog.open).toBe(true);
    expect(dialog.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(dialog.querySelector('[aria-label="关闭脚本"]'));
    const buttons = dialog.querySelectorAll('[aria-label="脚本按钮"] button');
    expect(buttons[1].disabled).toBe(true);
    await act(() => buttons[0].click()); expect(run).toHaveBeenCalledWith(key);
    expect(document.querySelector('.native-script-actions-dialog')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[aria-label="扮演菜单"]'));
  });

  it('shows an empty dialog without fabricating buttons', async () => {
    await act(() => root.render(<RoleplayInputMenu scriptButtons={[]} />));
    await act(() => container.querySelector('[aria-label="扮演菜单"]').click());
    await act(() => [...container.querySelectorAll('[role=menuitem]')].find(button => button.textContent === '脚本').click());
    expect(document.querySelector('.native-script-actions-dialog [role=status]').textContent).toBe('暂无可用按钮');
    expect(container.querySelector('[role=menu]')).toBeNull();
  });

  it.each(['close', 'escape', 'backdrop', 'platform-back'])('closes the script dialog with %s and restores focus', async action => {
    await act(() => root.render(<RoleplayInputMenu />));
    const opener = container.querySelector('[aria-label="扮演菜单"]');
    await act(() => opener.click());
    await act(() => [...container.querySelectorAll('[role=menuitem]')].find(button => button.textContent === '脚本').click());
    const dialog = document.querySelector('.native-script-actions-dialog');
    await act(() => {
      if (action === 'close') dialog.querySelector('[aria-label="关闭脚本"]').click();
      else if (action === 'backdrop') dialog.click();
      else window.dispatchEvent(action === 'escape' ? new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
        : new Event('eleckoi:platform-back', { cancelable: true }));
    });
    expect(document.querySelector('.native-script-actions-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('updates button states and withdraws removed actions while the dialog is open', async () => {
    const run = vi.fn(), button = { key: 'synthetic-action', label: 'Synthetic action', scriptName: 'Synthetic script', busy: false, error: '' };
    const render = (buttons, ready = true) => root.render(<RoleplayInputMenu scriptsReady={ready} scriptButtons={buttons} onRunScriptButton={run} />);
    await act(() => render([button], false));
    await act(() => container.querySelector('[aria-label="扮演菜单"]').click());
    await act(() => [...container.querySelectorAll('[role=menuitem]')].find(value => value.textContent === '脚本').click());
    const dialog = document.querySelector('.native-script-actions-dialog');
    expect(dialog.querySelector('li button').disabled).toBe(true);
    await act(() => render([{ ...button, busy: true, error: 'Synthetic action failure' }]));
    expect(dialog.querySelector('li button').getAttribute('aria-busy')).toBe('true');
    expect(dialog.querySelector('[role=alert]').textContent).toBe('Synthetic action failure');
    await act(() => dialog.querySelector('li button').click());
    expect(run).not.toHaveBeenCalled();
    await act(() => render([]));
    expect(dialog.querySelector('li')).toBeNull();
    expect(dialog.querySelector('[role=status]').textContent).toBe('暂无可用按钮');
  });

  it('closes the dialog with its chat-scoped menu rather than switching its buttons to another chat', async () => {
    const run = vi.fn();
    const render = id => root.render(<RoleplayInputMenu key={id} scriptsReady onRunScriptButton={run}
      scriptButtons={[{ key: id, label: id, scriptName: 'Synthetic script', busy: false, error: '' }]} />);
    await act(() => render('synthetic-chat-one'));
    await act(() => container.querySelector('[aria-label="扮演菜单"]').click());
    await act(() => [...container.querySelectorAll('[role=menuitem]')].find(button => button.textContent === '脚本').click());
    const retiredButton = document.querySelector('.native-script-actions-dialog li button');
    await act(() => render('synthetic-chat-two'));
    expect(document.querySelector('.native-script-actions-dialog')).toBeNull();
    await act(() => retiredButton.click());
    expect(run).not.toHaveBeenCalled();
    await act(() => container.querySelector('[aria-label="扮演菜单"]').click());
    await act(() => [...container.querySelectorAll('[role=menuitem]')].find(button => button.textContent === '脚本').click());
    expect(document.querySelector('.native-script-actions-dialog li button').textContent).toContain('synthetic-chat-two');
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
