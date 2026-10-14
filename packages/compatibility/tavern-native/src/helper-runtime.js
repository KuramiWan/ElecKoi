const clone = value => value === undefined ? undefined : structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** One application-owned event bus, shared by all author frames. */
export class SharedEventHub {
  constructor() { this.events = new Map(); }
  on(event, listener, once = false, first = false) {
    if (typeof event !== 'string' || !event || typeof listener !== 'function') throw new TypeError('事件名和回调函数必须有效。');
    const entries = this.events.get(event) ?? [];
    if (!entries.some(entry => entry.listener === listener)) {
      const entry = { listener, once };
      first ? entries.unshift(entry) : entries.push(entry);
      this.events.set(event, entries);
    }
    return () => this.remove(event, listener);
  }
  remove(event, listener) {
    const entries = this.events.get(event);
    if (!entries) return;
    const next = entries.filter(entry => entry.listener !== listener);
    next.length ? this.events.set(event, next) : this.events.delete(event);
  }
  move(event, listener, first) {
    const entries = this.events.get(event);
    const entry = entries?.find(entry => entry.listener === listener);
    if (!entry) { this.on(event, listener, false, first); return; }
    this.remove(event, listener);
    const next = this.events.get(event) ?? [];
    first ? next.unshift(entry) : next.push(entry); this.events.set(event, next);
  }
  listeners(event) { return [...(this.events.get(event) ?? [])]; }
  emit(event, ...args) {
    const results = [];
    for (const entry of this.listeners(event)) {
      if (!(this.events.get(event) ?? []).includes(entry)) continue;
      if (entry.once) this.remove(event, entry.listener);
      results.push(entry.listener(...args));
    }
    return results;
  }
  async emitAndWait(event, ...args) {
    const results = [];
    for (const entry of this.listeners(event)) {
      if (!(this.events.get(event) ?? []).includes(entry)) continue;
      if (entry.once) this.remove(event, entry.listener);
      results.push(await entry.listener(...args));
    }
    return results;
  }
  clearEvent(event) { this.events.delete(event); }
  clearListener(listener) { for (const event of this.events.keys()) this.remove(event, listener); }
  clearAll() { this.events.clear(); }
}

