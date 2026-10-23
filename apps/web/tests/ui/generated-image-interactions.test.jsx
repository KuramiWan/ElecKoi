// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ChatImageGallery } from '../../src/ui/messages/ChatImageGallery.jsx';
import { generatedImageSegments } from '../../src/ui/messages/generatedImagePresentation.js';

let root, container;
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const image = { id: 'synthetic-batch:2', batchId: 'synthetic-batch', frameId: 2, status: 'ready',
  attachmentId: 'synthetic-image', name: 'synthetic.png', dataUrl: 'data:image/png;base64,YQ==', width: 480, height: 960 };
const render = props => act(() => root.render(<ChatImageGallery images={[image]} conversationId="synthetic-chat" {...props} />));
const click = element => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('single generated image actions', () => {
  it('opens a full image preview on click and closes it with Back', async () => {
    await render(); await click(container.querySelector('figure'));
    expect(document.querySelector('[aria-label="图片预览"] img').src).toBe(image.dataUrl);
    await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[aria-label="图片预览"]')).toBeNull();
  });
  it('long press shows download and single-image regeneration, without regenerating the reply', async () => {
    vi.useFakeTimers(); const regenerate = vi.fn(async () => {}), download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await render({ onRegenerateImage: regenerate });
    await act(() => container.querySelector('figure').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 20 })));
    await act(() => vi.advanceTimersByTime(501));
    const menu = document.querySelector('[aria-label="图片菜单"]');
    expect([...menu.querySelectorAll('button')].map(button => button.textContent)).toEqual(['下载图片', '重新生成', '取消']);
    await click(menu.querySelector('button'));
    expect(download).toHaveBeenCalledOnce(); expect(download.mock.instances[0].download).toBe('synthetic.png');
    await act(() => container.querySelector('figure').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await click([...document.querySelectorAll('[aria-label="图片菜单"] button')].find(button => button.textContent === '重新生成'));
    expect(regenerate).toHaveBeenCalledExactlyOnceWith(image);
    expect(document.querySelector('[aria-label="图片预览"]')).toBeNull();
  });
  it('shows a retry on a failed image and keeps the error visible if retry fails', async () => {
    const failed = { ...image, attachmentId: undefined, dataUrl: undefined, status: 'failed', error: '合成错误' };
    const regenerate = vi.fn(async () => { throw new Error('合成重画失败'); });
    await render({ images: [failed], onRegenerateImage: regenerate });
    const retry = container.querySelector('.chat-image-retry');
    expect(retry.textContent).toBe('重新生成'); await click(retry);
    expect(regenerate).toHaveBeenCalledExactlyOnceWith(failed);
    // 失败面同时给文案与码：状态里存的是失败本身（不是一句话）。
    const alert = container.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('合成重画失败');
    expect(alert.textContent).toContain('eleckoi/internal');
  });
  it('cancels long press while scrolling', async () => {
    vi.useFakeTimers(); await render({ onRegenerateImage: async () => {} }); const target = container.querySelector('figure');
    await act(() => target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 20 })));
    await act(() => target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 40 })));
    await act(() => vi.advanceTimersByTime(600));
    expect(document.querySelector('[aria-label="图片菜单"]')).toBeNull();
  });
  it('places exact image IDs in the reply and groups only consecutive markers', () => {
    const first = { ...image, id: 'first', frameId: 1 }, third = { ...image, id: 'third', frameId: 3 };
    expect(generatedImageSegments('前文\n[[IMAGE:1]]\n[[IMAGE:2]]\n中间\n[[IMAGE:3]]\n后文', [first, image, third]).map(part => part.type)).toEqual(['text', 'images', 'text', 'images', 'text']);
    expect(generatedImageSegments('前文\n[[IMAGE:2]]', [first, image])[1].images).toEqual([image]);
  });
  it('waits for the streaming frame marker even when the image finished first', () => {
    for (const text of ['', '合成正文', '合成正文\n[[IMAGE:', '合成正文\n[[IMAGE:2]']) {
      const parts = generatedImageSegments(text, [image], true);
      expect(parts.some(part => part.type === 'images')).toBe(false);
      expect(parts.map(part => part.content).join('')).not.toContain('[[IMAGE:');
    }
    expect(generatedImageSegments('合成正文\n[[IMAGE:2]]', [image], true)[1].images).toEqual([image]);
  });
});
