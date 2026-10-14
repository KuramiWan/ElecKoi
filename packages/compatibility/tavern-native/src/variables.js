const SCOPES = new Set(['chat', 'global', 'character', 'script', 'message']);

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function record(value, description = 'Variables') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${description} must be an object.`);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function define(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function merge(current, incoming, overwrite) {
  const result = clone(record(current));
  for (const [key, value] of Object.entries(record(incoming))) {
    if (!Object.hasOwn(result, key)) define(result, key, clone(value));
    else {
      const previous = result[key];
      if (previous && typeof previous === 'object' && !Array.isArray(previous)
        && value && typeof value === 'object' && !Array.isArray(value)) {
        define(result, key, merge(previous, value, overwrite));
      } else if (overwrite) define(result, key, clone(value));
    }
  }
  return result;
}

function pathParts(path) {
  if (Array.isArray(path) && path.length && path.every(part => typeof part === 'string' || Number.isSafeInteger(part))) {
    return path.map(String);
  }
  if (typeof path !== 'string' || !path) throw new TypeError('Variable path must be nonempty.');
  const parts = [];
  const expression = /(?:^|\.)([^.\[\]]+)|\[(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/gy;
  let end = 0;
  while (end < path.length) {
    expression.lastIndex = end;
    const match = expression.exec(path);
    if (!match) throw new TypeError(`Invalid variable path: ${path}`);
    if (match[1] !== undefined) parts.push(match[1]);
    else if (match[2].startsWith('"')) parts.push(JSON.parse(match[2]));
    else if (match[2].startsWith("'")) parts.push(match[2].slice(1, -1).replace(/\\(.)/g, '$1'));
    else parts.push(match[2]);
    end = expression.lastIndex;
  }
  return parts;
}

/** A synchronous view of native state, with mutations awaiting the host's accepted result. */
export function createVariableApi(rt) {
  if (!rt.scopeVariables) rt.scopeVariables = new Map();
  if (!rt.variableSchemas) rt.variableSchemas = new Map();
  const reads = new Map();
  const writes = new Map();

  function scope(options = {}) {
    record(options, 'Variable options');
    const type = options.type ?? 'chat';
    if (!SCOPES.has(type)) throw new TypeError(`Unknown variable scope: ${String(type)}`);
    const context = rt.snapshot?.context ?? {};
    let owner = '';
    let message;
    if (type === 'chat') owner = context.conversationId;
    else if (type === 'character') owner = context.characterId;
    else if (type === 'script') owner = options.script_id ?? context.scriptId;
    else if (type === 'message') {
      const messages = rt.snapshot?.messages ?? [];
      const id = options.message_id ?? (context.messageId || -1);
      if (typeof id === 'number' || typeof id === 'string' && /^-?\d+$/.test(id)) {
        const index = Number(id);
        if (!Number.isSafeInteger(index)) throw new TypeError('Message index must be an integer.');
        message = messages[index < 0 ? messages.length + index : index];
      } else if (typeof id === 'string') message = messages.find(item => item.id === id);
      if (!message) throw failure('MESSAGE_NOT_AVAILABLE', `Variable message is not loaded: ${String(id)}`);
      owner = message.id;
    }
    if (typeof owner !== 'string' || type !== 'global' && !owner) {
      throw failure('VARIABLE_SCOPE_NOT_AVAILABLE', `The ${type} variable scope has no native owner.`);
    }
    return { scope: type, owner, key: `${type}:${owner}`, message };
  }

  async function load(target) {
    const value = record(await rt.request('variables.getScope', { scope: target.scope, owner: target.owner }), 'Native variable state');
    rt.scopeVariables.set(target.key, clone(value));
    return clone(value);
  }

  function startRead(target) {
    if (reads.has(target.key)) return;
    if (typeof rt.track !== 'function') {
      throw failure('VARIABLE_TRACKING_NOT_AVAILABLE', 'Variable reads require runtime error tracking.');
    }
    const promise = Promise.resolve().then(() => load(target)).finally(() => { reads.delete(target.key); });
    reads.set(target.key, promise);
    rt.track(promise);
  }

  function read(target) {
    if (target.scope === 'chat') return clone(record(rt.snapshot?.variables, 'Native chat variables'));
    if (rt.scopeVariables.has(target.key)) return clone(record(rt.scopeVariables.get(target.key), 'Cached variables'));
    if (target.scope === 'message' && target.message.variableState !== null && target.message.variableState !== undefined) {
      return clone(record(target.message.variableState, 'Native message variables'));
    }
    startRead(target);
    throw failure('VARIABLES_NOT_READY', `Native ${target.scope} variables are loading; read again after runtime synchronization.`);
  }

  async function readForWrite(target) {
    if (target.scope === 'chat') return read(target);
    if (reads.has(target.key)) await reads.get(target.key);
    return load(target);
  }

  async function save(target, value) {
    const candidate = clone(record(value));
    if (reads.has(target.key)) await reads.get(target.key);
    const accepted = record(await (target.scope === 'chat'
      ? rt.commit('variables.setState', { state: candidate })
      : rt.request('variables.setScope', { scope: target.scope, owner: target.owner, variables: candidate })), 'Saved native variables');
    if (target.scope === 'chat') rt.snapshot.variables = clone(accepted);
    else rt.scopeVariables.set(target.key, clone(accepted));
    return clone(accepted);
  }

  function serialized(target, action) {
    const previous = writes.get(target.key);
    const promise = (previous ? previous.catch(() => {}) : Promise.resolve()).then(action);
    writes.set(target.key, promise);
    const release = () => { if (writes.get(target.key) === promise) writes.delete(target.key); };
    promise.then(release, release);
    return promise;
  }

  async function replaceVariables(variables, options = {}) {
    const target = scope(options);
    const value = clone(record(variables));
    return serialized(target, () => save(target, value));
  }

  async function updateVariablesWith(updater, options = {}) {
    if (typeof updater !== 'function') throw new TypeError('Variable updater must be a function.');
    const target = scope(options);
    return serialized(target, async () => {
      const current = await readForWrite(target);
      const updated = await updater(current);
      return save(target, updated === undefined ? current : updated);
    });
  }

  async function insertOrAssignVariables(variables, options = {}) {
    const incoming = clone(record(variables));
    return updateVariablesWith(current => merge(current, incoming, true), options);
  }

  async function insertVariables(variables, options = {}) {
    const incoming = clone(record(variables));
    return updateVariablesWith(current => merge(current, incoming, false), options);
  }

  async function deleteVariable(path, options = {}) {
    const parts = pathParts(path);
    const target = scope(options);
    return serialized(target, async () => {
      const current = await readForWrite(target);
      // An explicit literal key wins, as it may legitimately contain dots or brackets.
      const keys = typeof path === 'string' && Object.hasOwn(current, path) ? [path] : parts;
      let parent = current;
      for (const key of keys.slice(0, -1)) {
        if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) {
          return { variables: current, delete_occurred: false };
        }
        parent = parent[key];
      }
      const key = keys.at(-1);
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) {
        return { variables: current, delete_occurred: false };
      }
      if (Array.isArray(parent) && /^(0|[1-9]\d*)$/.test(key)) parent.splice(Number(key), 1);
      else delete parent[key];
      return { variables: await save(target, current), delete_occurred: true };
    });
  }

  function registerVariableSchema(schema, options = {}) {
    if (!schema || !['object', 'function'].includes(typeof schema)) throw new TypeError('Variable editing schema is required.');
    const target = scope(options);
    rt.variableSchemas.set(target.key, schema);
    // Schemas describe the editor; writes remain governed by the native host.
    return () => { if (rt.variableSchemas.get(target.key) === schema) rt.variableSchemas.delete(target.key); };
  }

  function getAllVariables(options = {}) {
    record(options, 'Variable options');
    const context = rt.snapshot?.context ?? {};
    const selected = [{ type: 'global' }];
    if (context.characterId) selected.push({ type: 'character' });
    if (context.conversationId) selected.push({ type: 'chat' });
    if (options.message_id !== undefined || context.messageId || rt.snapshot?.messages?.length) selected.push({ type: 'message', message_id: options.message_id });
    if (options.script_id !== undefined || context.scriptId) selected.push({ type: 'script', script_id: options.script_id });
    let result = {};
    let unavailable;
    for (const item of selected) {
      try { result = merge(result, read(scope(item)), true); }
      catch (error) {
        if (error.code !== 'VARIABLES_NOT_READY') throw error;
        unavailable ??= error;
      }
    }
    if (unavailable) throw unavailable;
    return result;
  }

  return {
    getVariables: (options = {}) => read(scope(options)), replaceVariables, updateVariablesWith,
    insertOrAssignVariables, insertVariables, deleteVariable, registerVariableSchema, getAllVariables,
  };
}
