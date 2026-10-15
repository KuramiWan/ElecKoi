// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
const tasks = vi.hoisted(() => []);
vi.mock('../../src/modules/displayTemplates/runtime/runDisplayTemplates.js', () => ({ runDisplayTemplates: vi.fn((input, options) => new Promise(resolve => tasks.push({ input, options, resolve }))) }));
import { useRenderedDisplay } from '../../src/modules/displayTemplates/useRenderedDisplay.js';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('React', React);
function Probe({ message, libraries }) { const result = useRenderedDisplay(message, message.content, libraries); return <output>{result.content}</output>; }
describe('completed message display lifecycle', () => {
  it('withdraws accepted templates on scope disable, cancels pending computation and keeps individual switches enabled', async () => {
    tasks.length = 0;
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    const message = { id: 'synthetic-message', conversationId: 'synthetic-chat', role: 'assistant', status: 'complete', content: 'Narrative' };
    const render = async (enabled, revision) => act(() => root.render(<Probe message={message} libraries={[{ scope: 'global', ownerId: '', enabled, revision,
      templates: [{ id: 'synthetic-template', enabled: true, position: 'after' }] }]} />));
    try {
      await render(true, 1);
      await act(() => tasks[0].resolve({ content: '<p>Accepted</p>', errors: [] }));
      expect(node.textContent).toBe('<p>Accepted</p>');
      await render(true, 2); expect(tasks).toHaveLength(2);
      await render(false, 3); expect(node.textContent).toBe('Narrative');
      expect(tasks[1].options.signal.aborted).toBe(true);
      await act(() => tasks[1].resolve({ content: 'Late disabled output', errors: [] }));
      expect(node.textContent).toBe('Narrative'); expect(tasks).toHaveLength(2);
      await render(true, 4); expect(tasks).toHaveLength(3);
      expect(tasks[2].input.libraries[0].templates[0].enabled).toBe(true);
      await act(() => tasks[2].resolve({ content: '<p>Restored</p>', errors: [] }));
      expect(node.textContent).toBe('<p>Restored</p>');
    } finally { await act(() => root.unmount()); node.remove(); }
  });

  it('does not render chunks, keeps accepted HTML during config refresh, and discards stale or canceled calculations', async () => {
    tasks.length = 0;
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
    const libraries = revision => [{ scope: 'preset', ownerId: 'synthetic-preset', enabled: true, revision,
      templates: [{ id: 'synthetic-template', enabled: true, position: 'after' }] }];
    const message = status => ({ id: 'synthetic-message', conversationId: 'synthetic-chat', role: 'assistant', status, content: 'Narrative', variableStateJson: '{"score":12}' });
    const render = async (status, revision, extra = {}) => act(() => root.render(<Probe message={{ ...message(status), ...extra }} libraries={libraries(revision)} />));
    try {
      await render('streaming', 1); expect(tasks).toHaveLength(0);
      await render('complete', 1); expect(tasks).toHaveLength(1);
      await act(() => tasks[0].resolve({ content: '<p>Accepted</p>', errors: [] }));
      expect(node.textContent).toBe('<p>Accepted</p>');
      await render('complete', 2); expect(node.textContent).toBe('<p>Accepted</p>');
      await render('complete', 3); expect(tasks[1].options.signal.aborted).toBe(true);
      await act(() => tasks[1].resolve({ content: 'Stale result', errors: [] }));
      expect(node.textContent).toBe('<p>Accepted</p>');
      await act(() => tasks[2].resolve({ content: '<p>Latest</p>', errors: [] }));
      expect(node.textContent).toBe('<p>Latest</p>');
      await render('complete', 4, { id: 'synthetic-other-message', content: 'Other narrative' });
      expect(node.textContent).toBe('Other narrative');
      expect(tasks[3].input.variables).toEqual({ score: 12 });
      await render('complete', 5, { id: 'synthetic-no-snapshot', variableSnapshotAvailable: false, variableStateJson: '{}' });
      expect(tasks[4].input.variables).toBeNull();
    } finally { await act(() => root.unmount()); node.remove(); }
    expect(tasks.at(-1).options.signal.aborted).toBe(true);
  });
});
