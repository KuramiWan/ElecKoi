import { useEffect, useRef, useState } from 'react';

// 长按后在同级节点间排序；跨文件夹移动由底栏的选择与粘贴操作完成。
export function useTouchReorder({ enabled, onSelect, onMove }) {
  const optionsRef = useRef({ enabled, onSelect, onMove });
  optionsRef.current = { enabled, onSelect, onMove };
  const gestureRef = useRef(null);
  const suppressClickUntil = useRef(0);
  const [preview, setPreview] = useState(null);

  function clear() {
    const gesture = gestureRef.current;
    if (gesture) { clearTimeout(gesture.timer); cancelAnimationFrame(gesture.frame); }
    gestureRef.current = null;
    setPreview(null);
  }

  function updateTarget(gesture) {
    const rows = [...gesture.root.querySelectorAll('[data-reorder-id]')]
      .filter(row => row.dataset.reorderParent === gesture.parentId && row.dataset.reorderFixed !== 'true');
    const sourceIndex = rows.findIndex(row => row.dataset.reorderId === gesture.dragId);
    if (sourceIndex < 0) { clear(); return; }
    const siblings = rows.filter(row => row.dataset.reorderId !== gesture.dragId);
    const insertion = siblings.findIndex(row => {
      const rect = row.getBoundingClientRect();
      return gesture.y < rect.top + rect.height / 2;
    });
    const destinationIndex = insertion < 0 ? siblings.length : insertion;
    const anchor = siblings[destinationIndex] || siblings.at(-1);
    const next = anchor && destinationIndex !== sourceIndex ? {
      dragId: gesture.dragId, parentId: gesture.parentId, destinationIndex,
      targetId: anchor.dataset.reorderId, after: destinationIndex === siblings.length,
    } : null;
    gesture.target = next;
    const nextPreview = { dragId: gesture.dragId, targetId: next?.targetId || '', after: next?.after || false };
    setPreview(current => current?.dragId === nextPreview.dragId && current?.targetId === nextPreview.targetId
      && current?.after === nextPreview.after ? current : nextPreview);
  }

  function scrollFrame(gesture) {
    if (gestureRef.current !== gesture || !gesture.active) return;
    const scroller = gesture.root.closest('.editor-sidebar-directory');
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const delta = gesture.y < rect.top + 32 ? -8 : gesture.y > rect.bottom - 32 ? 8 : 0;
      if (delta) { scroller.scrollTop += delta; updateTarget(gesture); }
    }
    gesture.frame = requestAnimationFrame(() => scrollFrame(gesture));
  }

  useEffect(() => {
    if (!enabled) { clear(); return undefined; }
    const move = event => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const touch = [...event.touches].find(value => value.identifier === gesture.identifier);
      if (!touch || event.touches.length !== 1) { clear(); return; }
      if (!gesture.active) {
        if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 8) clear();
        return;
      }
      event.preventDefault();
      gesture.y = touch.clientY;
      updateTarget(gesture);
    };
    const end = event => {
      const gesture = gestureRef.current;
      if (!gesture || ![...event.changedTouches].some(touch => touch.identifier === gesture.identifier)) return;
      const target = gesture.target;
      if (gesture.active) { event.preventDefault(); suppressClickUntil.current = Date.now() + 500; }
      clear();
      if (event.type === 'touchend' && target) {
        const { dragId, parentId, destinationIndex } = target;
        optionsRef.current.onMove?.({ dragId, parentId, destinationIndex });
      }
    };
    const blur = () => clear();
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end, { passive: false });
    window.addEventListener('touchcancel', end, { passive: false });
    window.addEventListener('blur', blur);
    return () => {
      const gesture = gestureRef.current;
      if (gesture) { clearTimeout(gesture.timer); cancelAnimationFrame(gesture.frame); }
      gestureRef.current = null;
      window.removeEventListener('touchmove', move); window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end); window.removeEventListener('blur', blur);
    };
  }, [enabled]);

  return { preview, handlers: {
    onTouchStart: event => {
      if (!enabled || event.touches.length !== 1) return;
      const row = event.target.closest('[data-reorder-id]');
      if (!row || row.dataset.reorderFixed === 'true') return;
      const control = event.target.closest('button, input, textarea, select, [role="switch"]');
      if (control && control !== row) return;
      clear();
      const touch = event.touches[0];
      const gesture = { root: event.currentTarget, dragId: row.dataset.reorderId, parentId: row.dataset.reorderParent,
        identifier: touch.identifier, x: touch.clientX, y: touch.clientY, active: false, target: null };
      gestureRef.current = gesture;
      gesture.timer = setTimeout(() => {
        if (gestureRef.current !== gesture || !optionsRef.current.enabled) return;
        gesture.active = true;
        suppressClickUntil.current = Date.now() + 500;
        optionsRef.current.onSelect?.(gesture.dragId);
        updateTarget(gesture);
        scrollFrame(gesture);
      }, 400);
    },
    onClickCapture: event => {
      if (gestureRef.current?.active || Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
    },
    onContextMenuCapture: event => {
      if (gestureRef.current || Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
    },
  } };
}
