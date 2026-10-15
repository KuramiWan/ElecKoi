import { useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { Copy, NotePencil, Plus, Trash } from '../icons/interfaceIcons.jsx';
import { ExportIcon, ImportIcon } from '../icons/index.jsx';
import { EditorManagementAction, EditorManagementModal } from './EditorCollectionControls.jsx';
import { VersionNameDialog } from './VersionNameDialog.jsx';

/** Version commands change the owner's draft; the surrounding editor performs the save. */
export function EditorVersionManager({ title, versions, activeVersionId, scopes, scope, onScopeChange,
  onSelect, onCopy, onCreate, onRename, onImport, onExport, onDelete, onClose, busy = false,
  children, extraActions = [], notice, error, deleteDisabled = false }) {
  const [dialog, setDialog] = useState('');
  const current = versions.find(version => version.id === activeVersionId);
  return <>
    <EditorManagementModal title={title} onClose={onClose}>
      <div className="editor-management-fields">
        {scopes?.length > 1 ? <label>归属<select value={scope} disabled={busy} onChange={event => { setDialog(''); onScopeChange(event.target.value); }}>
          {scopes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label> : null}
        <label>当前版本<select value={activeVersionId} disabled={busy} onChange={event => onSelect(event.target.value)}>
          {!activeVersionId && <option value="">未选择版本</option>}
          {versions.map(version => <option key={version.id} value={version.id}>{version.name.trim() || '待命名'}</option>)}
        </select></label>
      </div>
      <EditorManagementAction label="复制当前版本" Icon={Copy} disabled={busy || !current} onClick={() => setDialog('copy')} />
      <EditorManagementAction label="创建空白版本" Icon={Plus} disabled={busy} onClick={() => setDialog('create')} />
      {onImport && <EditorManagementAction label="导入为新版本" Icon={ImportIcon} disabled={busy} onClick={onImport} />}
      {onExport && <EditorManagementAction label="导出当前版本" Icon={ExportIcon} disabled={busy || !current} onClick={onExport} />}
      {extraActions.map(action => <EditorManagementAction key={action.label} {...action} disabled={busy || action.disabled} />)}
      <div className="editor-management-divider" />
      <EditorManagementAction label="重命名当前版本" Icon={NotePencil} disabled={busy || !current} onClick={() => setDialog('rename')} />
      <EditorManagementAction label="删除当前版本" Icon={Trash} danger disabled={busy || !current || deleteDisabled} onClick={() => setDialog('delete')} />
      {notice && <p className="editor-management-notice" role="status">{notice}</p>}
      {error && <p className="editor-management-notice is-error" role="alert">{error}</p>}
      {children}
    </EditorManagementModal>
    {['copy', 'create', 'rename'].includes(dialog) && <VersionNameDialog key={`${scope || ''}:${dialog}`}
      title={dialog === 'copy' ? '复制当前版本' : dialog === 'rename' ? '重命名当前版本' : '创建空白版本'}
      initialName={dialog === 'rename' ? current.name : ''} excludeId={dialog === 'rename' ? activeVersionId : undefined}
      confirmLabel={dialog === 'copy' ? '复制' : dialog === 'rename' ? '确定' : '创建'} versions={versions}
      onCancel={() => setDialog('')} onCreate={name => {
        if (dialog === 'rename') onRename(name);
        else if (dialog === 'copy') onCopy(name);
        else onCreate(name);
        setDialog('');
      }} />}
    {dialog === 'delete' && <EditorManagementModal title="删除当前版本？" onClose={() => setDialog('')}
      footer={<><Button variant="outline" onClick={() => setDialog('')}>取消</Button><Button variant="outline" className="is-danger" onClick={() => { onDelete(); setDialog(''); }}>删除</Button></>}>
      <p>删除“{current?.name || '待命名'}”将在保存后生效。</p>
    </EditorManagementModal>}
  </>;
}
