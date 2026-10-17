import { bestEffort } from "../../utils/swallowedFailure.js";
const STACK_KEY = Symbol.for('eleckoi.ui.overlay-back');

/** Extension overlays consume Back before the underlying application route. */
export function registerOverlayBack(handler, target = window, priority = 100) {
  let owner = target;
  try {
    if (target.top?.location.origin === target.location.origin) owner = target.top;
  } catch {
    // 跨源 frame 自己负责自己的导航，这里没有可做的事。
    bestEffort();
  }
  let state = owner[STACK_KEY];
  if (!state) {
    state = { entries: [] };
    state.consume = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      const current = state.entries.reduce((top, entry) => !top || entry.priority >= top.priority ? entry : top, null);
      if (!current || current.handler(event) === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    owner[STACK_KEY] = state;
    owner.addEventListener('eleckoi:platform-back', state.consume, true);
    owner.addEventListener('keydown', state.consume, true);
  }
  const entry = { handler, priority };
  state.entries.push(entry);
  return () => {
    const index = state.entries.indexOf(entry);
    if (index !== -1) state.entries.splice(index, 1);
    if (!state.entries.length) {
      owner.removeEventListener('eleckoi:platform-back', state.consume, true);
      owner.removeEventListener('keydown', state.consume, true);
      delete owner[STACK_KEY];
    }
  };
}
