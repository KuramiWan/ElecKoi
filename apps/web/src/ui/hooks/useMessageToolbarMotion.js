import { useLayoutEffect, useRef, useState } from 'react';

/** Swap the mobile toolbar after fading out; keep its header clearance until then. */
export function useMessageToolbarMotion(expanded, mobile, toolsRef, articleRef, visible) {
  const [presentedExpanded, setPresentedExpanded] = useState(expanded);
  const [swapping, setSwapping] = useState(false);
  const settled = useRef(expanded);

  useLayoutEffect(() => {
    if (!mobile) return undefined;
    if (settled.current === expanded && !swapping) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      settled.current = expanded;
      setPresentedExpanded(expanded);
      setSwapping(false);
      return undefined;
    }
    setSwapping(true);
    let frame;
    const timer = window.setTimeout(() => {
      settled.current = expanded;
      setPresentedExpanded(expanded);
      frame = window.requestAnimationFrame(() => setSwapping(false));
    }, 125);
    return () => { window.clearTimeout(timer); if (frame !== undefined) window.cancelAnimationFrame(frame); };
  }, [expanded, mobile]);

  useLayoutEffect(() => {
    if (!mobile || !visible) return undefined;
    const tools = toolsRef.current;
    const article = articleRef.current;
    const content = article?.querySelector(':scope > .message-content');
    if (!tools || !article || !content) return undefined;
    const measure = () => {
      // Both siblings use the article's layout origin; opening transforms must not change clearance.
      const overlap = Math.max(0, content.offsetLeft + content.offsetWidth - tools.offsetLeft + 6);
      article.style.setProperty('--mobile-message-tool-clearance', `${overlap}px`);
      article.style.setProperty('--mobile-message-tool-height', `${tools.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tools);
    observer.observe(content);
    return () => { observer.disconnect(); article.style.removeProperty('--mobile-message-tool-clearance'); article.style.removeProperty('--mobile-message-tool-height'); };
  }, [mobile, visible, presentedExpanded, toolsRef, articleRef]);

  return { presentedExpanded: mobile ? presentedExpanded : expanded, reserved: mobile && visible && presentedExpanded, swapping: mobile && swapping };
}
