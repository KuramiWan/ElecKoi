import { useCallback, useLayoutEffect, useRef, useState } from "react";

const FOLLOW_THRESHOLD = 24;

export function scrollMetrics(element) {
  const height = element.clientHeight;
  return {
    top: element.scrollTop,
    height,
    floor: Math.max(0, element.scrollHeight - height),
  };
}

export class ScrollFollow {
  static owners = new WeakMap();

  constructor(following, threshold) {
    this.following = following;
    this.threshold = threshold;
    this.target = null;
    this.sampledTop = undefined;
  }

  get active() {
    return this.following;
  }

  get animating() {
    return this.target !== null;
  }

  static forElement(element) {
    return this.owners.get(element);
  }

  bind(element) {
    ScrollFollow.owners.set(element, this);
    return () => {
      if (ScrollFollow.owners.get(element) === this) ScrollFollow.owners.delete(element);
    };
  }

  nearBottom(metrics) {
    return metrics.floor - metrics.top <= this.threshold;
  }

  setFollowing(active) {
    this.following = active;
    if (!active) this.target = null;
  }

  reset() {
    this.setFollowing(false);
    this.sampledTop = undefined;
  }

  sample(metrics, movedByReader = this.sampledTop === undefined
    || Math.abs(metrics.top - this.sampledTop) > 0.5) {
    this.sampledTop = metrics.top;
    if (!this.animating && movedByReader) this.following = this.nearBottom(metrics);
    return this.active;
  }

  settle(metrics) {
    const target = this.target;
    this.target = null;
    return this.sample(metrics, target === null ? undefined
      : Math.abs(metrics.top - Math.min(target, metrics.floor)) > this.threshold);
  }

  jump(element, metrics, top) {
    const animated = this.animating;
    this.target = null;
    const target = Math.max(0, Math.min(metrics.floor, top));
    if (animated) element.scrollTo({ top: target, behavior: "instant" });
    else if (target !== metrics.top) element.scrollTop = target;
    const landed = { ...metrics, top: element.scrollTop };
    this.sampledTop = landed.top;
    this.following = this.nearBottom(landed);
    return landed;
  }

  toBottom(element, metrics, behavior) {
    this.following = true;
    if (behavior === "instant" || metrics.top >= metrics.floor
      || (!this.animating && this.nearBottom(metrics))) return this.jump(element, metrics, metrics.floor);
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return this.jump(element, metrics, metrics.floor);
    }
    if (this.target === null) {
      this.target = metrics.floor;
      element.scrollTo({ top: metrics.floor, behavior: "smooth" });
    }
    return metrics;
  }

  interrupt(element, metrics) {
    if (!this.animating) return;
    this.target = null;
    this.sampledTop = metrics.top;
    element.scrollTo({ top: metrics.top, behavior: "instant" });
  }
}

export function useChatTailReading({ scrollElement, onFollowingTailChange }) {
  const [follow] = useState(() => new ScrollFollow(true, FOLLOW_THRESHOLD + 1));
  const followingRef = useRef(true);
  const controllerRef = useRef(null);
  const onFollowingTailChangeRef = useRef(onFollowingTailChange);
  onFollowingTailChangeRef.current = onFollowingTailChange;

  useLayoutEffect(() => {
    const contentElement = scrollElement?.querySelector(".message-flow") || null;
    if (!scrollElement || !contentElement) {
      controllerRef.current = null;
      return undefined;
    }

    let observationTop = scrollElement.scrollTop;
    let readerDirection = 0;
    let touchingY = null;
    let pointerReading = false;

    const publish = (following) => {
      follow.setFollowing(following);
      if (followingRef.current === following) return;
      followingRef.current = following;
      onFollowingTailChangeRef.current(following);
    };
    const followTail = () => {
      readerDirection = 0;
      const landing = follow.toBottom(scrollElement, scrollMetrics(scrollElement), "instant");
      observationTop = landing.top;
      publish(true);
    };
    const readScroll = () => {
      const metrics = scrollMetrics(scrollElement);
      // Content shrinking can clamp scrollTop without a reader moving upward.
      const delta = metrics.top - Math.min(observationTop, metrics.floor);
      observationTop = metrics.top;
      if (delta < -0.5) {
        publish(false);
      } else if (delta > 0.5 && (readerDirection > 0 || pointerReading)
        && follow.nearBottom(metrics)) {
        publish(true);
      }
      return metrics;
    };
    const onScroll = () => { readScroll(); };
    const onResize = () => {
      // ResizeObserver may run before the scroll event for a reader's movement.
      readScroll();
      if (followingRef.current && !pointerReading && touchingY === null) followTail();
    };
    const canScrollInside = (target, direction) => {
      for (let element = target; element && element !== scrollElement; element = element.parentElement) {
        const { overflowY, overscrollBehaviorY } = getComputedStyle(element);
        if (!/^(auto|scroll)$/.test(overflowY)) continue;
        if (/^(contain|none)$/.test(overscrollBehaviorY)) return true;
        const metrics = scrollMetrics(element);
        if (direction < 0 ? metrics.top > 0 : metrics.top < metrics.floor) return true;
      }
      return false;
    };
    const onDirection = (event, direction) => {
      if (!direction || event.defaultPrevented || canScrollInside(event.target, direction)) return;
      readerDirection = direction;
      // Pause before the browser scrolls, even for a tiny trackpad movement inside
      // the bottom tolerance. Only an intentional downward return can resume it.
      if (direction < 0) publish(false);
    };
    const onWheel = (event) => {
      if (!event.ctrlKey) onDirection(event, Math.sign(event.deltaY));
    };
    const onKeyDown = (event) => {
      if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
        || event.altKey || event.metaKey
        || (event.ctrlKey && !["Home", "End"].includes(event.key))) return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) {
        onDirection(event, -1);
      } else if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) {
        onDirection(event, 1);
      }
    };
    const onTouchStart = (event) => {
      touchingY = event.touches.length === 1 ? event.touches[0].clientY : null;
    };
    const onTouchMove = (event) => {
      const y = event.touches.length === 1 ? event.touches[0].clientY : null;
      if (touchingY !== null && y !== null) onDirection(event, Math.sign(touchingY - y));
      touchingY = y;
    };
    const onTouchEnd = () => {
      touchingY = null;
      onResize();
    };
    const onPointerDown = (event) => {
      // Native scrollbar events target the scrolling element, not its content.
      if (event.target === scrollElement && event.button === 0) pointerReading = true;
    };
    const onPointerUp = () => {
      if (!pointerReading) return;
      readScroll();
      pointerReading = false;
      onResize();
    };
    const onScrollEnd = (event) => {
      if (event.target !== scrollElement) return;
      readScroll();
      readerDirection = 0;
    };
    const listeners = {
      scroll: onScroll, scrollend: onScrollEnd, wheel: onWheel, keydown: onKeyDown,
      touchstart: onTouchStart, touchmove: onTouchMove, touchend: onTouchEnd,
      touchcancel: onTouchEnd, pointerdown: onPointerDown,
    };
    controllerRef.current = { followTail };
    for (const [type, listener] of Object.entries(listeners)) {
      scrollElement.addEventListener(type, listener, { passive: true });
    }
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    observer?.observe(contentElement);
    observer?.observe(scrollElement);

    return () => {
      observer?.disconnect();
      for (const [type, listener] of Object.entries(listeners)) {
        scrollElement.removeEventListener(type, listener);
      }
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (controllerRef.current?.followTail === followTail) controllerRef.current = null;
    };
  }, [follow, scrollElement]);

  return useCallback(() => controllerRef.current?.followTail(), []);
}
