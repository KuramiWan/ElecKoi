// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterImportDialog } from '../apps/web/src/modules/persona/components/CharacterImportDialog.jsx';

let container, root;
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('FileReader', class {
    readAsDataURL() {
      this.result = 'data:application/json;base64,e30=';
      queueMicrotask(() => this.onload());
    }
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function prepare(importable) {
  const onImported = vi.fn(async () => {});
  const onPrepare = vi.fn(async () => ({ token: 'synthetic-import', items: [{
    id: 'item-1', name: 'Synthetic card', summary: 'Synthetic summary', imageAvailable: false,
    importable, errorMessage: importable ? '' : 'Invalid card structure',
    warnings: importable ? ['Variable rule could not be converted'] : [],
  }] }));
  await act(async () => root.render(<CharacterImportDialog onClose={vi.fn()}
    onImported={onImported} onPrepare={onPrepare} onDiscard={vi.fn(async () => {})} />));
  await act(async () => [...container.querySelectorAll('button')]
    .find(button => button.textContent.includes('酒馆角色卡')).click());
  const input = container.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true,
    value: [new File(['{}'], 'synthetic-card.json', { type: 'application/json' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(onPrepare).toHaveBeenCalledWith('sillytavern', [{ displayName: 'synthetic-card.json',
    mimeType: 'application/json', base64: 'e30=' }]);
  return { button: container.querySelector('footer .primary'), onImported };
}

describe('character import warnings', () => {
  it('shows a conversion warning while allowing the valid card to import', async () => {
    const { button, onImported } = await prepare(true);
    expect(container.querySelector('.character-import-warning').textContent)
      .toBe('Variable rule could not be converted');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(onImported).toHaveBeenCalledExactlyOnceWith('synthetic-import');
  });

  it('still blocks a structurally invalid card', async () => {
    const { button, onImported } = await prepare(false);
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain('Invalid card structure');
    expect(onImported).not.toHaveBeenCalled();
  });
});
