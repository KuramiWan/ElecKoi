import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const RichMessageRenderContext = createContext(null);

/** Limits live documents by AI message identity while the official Chat owns reading position. */
export function RichMessageRenderProvider({ messages, enabled, floorLimit, children }) {
  const [manualMessageId, setManualMessageId] = useState(null);
  const previousIds = useRef(new Set());
  const automaticIds = useMemo(() => {
    const ids = new Set();
    for (let index = enabled ? messages.length - 1 : -1; index >= 0 && ids.size < floorLimit; index--) {
      const message = messages[index];
      if (message.role === 'assistant' && !message.pending && message.status !== 'streaming') ids.add(message.id);
    }
    if (ids.size === previousIds.current.size && [...ids].every(id => previousIds.current.has(id))) return previousIds.current;
    previousIds.current = ids;
    return ids;
  }, [messages, enabled, floorLimit]);
  useEffect(() => {
    if (manualMessageId !== null && (!enabled || automaticIds.has(manualMessageId)
      || !messages.some(message => message.id === manualMessageId))) setManualMessageId(null);
  }, [messages, enabled, automaticIds, manualMessageId]);
  const load = useCallback(id => setManualMessageId(id), []);
  const stop = useCallback(() => setManualMessageId(null), []);
  const value = useMemo(() => enabled ? ({ enabled, automaticIds, manualMessageId, load, stop }) : null,
    [enabled, automaticIds, manualMessageId, load, stop]);
  return <RichMessageRenderContext.Provider value={value}>{children}</RichMessageRenderContext.Provider>;
}

export function useRichMessageRenderPermission(messageId) {
  const policy = useContext(RichMessageRenderContext);
  const automatic = !policy?.enabled || policy.automaticIds.has(messageId);
  return {
    managed: Boolean(policy?.enabled),
    active: automatic || policy.manualMessageId === messageId,
    manual: !automatic && policy.manualMessageId === messageId,
    load: () => policy?.load(messageId),
    stop: policy?.stop,
  };
}
