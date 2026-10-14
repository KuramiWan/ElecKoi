import { SharedEventHub } from './helper-runtime.js';

export const COMPATIBILITY_VERSION = '0.1.0';

/** Application state is owned by the persistent client, rather than any message iframe. */
export function createCompatibilitySharedState() {
  return { conversations: new Map(), eventHub: new SharedEventHub(), globals: new Map(),
    globalInitializations: new Map(), globalWaiters: new Map() };
}

export function createCompatibilityRuntime(view, options) {
  const shared = options.shared ?? createCompatibilitySharedState();
  shared.conversations ??= new Map();
  shared.eventHub ??= new SharedEventHub();
  const fixed = { ...options.context };
  const conversationId = fixed.conversationId ?? '';
  let record = shared.conversations.get(conversationId);
  if (!record) {
    record = { snapshot: undefined, members: new Set(), tail: Promise.resolve(), refreshing: null };
    shared.conversations.set(conversationId, record);
  }
  const localEvents = new SharedEventHub();
  const pending = new Set();
  const failures = [];
  const cleanups = new Set();
  let closed = false;
  const runtime = {
    window: view, shared, snapshot: undefined, native: options.native,
    version: COMPATIBILITY_VERSION, extensionId: '@eleckoi/tavern-native',
    scriptId: fixed.scriptId, scopeVariables: new Map(), variableSchemas: new Map(), tokens: options.tokens,
    addCleanup: cleanup => { cleanups.add(cleanup); return () => cleanups.delete(cleanup); },
    on(event, listener) {
      const hub = event === 'snapshot.updated' ? localEvents : shared.eventHub;
      const stop = hub.on(event, listener);
      cleanups.add(stop);
      return () => { stop(); cleanups.delete(stop); };
    },
    off: (event, listener) => (event === 'snapshot.updated' ? localEvents : shared.eventHub).remove(event, listener),
    emit: (event, ...args) => (event === 'snapshot.updated' ? localEvents : shared.eventHub).emit(event, ...args),
    moveListener: (event, listener, first) => (event === 'snapshot.updated' ? localEvents : shared.eventHub).move(event, listener, first),
    track(task) {
      const operation = Promise.resolve(task);
      if (pending.has(operation)) return operation;
      pending.add(operation);
      operation.then(() => pending.delete(operation), error => {
        pending.delete(operation); failures.push(error); options.report?.(error);
      });
      return operation;
    },
    async flush() {
      while (pending.size) await Promise.allSettled([...pending]);
      if (failures.length) throw new AggregateError(failures.splice(0), 'One or more native compatibility operations failed.');
    },
    request(method, params = {}) {
      if (closed) return Promise.reject(new Error('The author page has closed.'));
      return options.bridge.invoke(method, params);
    },
    commit(method, params = {}) {
      if (closed) return Promise.reject(new Error('The author page has closed.'));
      const operation = record.tail.then(async () => {
        const accepted = await options.bridge.invoke(method, params);
        // A snapshot started before this write cannot acknowledge the accepted mutation.
        if (record.refreshing) await record.refreshing;
        await refresh();
        return accepted;
      });
      record.tail = operation.then(() => undefined, () => undefined);
      return runtime.track(operation);
    },
    refresh,
    formatMessage: (text, settings) => {
      if (!options.ui?.formatMessage) throw new Error('The native message formatter is not connected.');
      return options.ui.formatMessage(text, settings);
    },
    refreshMessage: (messageId, settings) => {
      if (!options.ui?.refreshMessage) throw new Error('The native message renderer is not connected.');
      return options.ui.refreshMessage(messageId, settings);
    },
    dispose() {
      if (closed) return;
      closed = true;
      record.members.delete(acceptSnapshot);
      for (const cleanup of cleanups) cleanup();
      cleanups.clear(); localEvents.clearAll();
    },
  };

  function acceptSnapshot(snapshot) {
    if (closed) return;
    runtime.snapshot = { ...snapshot, context: { ...snapshot.context, ...fixed, conversationId } };
    runtime.scopeVariables.clear();
    for (const [scope, owners] of Object.entries(snapshot.variableScopes ?? {})) {
      for (const [owner, variables] of Object.entries(owners)) runtime.scopeVariables.set(`${scope}:${owner}`, structuredClone(variables));
    }
    // These native scopes exist before first use, including an empty global collection.
    for (const [scope, owner] of [['global', ''], ['character', runtime.snapshot.context.characterId], ['script', fixed.scriptId]]) {
      if (owner === undefined || scope !== 'global' && !owner) continue;
      if (!runtime.scopeVariables.has(`${scope}:${owner}`)) runtime.scopeVariables.set(`${scope}:${owner}`, {});
    }
    for (const message of snapshot.messages ?? []) {
      if (message.variableState !== undefined) runtime.scopeVariables.set(`message:${message.id}`, structuredClone(message.variableState));
    }
    localEvents.emit('snapshot.updated', runtime.snapshot);
  }

  async function refresh() {
    if (closed) throw new Error('The author page has closed.');
    if (!record.refreshing) {
      const operation = Promise.resolve(options.bridge.snapshot()).then(snapshot => {
        record.snapshot = snapshot;
        for (const member of record.members) member(snapshot);
        return snapshot;
      });
      record.refreshing = operation;
      const release = () => { if (record.refreshing === operation) record.refreshing = null; };
      operation.then(release, release);
    }
    await record.refreshing;
    return runtime.snapshot;
  }

  record.members.add(acceptSnapshot);
  if (record.snapshot) acceptSnapshot(record.snapshot);
  const pagehide = () => runtime.dispose();
  view.addEventListener('pagehide', pagehide, { once: true });
  runtime.addCleanup(() => view.removeEventListener('pagehide', pagehide));
  runtime.ready = refresh().then(() => undefined);
  return runtime;
}
