const copy = value => value === undefined ? undefined : structuredClone(value);
const list = value => Array.isArray(value) ? value : value?.items ?? [];
const identity = value => typeof value === 'string' ? value : value?.id ?? value?.name;
const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Public catalog names are projections of the authoritative native snapshot. */
export function createCatalogFunctions(rt) {
  const items = kind => list(rt.snapshot[kind]);
  const names = kind => items(kind).map(item => item.name ?? item.id);
  const ids = kind => items(kind).map(item => item.id);
  const active = kind => rt.snapshot[kind]?.activeId ?? rt.snapshot.context?.[`${kind.slice(0, -1)}Id`];
  const resolve = (kind, name) => {
    const selected = name === undefined || name === 'current' ? active(kind) : identity(name);
    const found = items(kind).find(item => item.id === selected || item.name === selected);
    if (!found) throw new Error(`找不到 ${kind}：${selected ?? ''}`);
    return found.id;
  };
  const currentName = kind => items(kind).find(item => item.id === active(kind))?.name ?? '';
  const read = (kind, name) => rt.request(`${kind}.get`, { id: resolve(`${kind}s`, name) });
  const write = (kind, name, data, mode = 'replace', options = {}) => rt.commit(`${kind}.${mode}`, {
    ...(mode === 'create' ? { name: identity(name) } : { id: resolve(`${kind}s`, name) }),
    data: copy(asObject(data)), options: copy(options)
  });
  const create = async (kind, name, data, options) => {
    await write(kind, name, data, 'create', options);
    return true;
  };
  const replace = (kind, name, data, options) => write(kind, name, data, 'replace', options);
  const upsert = async (kind, name, data, options) => {
    const exists = items(`${kind}s`).some(item => item.id === identity(name) || item.name === identity(name));
    if (exists) { await replace(kind, name, data, options); return false; }
    await create(kind, name, data, options); return true;
  };
  const remove = async (kind, name, options) => {
    const existing = items(`${kind}s`).find(item => item.id === identity(name) || item.name === identity(name));
    if (!existing) return false;
    await rt.commit(`${kind}.delete`, { id: existing.id, options: copy(options ?? {}) }); return true;
  };
  const update = async (kind, name, updater, options) => {
    if (typeof updater !== 'function') throw new TypeError('更新器必须是函数。');
    const value = copy(await read(kind, name));
    const result = await updater(value);
    return replace(kind, name, result === undefined ? value : result, options);
  };
  const worldbook = async name => rt.request('worldbook.get', { name: identity(name) });
  const writeWorldbook = (name, entries, mode = 'replace', options = {}) => rt.commit(`worldbook.${mode}`, {
    name: identity(name), entries: copy(entries), options: copy(options)
  });
  const updateWorldbook = async (name, updater, options) => {
    if (typeof updater !== 'function') throw new TypeError('更新器必须是函数。');
    const entries = copy(await worldbook(name));
    const result = await updater(entries);
    return writeWorldbook(name, result === undefined ? entries : result, 'replace', options);
  };
  const binding = (scope, owner, names) => rt.commit('worldbook.bindings', {
    scope, owner: owner === undefined || owner === 'current' ? undefined : scope === 'character' ? resolve('characters', owner) : identity(owner), names: copy(names)
  });
  const bindings = (scope, owner) => {
    const state = rt.snapshot.worldbooks?.bindings ?? {};
    if (scope === 'global') return copy(state.global ?? []);
    const id = owner === undefined || owner === 'current'
      ? (scope === 'character' ? rt.snapshot.context?.characterId : rt.snapshot.context?.conversationId)
      : (scope === 'character' ? resolve('characters', owner) : identity(owner));
    return copy(state[scope]?.[id] ?? (scope === 'chat' ? null : { primary: null, additional: [] }));
  };
  const regexes = options => {
    const collection = rt.snapshot.regexes ?? {};
    const scope = options?.scope ?? 'all';
    const result = scope === 'all' ? [...(collection.global ?? []), ...(collection.preset ?? []), ...(collection.character ?? [])] : collection[scope] ?? [];
    return copy(options?.enable_state === 'enabled' ? result.filter(rule => rule.enabled !== false) : options?.enable_state === 'disabled' ? result.filter(rule => rule.enabled === false) : result);
  };
  class RawCharacter {
    constructor(data) {
      const record = copy(asObject(data));
      this.characterData = record.data;
      delete record.data;
      Object.assign(this, record);
    }
    static async get(name = 'current') { return new RawCharacter(await read('character', name)); }
    get data() { return copy(this.characterData ?? this.cardData ?? Object.fromEntries(Object.entries(this))); }
    getAvatarPath() { return this.avatar ?? this.persona?.assistant_avatar ?? ''; }
    getData() { return this.data; }
    async save() { return replace('character', this.id ?? this.name, this.data); }
  }
  const result = {
    getCharacterNames: () => names('characters'), getCharacterIds: () => ids('characters'),
    getCurrentCharacterName: () => currentName('characters'), getCurrentCharacterId: () => active('characters') ?? '',
    createCharacter: (name, data, options) => create('character', name, data, options),
    createOrReplaceCharacter: (name, data, options) => upsert('character', name, data, options),
    deleteCharacter: (name, options) => remove('character', name, options),
    getCharacter: (name = 'current') => read('character', name),
    replaceCharacter: (name, data, options) => replace('character', name, data, options),
    updateCharacterWith: (name, updater, options) => update('character', name, updater, options),
    RawCharacter, getCharData: (name = 'current') => RawCharacter.get(name),
    getCharAvatarPath: (name = 'current') => items('characters').find(item => item.id === resolve('characters', name))?.avatar ?? '',
    getChatHistoryBrief: (name = 'current') => rt.request('chat.historyBrief', { characterId: resolve('characters', name) }),
    getChatHistoryDetail: (name, chat) => rt.request('chat.historyDetail', { characterId: resolve('characters', name), chat: identity(chat) }),
    getPersonaNames: () => names('personas'), getPersonaIds: () => ids('personas'),
    getCurrentPersonaName: () => currentName('personas'), getCurrentPersonaId: () => active('personas') ?? '',
    getPersonaAvatarPath: (name = 'current') => items('personas').find(item => item.id === resolve('personas', name))?.avatar ?? '',
    getPersona: (name = 'current') => read('persona', name),
    createPersona: (name, data, options) => create('persona', name, data, options),
    createOrReplacePersona: (name, data, options) => upsert('persona', name, data, options),
    deletePersona: (name, options) => remove('persona', name, options),
    replacePersona: (name, data, options) => replace('persona', name, data, options),
    updatePersonaWith: (name, updater, options) => update('persona', name, updater, options),
    isPresetNormalPrompt: prompt => !!prompt && !prompt.marker && !prompt.system_prompt && prompt.type !== 'system' && prompt.type !== 'placeholder',
    isPresetSystemPrompt: prompt => !!prompt && (prompt.system_prompt === true || prompt.type === 'system'),
    isPresetPlaceholderPrompt: prompt => !!prompt && (prompt.marker === true || prompt.type === 'placeholder'),
    getPresetNames: () => names('presets'), getLoadedPresetName: () => currentName('presets'),
    loadPreset: name => rt.commit('preset.select', { id: resolve('presets', name) }),
    getPreset: (name = 'current') => read('preset', name),
    createPreset: (name, data, options) => create('preset', name, data, options),
    createOrReplacePreset: (name, data, options) => upsert('preset', name, data, options),
    deletePreset: (name, options) => remove('preset', name, options),
    renamePreset: (name, newName) => rt.commit('preset.rename', { id: resolve('presets', name), name: newName }),
    replacePreset: (name, data, options) => replace('preset', name, data, options),
    updatePresetWith: (name, updater, options) => update('preset', name, updater, options),
    setPreset: (data, options) => replace('preset', 'current', data, options),
    getWorldbookNames: () => names('worldbooks'), getGlobalWorldbookNames: () => bindings('global'),
    rebindGlobalWorldbooks: values => binding('global', undefined, values),
    getCharWorldbookNames: (name = 'current') => bindings('character', name),
    rebindCharWorldbooks: (name, values) => binding('character', name, values),
    getChatWorldbookName: (chat = 'current') => bindings('chat', chat),
    rebindChatWorldbook: (chat, value) => binding('chat', chat, value),
    getOrCreateChatWorldbook: (chat = 'current', name) => rt.commit('worldbook.getOrCreateChat', { owner: chat === 'current' ? undefined : identity(chat), name }),
    getWorldbook: worldbook,
    createWorldbook: async (name, entries = [], options) => { if (names('worldbooks').includes(name)) return false; await writeWorldbook(name, entries, 'create', options); return true; },
    createOrReplaceWorldbook: async (name, entries = [], options) => { const fresh = !names('worldbooks').includes(name); await writeWorldbook(name, entries, fresh ? 'create' : 'replace', options); return fresh; },
    deleteWorldbook: async (name, options) => { if (!names('worldbooks').includes(name)) return false; await rt.commit('worldbook.delete', { name, options: copy(options ?? {}) }); return true; },
    replaceWorldbook: (name, entries, options) => writeWorldbook(name, entries, 'replace', options), updateWorldbookWith: updateWorldbook,
    createWorldbookEntries: (name, entries, options) => rt.commit('worldbook.createEntries', { name, entries: copy(entries), options: copy(options ?? {}) }),
    deleteWorldbookEntries: async (name, selector, options) => {
      const entries = await worldbook(name);
      const selected = typeof selector === 'function' ? entries.filter(selector).map(entry => entry.uid ?? entry.id) : selector;
      return rt.commit('worldbook.deleteEntries', { name, ids: copy(selected ?? []), options: copy(options ?? {}) });
    },
    getLorebookSettings: () => copy(rt.snapshot.lorebookSettings ?? {}),
    setLorebookSettings: value => rt.commit('worldbook.settings', { data: copy(value) }),
    getLorebooks: () => names('worldbooks'), getCharLorebooks: (name = 'current') => bindings('character', name),
    getCurrentCharPrimaryLorebook: () => bindings('character')?.primary ?? null,
    setCurrentCharLorebooks: value => binding('character', undefined, value),
    getChatLorebook: (chat = 'current') => bindings('chat', chat),
    setChatLorebook: (name, chat = 'current') => binding('chat', chat, name),
    getLorebookEntries: worldbook, replaceLorebookEntries: (name, entries, options) => writeWorldbook(name, entries, 'replace', options), updateLorebookEntriesWith: updateWorldbook,
    setLorebookEntries: async (name, updates, options) => updateWorldbook(name, entries => entries.map(entry => ({ ...entry, ...updates.find(update => (update.uid ?? update.id) === (entry.uid ?? entry.id)) })), options),
    isCharacterTavernRegexesEnabled: () => rt.snapshot.regexes?.characterEnabled !== false,
    getTavernRegexes: regexes,
    replaceTavernRegexes: (rules, options = {}) => rt.commit('regex.replace', { rules: copy(rules), options: copy(options) }),
    updateTavernRegexesWith: async (updater, options = {}) => { const current = regexes(options); const changed = await updater(current); return rt.commit('regex.replace', { rules: copy(changed === undefined ? current : changed), options: copy(options) }); },
    formatAsTavernRegexedString: (text, source, destination, options = {}) => {
      let value = String(text);
      for (const rule of regexes({ scope: 'all', enable_state: 'enabled' })) {
        const targets = rule.targets ?? rule.placement ?? [];
        if (targets.length && !targets.includes(source) && !targets.includes({ user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }[source]) && !targets.includes({ user_input: 'UserInput', ai_output: 'AiOutput', slash_command: 'SlashCommand', world_info: 'SettingContent', reasoning: 'Reasoning' }[source])) continue;
        if ((rule.displayOnly ?? rule.markdown_only) && destination !== 'display') continue;
        if ((rule.promptOnly ?? rule.prompt_only) && destination !== 'prompt') continue;
        const depth = options.depth;
        if (typeof depth === 'number' && ((rule.min_depth ?? rule.minDepth) != null && depth < (rule.min_depth ?? rule.minDepth) || (rule.max_depth ?? rule.maxDepth) != null && depth > (rule.max_depth ?? rule.maxDepth))) continue;
        const sourcePattern = rule.pattern ?? rule.find_regex ?? rule.findRegex ?? '';
        const literal = /^\/(.*)\/([a-z]*)$/s.exec(sourcePattern);
        const pattern = new RegExp(literal ? literal[1] : sourcePattern, literal ? literal[2] : 'g');
        value = value.replace(pattern, rule.replacement ?? rule.replace_string ?? rule.replaceString ?? '');
      }
      return value;
    }
  };
  result.createLorebook = result.createWorldbook; result.deleteLorebook = result.deleteWorldbook;
  result.getOrCreateChatLorebook = result.getOrCreateChatWorldbook;
  result.createLorebookEntries = result.createWorldbookEntries; result.deleteLorebookEntries = result.deleteWorldbookEntries;
  for (const [fn, kind] of Object.entries({ importRawCharacter: 'character', importRawChat: 'chat', importRawPreset: 'preset', importRawWorldbook: 'worldbook', importRawTavernRegex: 'regex' })) {
    result[fn] = async (file, options = {}) => {
      const isBlob = typeof Blob !== 'undefined' && file instanceof Blob;
      if (isBlob && (kind === 'character' || kind === 'preset') && (file.type === 'image/png' || /\.png$/i.test(file.name ?? ''))) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        return rt.commit(`import.${kind}`, { base64: rt.window.btoa(binary), mimeType: 'image/png', name: file.name ?? options.name, options: copy(options) });
      }
      const raw = isBlob ? await file.text() : typeof file === 'string' ? file : JSON.stringify(file);
      return rt.commit(`import.${kind}`, { raw, name: file?.name ?? options.name, options: copy(options) });
    };
  }
  return result;
}
