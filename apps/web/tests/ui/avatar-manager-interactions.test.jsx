// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvatarManagerEditor } from '../../src/ui/ui/AvatarSlotsEditor.jsx';

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
const reference = slot => `eleckoi-media://asset/v1/${'a'.repeat(64)}/${slot}/${'b'.repeat(64)}.png`;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  delete document.documentElement.dataset.eleckoiMobile;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount() {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const BrowserURL = globalThis.URL;
  vi.stubGlobal('URL', class extends BrowserURL { static createObjectURL() { return 'blob:synthetic-avatar'; } static revokeObjectURL() {} });
  await act(async () => root.render(<AvatarManagerEditor
    value={{ circle: reference('user-square'), square: reference('user-square'),
      portrait: reference('user-portrait') }} name="合成用户" onBack={() => {}} onChange={vi.fn()} />));
}

describe('avatar image selection and persisted-image cropping', () => {
  it('opens the picker when a preview is tapped without fetching the current image', async () => {
    const fetchImage = vi.fn(); vi.stubGlobal('fetch', fetchImage);
    await mount();
    const choose = vi.spyOn(container.querySelector('input[type="file"]'), 'click');
    await act(async () => container.querySelector('[aria-label="更换圆形头像"]').click());
    expect(choose).toHaveBeenCalledOnce();
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('reads Android persisted crops through the existing authenticated same-origin media route', async () => {
    document.documentElement.dataset.eleckoiMobile = 'true';
    const fetchImage = vi.fn(async url => {
      if (new URL(url).protocol === 'eleckoi-media:') throw new TypeError('Failed to fetch');
      return { ok: true, blob: async () => new Blob(['synthetic-image'], { type: 'image/png' }) };
    });
    vi.stubGlobal('fetch', fetchImage);
    await mount();
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '调整裁剪').click());
    const url = new URL(fetchImage.mock.lastCall[0]);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/eleckoi/media/asset');
    expect(url.searchParams.get('reference')).toBe(reference('user-portrait'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps desktop fetch on its registered media scheme and shows a failed read without changing the avatar', async () => {
    const fetchImage = vi.fn().mockRejectedValue(new Error('合成读取失败')); vi.stubGlobal('fetch', fetchImage);
    await mount();
    const previous = container.querySelector('.is-portrait img').getAttribute('src');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '调整裁剪').click());
    expect(fetchImage).toHaveBeenCalledWith(reference('user-portrait'));
    expect(container.querySelector('[role="alert"]').textContent).toBe('合成读取失败');
    expect(container.querySelector('.is-portrait img').getAttribute('src')).toBe(previous);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
