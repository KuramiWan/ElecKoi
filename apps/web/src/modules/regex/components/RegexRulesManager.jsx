import { EditorLibraryVersionManager } from '../../../ui/ui/EditorLibraryVersionManager.jsx';

export function RegexRulesManager({ libraryVersions, ownerScope, initialScope, busy, onClose }) {
  return <EditorLibraryVersionManager title="正则版本管理" versions={libraryVersions} ownerScope={ownerScope} initialScope={initialScope}
    ownerLabel={ownerScope === 'preset' ? '预设' : '角色卡'} busy={busy} onClose={onClose} />;
}
