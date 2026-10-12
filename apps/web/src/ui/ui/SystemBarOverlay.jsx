import React, { forwardRef, useLayoutEffect, useRef } from 'react';

/** Publish the lifetime of a full-window mask to the native appearance adapter. */
export const SystemBarOverlay = forwardRef(function SystemBarOverlay({ maskPseudo = '', systemBarSurfaceRef, ...props }, forwardedRef) {
  const mask = useRef(null);
  useLayoutEffect(() => {
    const element = mask.current;
    const owner = element.ownerDocument;
    const notify = active => owner.dispatchEvent(new owner.defaultView.CustomEvent('eleckoi:system-bar-mask', {
      detail: { mask: element, pseudo: maskPseudo, surface: systemBarSurfaceRef?.current, active }
    }));
    notify(true);
    return () => notify(false);
  }, [maskPseudo, systemBarSurfaceRef]);
  return <div {...props} ref={element => {
    mask.current = element;
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }} />;
});
