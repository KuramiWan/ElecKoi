import { useCallback, useLayoutEffect, useRef } from "react";

const READING_INTENTS = ["wheel", "touchstart", "pointerdown", "keydown", "beforematch"];
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function clampScrollTop(element, value) {
  return Math.max(0, Math.min(Math.max(0, element.scrollHeight - element.clientHeight), value));
}

function findAnchor(flow, key) {
  for (const row of flow.querySelectorAll("[data-chat-anchor-key]:not([hidden]):not([hidden] *)")) {
    if (row.dataset.chatAnchorKey === key) return row;
  }
  return null;
}

export function useChatHistoryAnchor({ conversationId, messages, scrollElement }) {
  const pagingRef = useRef(null);

  const stopPreserving = useCallback(() => {
    pagingRef.current = null;
  }, []);

  const preserve = useCallback(() => {
    const paging = pagingRef.current;
    const flow = scrollElement?.querySelector(".message-flow");
    if (!paging || !scrollElement || !flow) return false;
    let row = paging.row;
    if (!flow.contains(row)) {
      row = findAnchor(flow, paging.anchorKey);
      if (!row) {
        stopPreserving();
        return false;
      }
      paging.row = row;
    }
    if (row.closest("[hidden]") || row.matches(":empty")) {
      stopPreserving();
      return false;
    }
    const viewportTop = scrollElement.getBoundingClientRect().top;
    const rowTop = row.getBoundingClientRect().top - viewportTop;
    const target = clampScrollTop(
      scrollElement,
      scrollElement.scrollTop + rowTop - paging.anchorTop,
    );
    if (target !== scrollElement.scrollTop) scrollElement.scrollTop = target;
    return true;
  }, [scrollElement, stopPreserving]);

  const beginPaging = useCallback(() => {
    stopPreserving();
    const flow = scrollElement?.querySelector(".message-flow");
    const row = flow?.querySelector(
      "[data-chat-paging-anchor]:not(:empty):not([hidden]):not([hidden] *)",
    );
    const anchorKey = row?.dataset.chatAnchorKey;
    if (!scrollElement || !row || !anchorKey) return false;
    pagingRef.current = {
      row,
      anchorKey,
      anchorTop: row.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top,
      scrollTop: scrollElement.scrollTop,
    };
    return true;
  }, [scrollElement, stopPreserving]);

  useLayoutEffect(() => {
    stopPreserving();
  }, [conversationId, stopPreserving]);

  useLayoutEffect(() => {
    if (pagingRef.current) preserve();
  }, [messages, preserve]);

  useLayoutEffect(() => {
    if (!scrollElement) return undefined;
    const flow = scrollElement.querySelector(".message-flow");
    const onIntent = (event) => {
      if (!pagingRef.current) return;
      if (event.type === "keydown" && (!(event instanceof KeyboardEvent) || !SCROLL_KEYS.has(event.key))) return;
      stopPreserving();
    };
    for (const type of READING_INTENTS) {
      scrollElement.addEventListener(type, onIntent, { passive: true, capture: true });
    }
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => preserve()) : null;
    if (flow) observer?.observe(flow);
    observer?.observe(scrollElement);
    return () => {
      observer?.disconnect();
      for (const type of READING_INTENTS) scrollElement.removeEventListener(type, onIntent, true);
      stopPreserving();
    };
  }, [preserve, scrollElement, stopPreserving]);

  return beginPaging;
}
