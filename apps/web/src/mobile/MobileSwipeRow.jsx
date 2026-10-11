import { useEffect, useRef, useState } from 'react';

const ACTION_WIDTH = 76;

export function MobileSwipeRow({ rowKey, openKey, onOpenKeyChange, actions, children, disabled = false }) {
  const open = openKey === rowKey;
  const reveal = ACTION_WIDTH * actions.length;
  const [offset, setOffset] = useState(open ? -reveal : 0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef(null);
  const dragged = useRef(false);
  useEffect(() => { if (!dragging) setOffset(open ? -reveal : 0); }, [open, reveal, dragging]);
  function finish(event, cancel = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (current.active && !cancel) onOpenKeyChange(current.offset < -reveal * (current.open ? .6 : .4) ? rowKey : null);
    setDragging(false);
    setOffset(cancel ? (open ? -reveal : 0) : current.active ? (current.offset < -reveal * (current.open ? .6 : .4) ? -reveal : 0) : offset);
  }
  function safeClick(action) {
    if (disabled) return;
    if (dragged.current) { dragged.current = false; return; }
    if (openKey != null) { onOpenKeyChange(null); return; }
    action();
  }
  return <div className="mobile-swipe-row" style={{ '--mobile-swipe-width': `${reveal}px` }}>
    <div className="mobile-swipe-actions" inert={offset === 0 ? true : undefined} aria-hidden={offset === 0 ? true : undefined}>
      {actions.map(action => <button type="button" key={action.label} className={action.destructive ? 'is-destructive' : ''} disabled={disabled} onClick={() => { onOpenKeyChange(null); action.onClick(); }}>{action.icon}<span>{action.label}</span></button>)}
    </div>
    <div className={`mobile-swipe-content${dragging ? ' is-dragging' : ''}`} style={{ transform: `translateX(${offset}px)` }}
      onPointerDown={event => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        dragged.current = false;
        gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset, startOffset: offset, open, active: false };
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || event.pointerId !== current.pointerId) return;
        const dx = event.clientX - current.x, dy = event.clientY - current.y;
        if (!current.active) {
          if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { gesture.current = null; return; }
          if (Math.abs(dx) <= 8) return;
          current.active = true; setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        dragged.current = true;
        current.offset = Math.max(-reveal, Math.min(0, current.startOffset + dx));
        setOffset(current.offset);
      }}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}>
      {children(safeClick)}
    </div>
  </div>;
}
