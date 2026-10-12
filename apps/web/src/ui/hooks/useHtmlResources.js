import { useEffect, useState, useSyncExternalStore } from 'react';

const waiting = Object.freeze({ status: 'starting', error: '' });
const noSubscription = () => () => {};
const waitingSnapshot = () => waiting;

/** Each HTML document subscribes to the application's presentation resources. */
export function useHtmlResources() {
  const [runtime, setRuntime] = useState(() => globalThis.window?.__ElecKoiHtmlResources || null);
  useEffect(() => {
    const changed = () => setRuntime(window.__ElecKoiHtmlResources || null);
    window.addEventListener('eleckoi:html-resources', changed); changed();
    return () => window.removeEventListener('eleckoi:html-resources', changed);
  }, []);
  const state = useSyncExternalStore(runtime?.subscribe || noSubscription, runtime?.getSnapshot || waitingSnapshot, waitingSnapshot);
  return { runtime, state };
}
