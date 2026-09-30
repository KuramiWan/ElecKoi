import { useCallback, useLayoutEffect, useRef, useState } from "react";

const FOLLOW_THRESHOLD = 24;
const SCROLL_SAMPLE_INTERVAL_MS = 500;

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

    let sampleTimer = null;
    let observationTop = scrollElement.scrollTop;

    const publish = (following) => {
      follow.setFollowing(following);
      if (followingRef.current === following) return;
      followingRef.current = following;
      onFollowingTailChangeRef.current(following);
    };
    const cancelPending = () => {
      if (sampleTimer !== null) window.clearTimeout(sampleTimer);
      sampleTimer = null;
    };
    const readScroll = () => {
      const metrics = scrollMetrics(scrollElement);
      return {
        metrics,
        movedByReader: Math.abs(metrics.top - Math.min(observationTop, metrics.floor)) > 0.5,
      };
    };
    const followTail = () => {
      const metrics = scrollMetrics(scrollElement);
      const landing = follow.toBottom(scrollElement, metrics, "instant");
      observationTop = landing.top;
      cancelPending();
      publish(true);
    };
    const flushSample = () => {
      if (sampleTimer === null) return;
      cancelPending();
      const scroll = readScroll();
      const following = follow.sample(scroll.metrics, scroll.movedByReader);
      if (!scroll.movedByReader && following) {
        followTail();
        return;
      }
      observationTop = scroll.metrics.top;
      publish(following);
    };
    const onScroll = () => {
      const scroll = readScroll();
      if ((!scroll.movedByReader && followingRef.current)
        || (scroll.movedByReader && scroll.metrics.top >= scroll.metrics.floor)) {
        followTail();
        return;
      }
      sampleTimer ??= window.setTimeout(flushSample, SCROLL_SAMPLE_INTERVAL_MS);
    };
    const onScrollEnd = (event) => {
      if (event.target === scrollElement) flushSample();
    };
    const onResize = () => {
      if (sampleTimer !== null) return;
      if (followingRef.current) followTail();
    };

    controllerRef.current = { followTail };
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    scrollElement.addEventListener("scrollend", onScrollEnd, { passive: true, capture: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    observer?.observe(contentElement);
    observer?.observe(scrollElement);

    return () => {
      cancelPending();
      observer?.disconnect();
      scrollElement.removeEventListener("scroll", onScroll);
      scrollElement.removeEventListener("scrollend", onScrollEnd, true);
      if (controllerRef.current?.followTail === followTail) controllerRef.current = null;
    };
  }, [follow, scrollElement]);

  return useCallback(() => controllerRef.current?.followTail(), []);
}
