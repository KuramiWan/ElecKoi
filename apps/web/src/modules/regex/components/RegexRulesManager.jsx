import { EditorLibraryVersionManager } from '../../../ui/ui/EditorLibraryVersionManager.jsx';

export function RegexRulesManager({ libraryVersions, ownerScope, busy, onClose }) {
  return <EditorLibraryVersionManager title="正则版本管理" versions={libraryVersions} ownerScope={ownerScope}
    ownerLabel={ownerScope === 'preset' ? '预设' : '角色卡'} busy={busy} onClose={onClose} />;
}
