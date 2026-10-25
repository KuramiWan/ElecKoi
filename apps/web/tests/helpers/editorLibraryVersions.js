/** Synthetic storage adapter for editor tests; production persistence is tested separately. */
export function editorVersionsFixture(kind, read, write, subscribe = () => () => {}) {
  const states = new Map();
  const content = (scope, document) => JSON.stringify(kind === 'scripts'
    ? { enabled: document.enabled, trees: document.trees, variables: document.variables, files: [] }
    : { enabled: document[scope === 'global' ? 'globalEnabled' : scope === 'preset' ? 'agentPresetEnabled' : 'characterEnabled'] !== false,
        rules: scope === 'global' ? document.globalRules : scope === 'preset' ? document.agentPresetRules : document.characterRules });
  return {
    subscribe,
    async read(scope, ownerId) {
      const document = await read(scope, ownerId), key = JSON.stringify([scope, ownerId]);
      const current = states.get(key) || { kind, scope, ownerId, revision: 0, resourceRevision: kind === 'scripts' ? '0'.repeat(64) : '',
        activeVersionId: 'default', versions: [{ id: 'default', name: '默认版本', content: content(scope, document) }] };
      return structuredClone({ ...current, versions: current.versions.map(version => version.id === current.activeVersionId ? { ...version, content: content(scope, document) } : version) });
    },
    async save(documents, versions) {
      const saved = await write(documents);
      const next = versions.map(state => ({ ...structuredClone(state), revision: state.revision + 1 }));
      next.forEach(state => states.set(JSON.stringify([state.scope, state.ownerId]), state));
      return { documents: saved, versions: next };
    },
  };
}
export function withLibraryVersions(service, kind) {
  service.versions = editorVersionsFixture(kind, (scope, ownerId) => service.read(scope, ownerId), values => service.saveAll(values), service.subscribe);
  return service;
}
