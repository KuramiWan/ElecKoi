import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useColumnTransition({ shellRef, sidebarCollapsed, rightbarTrack, viewportWidth }) {
  const [animating, setAnimating] = useState(0);
  const trackToggle = `${sidebarCollapsed}:${rightbarTrack}`;
  const previousToggle = useRef(trackToggle);
  const previousViewport = useRef(viewportWidth);

  useLayoutEffect(() => {
    const viewportChanged = previousViewport.current !== viewportWidth;
    previousViewport.current = viewportWidth;
    if (previousToggle.current === trackToggle) return;
    previousToggle.current = trackToggle;
    if (viewportChanged) return;
    setAnimating((token) => token + 1);
  }, [trackToggle, viewportWidth]);

  useEffect(() => {
    if (animating === 0) return undefined;
    const shell = shellRef.current;
    if (!shell) return undefined;
    const settle = () => setAnimating(0);
    const onTransitionEnd = (event) => {
      if (event.target === shell && event.propertyName === "grid-template-columns") settle();
    };
    shell.addEventListener("transitionend", onTransitionEnd);
    const timer = window.setTimeout(settle, 600);
    return () => {
      shell.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(timer);
    };
  }, [animating, shellRef]);

  return animating > 0;
}
