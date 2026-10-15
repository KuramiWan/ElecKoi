import { createScriptItem } from '../../apps/web/src/modules/scripts/model/scriptEditing.js';
import { newDisplayTemplate } from '../../apps/web/src/modules/displayTemplates/DisplayTemplatesPanel.jsx';
import { createRegexRule } from '../../apps/web/src/modules/regex/model/regexRulesEditing.js';
import { withLibraryVersions } from './editorLibraryVersions.js';
import { withRegexEditor } from './regexEditorModel.js';

export function editorCollectionService(kind, ownerScope, onSave = () => {}) {
  const ownerId = `synthetic-${ownerScope}`, owners = { global: '', [ownerScope]: ownerId };
  if (kind === 'regex') {
    let stored = { globalRules: [], characterRules: [], agentPresetRules: [], versions: [], activeVersionId: '', revision: 0,
      globalEnabled: true, characterEnabled: true, agentPresetEnabled: true };
    for (const scope of Object.keys(owners)) {
      stored = createRegexRule(stored, scope === 'global' ? 'Global' : scope === 'preset' ? 'AgentPreset' : 'Character').collection;
      const key = scope === 'global' ? 'globalRules' : scope === 'preset' ? 'agentPresetRules' : 'characterRules';
      stored[key][0] = { ...stored[key][0], id: `synthetic-${scope}`, name: `合成${scope}条目`, enabled: true };
    }
    return withRegexEditor({ getSnapshot: () => ({ status: 'ready', value: stored }), subscribe: () => () => {}, read: async () => stored,
      save: async (_ownerId, draft) => { stored = { ...draft, revision: draft.revision + 1 }; onSave(stored); return stored; } });
  }
  const documents = Object.fromEntries(Object.entries(owners).map(([scope, id]) => [scope, {
    scope, ownerId: id, enabled: true, revision: 0,
    ...(kind === 'scripts' ? { variables: {}, trees: [{ ...createScriptItem('script', 'synthetic-item'), name: `合成${scope}条目`, enabled: true }] }
      : { templates: [{ ...newDisplayTemplate('synthetic-item'), name: `合成${scope}条目`, enabled: true }] }),
  }]));
  return withLibraryVersions({ read: async scope => structuredClone(documents[scope]), subscribe: () => () => {}, subscribeChanges: () => () => {},
    saveAll: async drafts => { const result = drafts.map(draft => documents[draft.scope] = { ...draft, revision: draft.revision + 1 }); onSave(result); return result; } },
  kind === 'scripts' ? 'scripts' : 'displayTemplates');
}
