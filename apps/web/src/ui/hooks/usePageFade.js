import { useLayoutEffect, useRef } from 'react';

/** 页面切换只改变透明度，输入框和文字保持实际布局位置。 */
export function usePageFade(key, enabled = true, selector) {
  const ref = useRef(null);
  const previous = useRef(key);
  useLayoutEffect(() => {
    const changed = previous.current !== key;
    previous.current = key;
    if (!enabled || !changed || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const target = selector ? ref.current?.querySelector(selector) : ref.current;
    const animation = target?.animate?.([{ opacity: .45 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    let stopped = false;
    const stop = () => { if (!stopped) { stopped = true; animation?.cancel(); } };
    animation?.finished?.then(stop, () => {});
    return stop;
  }, [key, enabled, selector]);
  return ref;
}
