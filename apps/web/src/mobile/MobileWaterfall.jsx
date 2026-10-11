import { useLayoutEffect, useRef } from 'react';

export function MobileWaterfall({ children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const cards = [...ref.current.children];
    const measure = () => {
      for (const card of cards) {
        const span = `span ${Math.ceil(card.getBoundingClientRect().height + 4)}`;
        if (card.style.gridRowEnd !== span) card.style.gridRowEnd = span;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const card of cards) observer.observe(card);
    return () => observer.disconnect();
  }, [children]);
  return <div className="mobile-character-grid" ref={ref}>{children}</div>;
}