export function createEventFunctions(rt) {
  const shared = rt.shared ?? (rt.shared = {});
  const hub = shared.eventHub ?? (shared.eventHub = new SharedEventHub());
  const owned = new Map();
  const register = (event, listener, once = false) => {
    const stop = hub.on(event, listener, once);
    const subscriptions = owned.get(event) ?? new Set(); subscriptions.add(listener); owned.set(event, subscriptions);
    return stop;
  };
  const reorder = (event, listener, first) => {
    register(event, listener);
    hub.move(event, listener, first);
  };
  rt.addCleanup?.(() => { for (const [event, listeners] of owned) for (const listener of listeners) hub.remove(event, listener); });
  return {
    eventOn: (event, listener) => register(event, listener),
    eventOnce: (event, listener) => register(event, listener, true),
    eventMakeFirst: (event, listener) => reorder(event, listener, true),
    eventMakeLast: (event, listener) => reorder(event, listener, false),
    eventEmit: (event, ...args) => {
      const results = hub.emit(event, ...args);
      for (const result of results) if (result && typeof result.then === 'function') {
        if (typeof rt.track !== 'function') throw new Error('异步事件需要原生运行时跟踪器。');
        rt.track(result);
      }
    },
    eventEmitAndWait: (event, ...args) => hub.emitAndWait(event, ...args),
    eventRemoveListener: (event, listener) => { hub.remove(event, listener); owned.get(event)?.delete(listener); },
    eventClearEvent: event => { hub.clearEvent(event); owned.delete(event); },
    eventClearListener: listener => { hub.clearListener(listener); for (const listeners of owned.values()) listeners.delete(listener); },
    eventClearAll: () => { hub.clearAll(); owned.clear(); },
    eventWaitOnce: (event, options = {}) => new Promise((resolve, reject) => {
      if (typeof options === 'number') options = { timeout: options };
      const signal = options.signal;
      let timer;
      const finish = () => { hub.remove(event, listener); if (timer !== undefined) rt.window.clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      const cancel = () => { finish(); reject(signal.reason ?? new Error('等待事件已取消。')); };
      const listener = (...args) => {
        if (options.predicate && !options.predicate(...args)) return;
        finish(); resolve(args);
      };
      if (signal?.aborted) { reject(signal.reason); return; }
      register(event, listener);
      signal?.addEventListener('abort', cancel, { once: true });
      if (Number.isFinite(options.timeout) && options.timeout >= 0) timer = rt.window.setTimeout(() => { finish(); reject(new Error(`等待事件超时：${event}`)); }, options.timeout);
    })
  };
}

export function createRuntimeFunctions(rt) {
  const shared = rt.shared ?? (rt.shared = {});
  const globals = shared.globals ?? (shared.globals = new Map());
  const pendingGlobals = shared.globalInitializations ?? (shared.globalInitializations = new Map());
  const waitingGlobals = shared.globalWaiters ?? (shared.globalWaiters = new Map());
  const request = (method, params = {}) => rt.native?.request
    ? rt.native.request(method, params) : rt.api?.request ? rt.api.request(method, params) : Promise.reject(new Error(`原生运行时未提供 ${method} 入口。`));
  const scripts = () => Array.isArray(rt.snapshot.scripts) ? rt.snapshot.scripts : [];
  const currentScript = id => {
    const selected = id ?? rt.snapshot.context?.scriptId ?? rt.scriptId;
    const script = scripts().find(script => script.id === selected || script.name === selected);
    if (!script) throw new Error(`原生脚本不存在或当前页面没有脚本身份：${selected ?? ''}`);
    return script;
  };
  const scriptParams = id => { const script = currentScript(id); return { id: script.id, scope: script.scope, ownerId: script.ownerId }; };
  const treeParams = options => {
    const settings = typeof options === 'string' ? { type: options } : object(options);
    return { scope: settings.scope ?? settings.type ?? 'global', ownerId: settings.ownerId ?? settings.character_id ?? settings.preset_id };
  };
  const change = async (method, field, value, id) => rt.commit(method, { ...scriptParams(id), [field]: clone(value) });
  const update = async (method, field, getter, updater, id) => {
    if (typeof updater !== 'function') throw new TypeError('更新器必须是函数。');
    const previous = clone(getter(id)); const result = await updater(previous);
    return change(method, field, result === undefined ? previous : result, id);
  };
  const info = id => clone(currentScript(id));
  const buttons = id => clone(currentScript(id).button?.buttons ?? []);
  const audioChannel = type => type === 'amb' ? 'ambient' : type ?? 'bgm';
  const version = name => {
    const value = rt.snapshot.versions?.[name] ?? (name === 'tavernHelper' ? rt.version : undefined);
    if (typeof value !== 'string' || !value) throw new Error(`原生宿主未提供 ${name} 的实际版本。`);
    return value;
  };
  return {
    initializeGlobal: async (name, initializer) => {
      if (typeof name !== 'string' || !name) throw new TypeError('共享名称不能为空。');
      if (globals.has(name)) return globals.get(name);
      if (pendingGlobals.has(name)) return pendingGlobals.get(name);
      const operation = Promise.resolve().then(() => typeof initializer === 'function' ? initializer() : initializer).then(value => {
        globals.set(name, value); pendingGlobals.delete(name);
        for (const waiter of waitingGlobals.get(name) ?? []) waiter.resolve(value);
        waitingGlobals.delete(name); return value;
      }, error => {
        pendingGlobals.delete(name);
        for (const waiter of waitingGlobals.get(name) ?? []) waiter.reject(error);
        waitingGlobals.delete(name); throw error;
      });
      pendingGlobals.set(name, operation); return operation;
    },
    waitGlobalInitialized: (name, options = {}) => {
      if (globals.has(name)) return Promise.resolve(globals.get(name));
      if (pendingGlobals.has(name)) return pendingGlobals.get(name);
      return new Promise((resolve, reject) => {
        const waiters = waitingGlobals.get(name) ?? new Set();
        let cancel;
        const cleanup = () => { waiters.delete(waiter); if (cancel) options.signal.removeEventListener('abort', cancel); };
        const waiter = { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } }; waiters.add(waiter); waitingGlobals.set(name, waiters);
        if (options.signal) {
          cancel = () => waiter.reject(options.signal.reason);
          if (options.signal.aborted) cancel(); else options.signal.addEventListener('abort', cancel, { once: true });
        }
      });
    },
    getScriptId: () => currentScript().id, getScriptName: () => currentScript().name,
    getScriptTrees: (options = {}) => rt.request('scripts.getTrees', treeParams(options)),
    replaceScriptTrees: (trees, options = {}) => rt.commit('scripts.replaceTrees', { ...treeParams(options), trees: clone(trees) }),
    updateScriptTreesWith: async (updater, options = {}) => {
      if (typeof updater !== 'function') throw new TypeError('脚本树更新器必须是函数。');
      const previous = clone(await rt.request('scripts.getTrees', treeParams(options))); const updated = await updater(previous);
      return rt.commit('scripts.replaceTrees', { ...treeParams(options), trees: updated === undefined ? previous : clone(updated) });
    },
    getScriptInfo: info, replaceScriptInfo: (value, id) => change('scripts.setInfo', 'info', value, id),
    updateScriptInfoWith: (updater, id) => update('scripts.setInfo', 'info', info, updater, id),
    getScriptButtons: buttons, replaceScriptButtons: (value, id) => change('scripts.setButtons', 'buttons', value, id),
    updateScriptButtonsWith: (updater, id) => update('scripts.setButtons', 'buttons', buttons, updater, id),
    appendInexistentScriptButtons: (values, id) => change('scripts.setButtons', 'buttons', [...buttons(id), ...clone(values).filter(button => !buttons(id).some(existing => existing.name === button.name))], id),
    getScriptButtonEvent: name => `eleckoi:script-button:${currentScript().id}:${name}`,
    getAllEnabledScriptButtons: () => scripts().filter(script => script.libraryEnabled && script.enabled && script.button?.enabled !== false)
      .flatMap(script => (script.button?.buttons ?? []).filter(button => button.visible !== false).map(button => ({ ...clone(button), script_id: script.id, event: `eleckoi:script-button:${script.id}:${button.name}` }))),
    getScriptData: id => clone(currentScript(id).data ?? {}),
    replaceScriptData: (value, id) => change('scripts.setSettings', 'data', value, id),
    getAudioList: async (type = 'bgm') => { const playlist = await request('audio.getPlaylist', { channel: audioChannel(type) }); return clone(playlist.items); },
    replaceAudioList: (type, items, options = {}) => request('audio.setPlaylist', { channel: audioChannel(type), items: clone(items), ...options }),
    appendAudioList: (type, items) => request('audio.appendPlaylist', { channel: audioChannel(type), items: clone(items) }),
    getAudioSettings: () => request('audio.getSettings'), setAudioSettings: settings => request('audio.setSettings', { settings: clone(settings) }),
    playAudio: (type, track, options = {}) => request('audio.play', { channel: audioChannel(type), track, ...options }),
    pauseAudio: (type = 'bgm') => request('audio.pause', { channel: audioChannel(type) }),
    resumeAudio: (type = 'bgm') => request('audio.resume', { channel: audioChannel(type) }),
    stopAudio: (type = 'bgm') => request('audio.stop', { channel: audioChannel(type) }),
    seekAudio: (type, seconds) => request('audio.seek', { channel: audioChannel(type), seconds }),
    getAudioState: (type = 'bgm') => request('audio.getState', { channel: audioChannel(type) }),
    getExtensionNames: () => (rt.snapshot.extensions ?? []).map(item => typeof item === 'string' ? item : item.name),
    isExtensionInstalled: name => (rt.snapshot.extensions ?? []).some(item => (typeof item === 'string' ? item : item.name) === name),
    isExtensionEnabled: name => (rt.snapshot.extensions ?? []).some(item => typeof item !== 'string' && item.name === name && item.enabled),
    installExtension: (url, options = {}) => rt.commit('extensions.install', { url, options: clone(options) }),
    uninstallExtension: name => rt.commit('extensions.uninstall', { name }),
    enableExtension: name => rt.commit('extensions.enable', { name }), disableExtension: name => rt.commit('extensions.disable', { name }),
    updateExtension: name => rt.commit('extensions.update', { name }),
    getTavernHelperVersion: () => version('tavernHelper'), getSillyTavernVersion: () => version('sillyTavern'),
    getTavernHelperExtensionId: () => { if (!rt.extensionId) throw new Error('当前原生兼容包没有扩展标识。'); return rt.extensionId; }
  };
}
