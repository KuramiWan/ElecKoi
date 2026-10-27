import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { OpeningEditor } from './OpeningEditor.jsx';
import { ConfirmationDialog, SaveControl } from './SettingLibraryControls.jsx';
import { deleteOpening } from '../model/settingLibraryEditing.js';
import { switchLibraryVersion } from '../model/settingLibraryTransfer.js';
import { useSettingLibraryDraft } from '../model/useSettingLibraryDraft.js';
import { resolveFailure } from '../../../utils/failureText.js';

export const CharacterOpeningsPanel = forwardRef(function CharacterOpeningsPanel({ characterId, settingLibraries, variables, onDirtyChange }, ref) {
  const { library, persisted, dirty, saving, error, saveNotice, changeLibrary, save, discard } = useSettingLibraryDraft({
    characterId, settingLibraries, onDirtyChange, label: '角色开场白',
  });
  const [variableSnapshot, setVariableSnapshot] = useState({ value: null, error: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const entry = library?.entries.find(item => item.id === 'fixed-opening-assistant' && item.kind === 'opening');

  useImperativeHandle(ref, () => ({ save, discard }), [library, persisted, saving]);
  useEffect(() => setDeleteTarget(null), [characterId, library?.activeVersionId]);
  useEffect(() => {
    let active = true;
    setVariableSnapshot({ value: null, error: '' });
    if (!variables) return undefined;
    const adopt = snapshot => { if (active) setVariableSnapshot(snapshot); };
    adopt(variables.getSnapshot(characterId));
    const stop = variables.subscribe((kind, id, snapshot) => {
      if (kind === 'configuration' && id === characterId) adopt(snapshot);
    });
    void variables.read(characterId).catch(cause => {
      if (active) setVariableSnapshot(current => ({ ...current, error: resolveFailure(cause, { fallback: '读取变量版本失败' }).text }));
    });
    return () => { active = false; stop(); };
  }, [characterId, variables]);

  function updateEntry(next) {
    changeLibrary(current => ({ ...current, entries: current.entries.map(item => item.id === entry.id ? next : item) }));
  }

  return (
    <section className="character-openings-panel" aria-label="角色开场白">
      <div className="character-openings-toolbar">
        {entry && <label className="character-openings-enabled">
          <span>启用开场白</span>
          <button type="button" className="setting-library-tree-switch" role="switch" aria-label="启用开场白"
            aria-checked={entry.enabled} disabled={saving} onClick={() => updateEntry({ ...entry, enabled: !entry.enabled })}>
            <span aria-hidden="true" />
          </button>
        </label>}
        {library?.versions.length > 1 && <label className="character-openings-version">
          <span>版本</span>
          <select aria-label="开场白所属版本" value={library.activeVersionId} disabled={saving}
            onChange={event => changeLibrary(current => switchLibraryVersion(current, event.target.value))}>
            {library.versions.map(version => <option key={version.id} value={version.id}>{version.id === library.activeVersionId ? library.name : version.name}</option>)}
          </select>
        </label>}
        <SaveControl dirty={dirty} error={error} notice={saveNotice} saving={saving} onSave={save} />
      </div>
      <div className="character-openings-content">
        {entry ? <OpeningEditor key={`${characterId}:${library.activeVersionId}`} entry={entry}
          variableVersions={variableSnapshot.value?.versions || []} variableVersionsError={variableSnapshot.error}
          onChange={updateEntry} onRequestDelete={message => setDeleteTarget({ messageId: message.id,
            title: `删除“${message.title || '未命名开场白'}”？`, message: '这条开场白会在保存后移除。' })} />
          : <p className="setting-library-loading" role={error || library ? 'alert' : 'status'}>{error || (library ? '角色开场白数据缺失，无法编辑。' : '正在读取…')}</p>}
      </div>
      <ConfirmationDialog target={deleteTarget} confirmLabel="删除" tone="destructive"
        onCancel={() => setDeleteTarget(null)} onConfirm={() => {
          updateEntry(deleteOpening(entry, deleteTarget.messageId));
          setDeleteTarget(null);
        }} />
    </section>
  );
});
