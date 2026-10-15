// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentProcessDialog } from '../../src/modules/chat/components/AgentProcessDialog.jsx';

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
  vi.useRealTimers();
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
  it.each([false, true])('shows model retry failure details inside the process dialog (mobile: %s)', async mobile => {
    await renderDialog(mobile, { status: 'complete', content: '', process: [{
      id: 'synthetic-retry', kind: 'action', toolName: 'model_retry', status: 'complete',
      arguments: '', summary: '已重试模型请求（1/5）',
      detail: JSON.stringify({ delayMs: 1000, failure: { code: 'RATE_LIMIT', status: 429, message: 'Synthetic overload' } }),
      startedAtMillis: 1000,
    }] });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('已重试模型请求（1/5）');
    await act(() => dialog.querySelector('.agent-process-group').click());
    await act(() => dialog.querySelector('.agent-process-list button.agent-process-item').click());
    expect(dialog.textContent).toContain('Synthetic overload');
    expect(dialog.textContent).toContain('429');
    expect(dialog.querySelector('.agent-process-status').textContent).toBe('已重试');
    expect(container.textContent).not.toContain('Synthetic overload');
  });
  it('shows a reasoning display projection including intentional empty text while retaining the original detail', async () => {
    const original = { id: 'synthetic-thought', kind: 'reasoning', toolName: 'reasoning', status: 'complete', detail: 'Synthetic original thought', displayDetail: 'Synthetic display thought' }
    await renderDialog(false, { status: 'complete', process: [original] })
    await act(async () => document.querySelector('.agent-process-group').click())
    expect(document.querySelector('.agent-process-reasoning-body').textContent).toContain('Synthetic display thought')
    expect(document.querySelector('.agent-process-reasoning-body').textContent).not.toContain('Synthetic original thought')
    await act(async () => root.render(<AgentProcessDialog message={{ status: 'complete', process: [{ ...original, displayDetail: '' }] }} onClose={() => {}} />))
    expect(document.querySelector('.agent-process-reasoning-body')).toBeNull()
    expect(original.detail).toBe('Synthetic original thought')
  })
  it('updates an open turn clock and stops at the official end while the dialog stays open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const live = { ...message, pending: true, processTiming: { startedAtMillis: 1000 } };
    const { dialog } = await renderDialog(false, live);
    expect(dialog.querySelector('h2').textContent).toBe('处理过程 · 1秒');
    await act(async () => vi.advanceTimersByTime(43000));
    expect(dialog.querySelector('h2').textContent).toBe('处理过程 · 43秒');
    await act(async () => root.render(<AgentProcessDialog message={{ ...live, pending: false, status: 'complete',
      processTiming: { startedAtMillis: 1000, completedAtMillis: 44000 } }} onClose={() => {}} />));
    await act(async () => vi.advanceTimersByTime(3600000));
    expect(dialog.querySelector('h2').textContent).toBe('处理过程 · 43秒');
  });
  it('does not grow a historical duration when completed reasoning lacks an item end time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3600000);
    const historical = { status: 'complete', processTiming: { startedAtMillis: 1000, completedAtMillis: 44000 },
      process: [{ id: 'synthetic-thought', kind: 'reasoning', toolName: 'reasoning', status: 'complete', startedAtMillis: 3000, detail: '合成分析' }] };
    const { dialog } = await renderDialog(false, historical);
    expect(dialog.querySelector('h2').textContent).toBe('处理过程 · 43秒');
    await act(async () => vi.advanceTimersByTime(3600000));
    expect(dialog.querySelector('h2').textContent).toBe('处理过程 · 43秒');
  });
  it('shows the captured image prompt in processing before and after the final boundary', async () => {
    const action = { id: 'synthetic-image-action', kind: 'action', toolName: 'generate_image', status: 'running',
      arguments: '{"frames":[{"id":1,"prompt":"synthetic scene","negative_prompt":"synthetic avoid"}]}' };
    const running = { status: 'streaming', content: '', process: [action] };
    await renderDialog(true, running);
    expect(document.querySelector('.agent-process-dialog').textContent).toContain('<ACTION_CALL name="generate_image">');
    expect(document.querySelector('.agent-process-dialog').textContent).toContain('生图提示词');
    expect(document.querySelector('.agent-process-dialog').textContent).toContain('synthetic scene');
    await act(() => root.render(<AgentProcessDialog message={{ ...running, status: 'complete', content: '<FINAL>合成正文</FINAL>', process: [{ ...action, status: 'complete' }] }} onClose={() => {}} />));
    expect(document.querySelector('.agent-process-dialog').textContent).toContain('synthetic scene');
    expect(document.querySelector('.agent-process-dialog').textContent).toContain('<FINAL>已识别');
  });
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
