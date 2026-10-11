// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentProcessDialog } from '../apps/web/src/modules/chat/components/AgentProcessDialog.jsx';

const message = { status: 'running', content: '', process: [
  { id: 'synthetic-tool', kind: 'tool', status: 'running', toolName: 'synthetic_read',
    arguments: '{"path":"synthetic.txt"}', detail: '合成详情', startedAtMillis: 1 },
] };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let root;
let container;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  container?.remove();
  delete document.documentElement.dataset.eleckoiMobile;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderDialog(mobile = true, processMessage = message) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('React', React);
  if (mobile) document.documentElement.dataset.eleckoiMobile = 'true';
  // jsdom does not implement pseudo-element style queries.
  vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(1, 0, 0, 1, 0, 23)', opacity: '0.7' }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const onClose = vi.fn();
  await act(async () => root.render(<AgentProcessDialog message={processMessage} onClose={onClose} />));
  return { onClose, overlay: document.querySelector('.agent-process-backdrop'),
    dialog: document.querySelector('.agent-process-dialog') };
}

describe('mobile process bottom sheet', () => {
  it('opens readable tool details from a mixed timeline and keeps raw unknown fields accessible', async () => {
    await renderDialog(true, { status: 'complete', process: [
      { id: 'reasoning', kind: 'reasoning', toolName: 'reasoning', status: 'complete', detail: '合成思考' },
      { id: 'read', kind: 'tool', toolName: 'eleckoi_read_setting_files', status: 'complete', arguments: '{"paths":["合成组/甲","合成组/乙"]}' },
      { id: 'extra', kind: 'tool', toolName: 'eleckoi_read_setting_files', status: 'error', arguments: '{"paths":["合成组/甲"],"unexpected":"preserve"}' },
    ] });
    await act(async () => document.querySelector('.agent-process-group').click());
    expect(document.querySelectorAll('.agent-process-timeline-node')).toHaveLength(3);
    expect(document.querySelector('.agent-process-timeline-node').classList.contains('has-body-rail')).toBe(true);
    expect(document.querySelector('.agent-process-item path').getAttribute('transform')).toBe('translate(24 0) scale(-1 1)');
    await act(async () => document.querySelector('.agent-process-item').click());
    expect(document.querySelector('.agent-process-text-block p').textContent).toBe('文件：\n合成组/甲\n合成组/乙');
    await act(async () => document.querySelector('.agent-process-back').click());
    await act(async () => document.querySelectorAll('.agent-process-item')[1].click());
    expect(document.querySelector('.agent-process-detail pre').textContent).toContain('"unexpected": "preserve"');
  });
  it('waits only for the sheet exit while its running tool animation continues', async () => {
    const { onClose, overlay } = await renderDialog();
    let finishSheet;
    let finishScrim;
    overlay.getAnimations = () => [
      { animationName: 'mobile-sheet-out', finished: new Promise(resolve => { finishSheet = resolve; }) },
      { animationName: 'mobile-sheet-scrim-out', finished: new Promise(resolve => { finishScrim = resolve; }) },
      { animationName: 'agent-process-spin', finished: new Promise(() => {}) },
    ];
    await act(async () => overlay.querySelector('.agent-process-close').click());
    expect(overlay.dataset.sheetClosing).toBe('true');
    expect(overlay.style.getPropertyValue('--mobile-sheet-exit-from')).toContain('23');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finishScrim(); await flush(); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finishSheet(); await flush(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('goes back through details before Escape dismisses and restores the previous focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { onClose, dialog } = await renderDialog();
    expect(document.activeElement).toBe(dialog);
    await act(async () => document.querySelector('.agent-process-group').click());
    expect(dialog.getAttribute('aria-label')).toBe('详情');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(dialog.getAttribute('aria-label')).toBe('处理过程');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flush(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    root = undefined;
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('dismisses immediately when reduced motion has no exit animation', async () => {
    const { onClose, overlay } = await renderDialog();
    overlay.getAnimations = () => [];
    await act(async () => { overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await flush(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps desktop dismissal synchronous without starting a mobile exit', async () => {
    const { onClose, overlay } = await renderDialog(false);
    overlay.querySelector('.agent-process-close').click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(overlay.hasAttribute('data-sheet-closing')).toBe(false);
  });
});
