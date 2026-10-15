import { editorVersionsFixture } from './editorLibraryVersions.js';
/** Adapts synthetic configuration storage to the explicit editor contract. */
export function withRegexEditor(model) {
  model.editor = (scope, ownerId) => {
    const value = collection => collection ? { ...collection, target: { scope, ownerId }, ownerRevision: '0'.repeat(64) } : collection;
    const snapshot = state => ({ ...state, value: value(state.value) });
    const editor = {
      getSnapshot: () => snapshot(model.getSnapshot(ownerId)),
      read: async () => value(await model.read(ownerId)),
      save: async collection => value(await model.save(ownerId, collection)),
      subscribe: listener => model.subscribe((kind, id, state) => { if (kind === 'configuration' && id === ownerId) listener(snapshot(state)); }),
    };
    editor.versions = editorVersionsFixture('regex', () => editor.read(), async values => [await editor.save(values[0])], editor.subscribe);
    return editor;
  };
  return model;
}
