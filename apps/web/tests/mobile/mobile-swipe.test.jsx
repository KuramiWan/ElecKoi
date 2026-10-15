// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileSwipeRow } from '../../src/mobile/MobileSwipeRow.jsx';

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; document.body.replaceChildren(); });
function pointer(node, type, x, y) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 });
  node.dispatchEvent(event);
}
async function mount() {
  const open = vi.fn(), pin = vi.fn(), hide = vi.fn();
  function Harness() {
    const [key, setKey] = useState(null);
    return ['a', 'b'].map(id => <MobileSwipeRow key={id} rowKey={id} openKey={key} onOpenKeyChange={setKey}
      actions={[{ label: '置顶', onClick: () => pin(id) }, { label: '删除', onClick: () => hide(id), destructive: true }]}>
      {safeClick => <button onClick={() => safeClick(() => open(id))}>{id}</button>}
    </MobileSwipeRow>);
  }
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
  return { open, pin, hide };
}
async function drag(index, dx, dy = 0) {
  const content = document.querySelectorAll('.mobile-swipe-content')[index];
  content.setPointerCapture = vi.fn();
  await act(async () => pointer(content, 'pointerdown', 200, 200));
  await act(async () => pointer(content, 'pointermove', 200 + dx, 200 + dy));
  await act(async () => pointer(content, 'pointerup', 200 + dx, 200 + dy));
}
describe('Android message swipe actions', () => {
  it('reveals only one row, consumes the post-drag tap and invokes the selected row action', async () => {
    const { open, pin } = await mount();
    await drag(0, -100);
    expect(document.querySelectorAll('.mobile-swipe-content')[0].style.transform).toBe('translateX(-152px)');
    await act(async () => document.querySelectorAll('.mobile-swipe-content button')[0].click());
    expect(open).not.toHaveBeenCalled();
    await drag(1, -110);
    expect(document.querySelectorAll('.mobile-swipe-content')[0].style.transform).toBe('translateX(0px)');
    await act(async () => document.querySelectorAll('.mobile-swipe-actions')[1].querySelector('button').click());
    expect(pin).toHaveBeenCalledWith('b');
    expect(document.querySelectorAll('.mobile-swipe-content')[1].style.transform).toBe('translateX(0px)');
  });
  it('preserves vertical scrolling and cancels a partial horizontal drag without opening a conversation', async () => {
    const { open } = await mount();
    await drag(0, -15, 75);
    expect(document.querySelector('.mobile-swipe-content').style.transform).toBe('translateX(0px)');
    const content = document.querySelector('.mobile-swipe-content');
    await act(async () => pointer(content, 'pointerdown', 200, 200));
    await act(async () => pointer(content, 'pointermove', 100, 200));
    await act(async () => pointer(content, 'pointercancel', 100, 200));
    expect(content.style.transform).toBe('translateX(0px)');
    expect(open).not.toHaveBeenCalled();
  });
});
