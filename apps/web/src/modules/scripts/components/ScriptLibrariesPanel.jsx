import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, ArrowClockwise, CaretDown, Copy, FileCode, FolderSimple, PencilSimple, Plus, Power, Trash, X } from '../../../ui/icons/interfaceIcons.jsx';
import { SaveControl } from '../../settingLibraries/index.js';
import { ConfirmationDialog } from '../../../ui/ui/ConfirmationDialog.jsx';
import { EditorSidebarLayout } from '../../../ui/ui/EditorSidebarLayout.jsx';
import { EditorContextMenu, useEditorContextMenu } from '../../../ui/ui/EditorContextMenu.jsx';
import { isNativeAuthorScript } from '@eleckoi/author-sdk';
import { createScriptItem, findScriptItem, itemBufferKey, libraryKey, materializeScriptBuffers, moveScriptItem, removeScriptItem, updateScriptItem } from '../model/scriptEditing.js';

const noopSubscribe = () => () => {};
const emptyRuntime = { scriptStatuses: {}, error: '' };
const emptySnapshot = () => emptyRuntime;
const noRuntime = () => null;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const jsonText = value => JSON.stringify(value, null, 2);

function Switch({ checked, label, disabled, onChange }) {
  return <label className="script-switch" title={label}>
    <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <i aria-hidden="true" />
  </label>;
}

function Tool({ label, Icon, onClick, disabled }) {
  return <button type="button" className="script-tool" title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon size={18} aria-hidden="true" /></button>;
}

function ScriptInspector({ library, item, groupLabel, busy, buffers, onBuffer, onChange, onMove, onDuplicate, onDelete, onClose, execution }) {
  const [tab, setTab] = useState('source');
  useEffect(() => setTab('source'), [library.scope, library.ownerId, item?.id]);
  const key = libraryKey(library.scope, library.ownerId);
  const textField = (id, field, value, label) => <label className="script-field"><span>{label}</span>
    <textarea className="is-code" spellCheck={false} value={buffers[itemBufferKey(key, id, field)] ?? jsonText(value)} disabled={busy}
      onChange={event => onBuffer(itemBufferKey(key, id, field), event.target.value)} /></label>;
  return <aside className="script-inspector">
    <header><strong>{item?.name || groupLabel}</strong><div>
      {item && <><Tool label="上移" Icon={ArrowUp} disabled={busy} onClick={() => onMove(undefined, -1)} />
        <Tool label="下移" Icon={ArrowDown} disabled={busy} onClick={() => onMove(undefined, 1)} />
        <Tool label="复制" Icon={Copy} disabled={busy} onClick={onDuplicate} />
        <Tool label="删除" Icon={Trash} disabled={busy} onClick={onDelete} /></>}
      <Tool label="关闭编辑器" Icon={X} onClick={onClose} />
    </div></header>
    {!item ? <div className="script-inspector-fields">{textField('', 'variables', library.variables, '脚本库变量')}</div> : <>
      <div className="script-inspector-fields script-identity">
        <label className="script-field"><span>名称</span><input value={item.name} disabled={busy} onChange={event => onChange({ name: event.target.value })} /></label>
      </div>
      {item.type === 'script' && <>
        <div className="script-inspector-tabs" role="tablist" aria-label="脚本编辑内容">{[['source', '源码'], ['settings', '设置'], ['buttons', '按钮'], ['info', '信息']].map(([id, label]) =>
          <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`script-editor-${id}`} id={`script-tab-${id}`} onClick={() => setTab(id)}>{label}</button>)}</div>
        <div className={`script-inspector-fields script-tab-body is-${tab}`} role="tabpanel" id={`script-editor-${tab}`} aria-labelledby={`script-tab-${tab}`}>
          {tab === 'source' && <textarea className="script-source is-code" aria-label="脚本源码" spellCheck={false} disabled={busy} value={item.content} onChange={event => onChange({ content: event.target.value })} />}
          {tab === 'settings' && <>{textField(item.id, 'data', item.data, '脚本设置')}
            <label className="script-option"><input type="checkbox" checked={item.export_with.data} disabled={busy} onChange={event => onChange({ export_with: { ...item.export_with, data: event.target.checked } })} />导出时包含脚本设置</label>
            <label className="script-option"><input type="checkbox" checked={item.export_with.button} disabled={busy} onChange={event => onChange({ export_with: { ...item.export_with, button: event.target.checked } })} />导出时包含按钮设置</label></>}
          {tab === 'buttons' && <>
            <label className="script-option"><input type="checkbox" checked={item.button.enabled} disabled={busy} onChange={event => onChange({ button: { ...item.button, enabled: event.target.checked } })} />显示脚本按钮</label>
            {!isNativeAuthorScript(item) && item.button.buttons.map((button, index) => <div className="script-button-row" key={index}>
              <input aria-label={`按钮 ${index + 1} 名称`} value={button.name} disabled={busy} onChange={event => onChange({ button: { ...item.button, buttons: item.button.buttons.map((value, position) => position === index ? { ...value, name: event.target.value } : value) } })} />
              <Switch label={`显示按钮 ${index + 1}`} checked={button.visible} disabled={busy} onChange={visible => onChange({ button: { ...item.button, buttons: item.button.buttons.map((value, position) => position === index ? { ...value, visible } : value) } })} />
              <Tool label={`删除按钮 ${index + 1}`} Icon={Trash} disabled={busy} onClick={() => onChange({ button: { ...item.button, buttons: item.button.buttons.filter((_, position) => position !== index) } })} />
            </div>)}
            {!isNativeAuthorScript(item) && <Tool label="新增按钮" Icon={Plus} disabled={busy} onClick={() => onChange({ button: { ...item.button, buttons: [...item.button.buttons, { name: '', visible: true }] } })} />}
          </>}
          {tab === 'info' && <label className="script-field"><span>脚本信息</span><textarea disabled={busy} value={item.info} onChange={event => onChange({ info: event.target.value })} /></label>}
        </div>
      </>}
      {execution?.error && <pre className="script-execution-error" role="alert">{execution.error}</pre>}
    </>}
  </aside>;
}

export const ScriptLibrariesPanel = forwardRef(function ScriptLibrariesPanel({ characterId, scriptLibraries, scriptRuntimeConnection, onDirtyChange }, ref) {
  const [drafts, setDrafts] = useState({}), [baselines, setBaselines] = useState({}), [buffers, setBuffers] = useState({});
  const [preset, setPreset] = useState(null), [selection, setSelection] = useState(null), [collapsed, setCollapsed] = useState(new Set());
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [deleteTarget, setDeleteTarget] = useState(null);
  const [openingDirectory, setOpeningDirectory] = useState('');
  const context = useEditorContextMenu();
  const [inspectorWidth, setInspectorWidth] = useState(560);
  const draftsRef = useRef({}), baselinesRef = useRef({}), buffersRef = useRef({}), pendingRef = useRef({}), pendingPresetRef = useRef(null);
  const savingRef = useRef(false), dirtyRef = useRef(false), saveTaskRef = useRef(null), loadContextRef = useRef(null);
  const runtime = useSyncExternalStore(scriptRuntimeConnection?.subscribe || noopSubscribe, scriptRuntimeConnection?.getSnapshot || noRuntime);
  const runtimeState = useSyncExternalStore(runtime?.subscribe || noopSubscribe, runtime?.getSnapshot || emptySnapshot);
  const dirty = !same(drafts, baselines) || Object.keys(buffers).length > 0;
  dirtyRef.current = dirty;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (notice !== 'saved') return undefined;
    const timer = window.setTimeout(() => setNotice(''), 1600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let active = true, generation = 0, selectedPreset = null;
    draftsRef.current = {}; baselinesRef.current = {}; buffersRef.current = {}; pendingRef.current = {}; pendingPresetRef.current = null;
    dirtyRef.current = false;
    setDrafts({}); setBaselines({}); setBuffers({}); setPreset(null); setSelection(null); setError(''); setNotice(''); context.close(); setDeleteTarget(null);
    function accept(library) {
      if (!active || savingRef.current) return;
      const key = libraryKey(library.scope, library.ownerId);
      if (library.scope === 'preset' && selectedPreset?.id !== library.ownerId) return;
      if (dirtyRef.current) {
        if (baselinesRef.current[key]?.revision !== library.revision) {
          pendingRef.current[key] = library;
          setError('脚本配置已在其他窗口或 SDK 中修改，请放弃本页修改后载入最新内容。');
        }
        return;
      }
      draftsRef.current = { ...draftsRef.current, [key]: library };
      baselinesRef.current = { ...baselinesRef.current, [key]: library };
      setDrafts(draftsRef.current); setBaselines(baselinesRef.current);
    }
    async function loadContext() {
      const currentGeneration = ++generation;
      try {
        const nextPreset = await scriptLibraries.activePreset();
        if (!active || currentGeneration !== generation) return;
        if (selectedPreset && selectedPreset.id !== nextPreset.id && dirtyRef.current) {
          pendingPresetRef.current = nextPreset;
          setError('当前预设已切换，请先放弃本页修改，再载入当前预设脚本。');
          return;
        }
        if (selectedPreset?.id !== nextPreset.id) {
          const next = Object.fromEntries(Object.entries(draftsRef.current).filter(([, value]) => value.scope !== 'preset'));
          draftsRef.current = next; baselinesRef.current = next;
          setDrafts(next); setBaselines(next);
          setSelection(current => current?.key === libraryKey('preset', selectedPreset?.id) ? null : current);
        }
        selectedPreset = nextPreset; setPreset(nextPreset);
        const values = await Promise.all([scriptLibraries.read('global', ''), scriptLibraries.read('character', characterId), scriptLibraries.read('preset', nextPreset.id)]);
        if (!active || currentGeneration !== generation) return;
        values.forEach(accept);
      } catch (cause) { if (active && currentGeneration === generation) setError(cause?.message || '读取脚本库失败。'); }
    }
    loadContextRef.current = loadContext;
    const stop = scriptLibraries.subscribe((scope, ownerId, snapshot) => {
      if (scope === 'character' && ownerId !== characterId || scope === 'preset' && ownerId !== selectedPreset?.id) return;
      if (snapshot.status === 'ready') accept(snapshot.value);
      else if (active && snapshot.status === 'error') setError(snapshot.error);
    });
    const stopContext = scriptLibraries.subscribeChanges(() => { void loadContext(); });
    void loadContext();
    return () => { active = false; generation++; stop(); stopContext(); loadContextRef.current = null; };
  }, [characterId, scriptLibraries]);

  function change(key, update) {
    if (savingRef.current) return;
    const library = draftsRef.current[key];
    if (!library) return;
    const next = typeof update === 'function' ? update(library) : { ...library, ...update };
    draftsRef.current = { ...draftsRef.current, [key]: next };
    dirtyRef.current = true;
    setDrafts(draftsRef.current); setNotice('');
    if (!Object.keys(pendingRef.current).length && !pendingPresetRef.current) setError('');
  }
  function changeBuffer(address, text) {
    if (savingRef.current) return;
    buffersRef.current = { ...buffersRef.current, [address]: text };
    dirtyRef.current = true;
    setBuffers(buffersRef.current); setNotice('');
  }
  const save = useCallback(async () => {
    if (saveTaskRef.current) return saveTaskRef.current;
    const task = (async () => {
      savingRef.current = true; setSaving(true); setNotice('');
      try {
        if (Object.keys(pendingRef.current).length || pendingPresetRef.current) throw new Error('脚本配置或当前预设已更新，请放弃本页修改后载入最新内容。');
        const values = Object.values(draftsRef.current).map(library => materializeScriptBuffers(library, buffersRef.current));
        if (values.length !== 3) throw new Error('脚本库尚未完整载入。');
        const modified = values.filter(library => !same(library, baselinesRef.current[libraryKey(library.scope, library.ownerId)]));
        const saved = await scriptLibraries.saveAll(modified);
        const next = { ...draftsRef.current };
        for (const library of saved) next[libraryKey(library.scope, library.ownerId)] = library;
        draftsRef.current = next; baselinesRef.current = next; buffersRef.current = {}; dirtyRef.current = false;
        setDrafts(next); setBaselines(next); setBuffers({}); setError(''); setNotice('saved');
        return true;
      } catch (cause) { setError(cause?.message || '保存脚本库失败。'); return false; }
      finally { savingRef.current = false; setSaving(false); }
    })();
    saveTaskRef.current = task;
    try { return await task; } finally { if (saveTaskRef.current === task) saveTaskRef.current = null; }
  }, [scriptLibraries]);
  const discard = useCallback(() => {
    if (savingRef.current) return;
    const next = { ...baselinesRef.current, ...pendingRef.current };
    draftsRef.current = next; baselinesRef.current = next; buffersRef.current = {}; pendingRef.current = {}; pendingPresetRef.current = null; dirtyRef.current = false;
    setDrafts(next); setBaselines(next); setBuffers({}); setError(''); setNotice('');
    void loadContextRef.current?.();
  }, []);
  useImperativeHandle(ref, () => ({ save, discard }), [save, discard]);
  useEffect(() => {
    const keydown = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (dirtyRef.current && !savingRef.current) void save(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [save]);

  const groups = useMemo(() => [{ scope: 'global', ownerId: '', label: '全局脚本' }, { scope: 'character', ownerId: characterId, label: '角色脚本' },
    { scope: 'preset', ownerId: preset?.id || '', label: '预设脚本', name: preset?.name || '' }], [characterId, preset]);
  async function openDirectory(group) {
    if (openingDirectory) return;
    setOpeningDirectory(group.scope);
    try { await scriptLibraries.openDirectory(group.scope, group.ownerId); }
    catch (cause) { setError(cause?.message || '打开脚本目录失败。'); }
    finally { setOpeningDirectory(''); }
  }
  const selectedLibrary = selection ? drafts[selection.key] : null;
  const selectedItem = selectedLibrary && selection.id ? findScriptItem(selectedLibrary, selection.id) : null;
  const selectedLabel = groups.find(group => libraryKey(group.scope, group.ownerId) === selection?.key)?.label || '';
  const selectedExecution = selectedItem ? runtimeState.scriptStatuses?.[JSON.stringify([selectedLibrary.scope, selectedLibrary.ownerId, selectedItem.id])] : null;
  function create(key, type) {
    const item = createScriptItem(type, crypto.randomUUID());
    change(key, library => ({ ...library, trees: [...library.trees, item] }));
    setSelection({ key, id: item.id });
  }
  function duplicate(target = selection) {
    try {
      const library = materializeScriptBuffers(draftsRef.current[target.key], buffersRef.current), source = findScriptItem(library, target.id);
      const item = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name || '脚本'} 副本` };
      if (item.type === 'folder') item.scripts = item.scripts.map(script => ({ ...script, id: crypto.randomUUID() }));
      change(target.key, value => ({ ...value, trees: [...value.trees, item] }));
      setSelection({ key: target.key, id: item.id });
    } catch (cause) { setError(cause.message); }
  }
  function deleteItem() {
    const item = findScriptItem(draftsRef.current[deleteTarget.key], deleteTarget.id);
    const ids = new Set([deleteTarget.id, ...(item?.type === 'folder' ? item.scripts.map(item => item.id) : [])]);
    change(deleteTarget.key, library => removeScriptItem(library, deleteTarget.id));
    buffersRef.current = Object.fromEntries(Object.entries(buffersRef.current).filter(([key]) => {
      const [owner, id] = JSON.parse(key); return owner !== deleteTarget.key || !ids.has(id);
    }));
    setBuffers(buffersRef.current);
    setSelection(current => current?.key === deleteTarget.key && ids.has(current.id) ? null : current);
    setDeleteTarget(null);
  }
  function status(library, script, parentEnabled = true) {
    const key = libraryKey(library.scope, library.ownerId), persisted = baselines[key], original = persisted && findScriptItem(persisted, script.id);
    const parent = library.trees.find(tree => tree.type === 'folder' && tree.scripts.some(item => item.id === script.id));
    const previousParent = persisted?.trees.find(tree => tree.type === 'folder' && tree.scripts.some(item => item.id === script.id));
    if (!same(script, original) || library.enabled !== persisted?.enabled || parent?.enabled !== previousParent?.enabled) return '未保存';
    if (!library.enabled || !script.enabled || !parentEnabled) return '已停用';
    const execution = runtimeState.scriptStatuses?.[JSON.stringify([library.scope, library.ownerId, script.id])];
    if (execution?.scope === library.scope && execution.ownerId === library.ownerId && execution.source === script.content) {
      return { running: '运行中', starting: '启动中', error: '运行错误' }[execution.status] || '未启动';
    }
    return runtime ? '未启动' : '运行环境未就绪';
  }
  const inspector = selectedLibrary && (selectedItem || !selection.id) ? <ScriptInspector library={selectedLibrary} item={selectedItem} groupLabel={selectedLabel}
    busy={saving} buffers={buffers} onBuffer={changeBuffer} onClose={() => setSelection(null)} execution={selectedExecution?.scope === selectedLibrary.scope && selectedExecution.ownerId === selectedLibrary.ownerId && selectedExecution.source === selectedItem?.content ? selectedExecution : null}
    onChange={patch => change(selection.key, library => updateScriptItem(library, selection.id, patch))}
    onMove={(folderId, direction) => change(selection.key, library => moveScriptItem(library, selection.id, folderId, direction))}
    onDuplicate={() => duplicate()} onDelete={() => setDeleteTarget({ key: selection.key, id: selectedItem.id, name: selectedItem.name, folder: selectedItem.type === 'folder' })} /> : null;
  const menuItem = context.menu && drafts[context.menu.target.key] && findScriptItem(drafts[context.menu.target.key], context.menu.target.id);
  const menuActions = menuItem ? [
    { label: '编辑', icon: PencilSimple, run: () => setSelection(context.menu.target) },
    { label: '复制', icon: Copy, run: () => duplicate(context.menu.target) },
    { label: '上移', icon: ArrowUp, run: () => change(context.menu.target.key, library => moveScriptItem(library, menuItem.id, undefined, -1)) },
    { label: '下移', icon: ArrowDown, run: () => change(context.menu.target.key, library => moveScriptItem(library, menuItem.id, undefined, 1)) },
    { label: menuItem.enabled ? '停用' : '启用', icon: Power, run: () => change(context.menu.target.key, library => updateScriptItem(library, menuItem.id, { enabled: !menuItem.enabled })) },
    { label: '删除', icon: Trash, danger: true, run: () => setDeleteTarget({ ...context.menu.target, name: menuItem.name, folder: menuItem.type === 'folder' }) },
  ].map(action => ({ ...action, disabled: saving })) : [];
  return <EditorSidebarLayout className="script-libraries-panel" inspector={inspector} inspectorTitle={selectedItem?.name || selectedLabel}
    onCloseInspector={() => setSelection(null)} preferredWidth={inspectorWidth} onWidthChange={setInspectorWidth}
    feedback={<SaveControl dirty={dirty} saving={saving} error={error} notice={notice} onSave={save} />}>
    <div className="script-directory editor-sidebar-directory">
      <header className="script-toolbar"><div>
        <Tool label="重新载入" Icon={ArrowClockwise} disabled={dirty || saving} onClick={() => { setError(''); void loadContextRef.current?.(); }} />
        <button type="button" disabled={!dirty || saving} onClick={discard}>放弃修改</button>
      </div><SaveControl dirty={dirty} saving={saving} error={error} notice={notice} onSave={save} /></header>
      {error && <p className="script-panel-error" role="alert">{error}</p>}
      {runtimeState.error && <p className="script-panel-error" role="alert">{runtimeState.error}</p>}
      <div className="script-groups">{groups.map(group => {
        const key = libraryKey(group.scope, group.ownerId), library = drafts[key];
        const scriptRow = (item, enabled = true, nested = false) => <div className={`script-list-row${nested ? ' is-nested' : ''}${selection?.key === key && selection.id === item.id ? ' is-selected' : ''}`} key={item.id}
          onContextMenu={event => context.open(event, { key, id: item.id })}>
          <button type="button" className="script-list-name" onClick={() => setSelection({ key, id: item.id })}><FileCode size={18} aria-hidden="true" /><span>{item.name || '未命名脚本'}</span></button>
          <span className="script-state" title={status(library, item, enabled)}>{status(library, item, enabled)}</span>
          <Switch label={`启用 ${item.name || '脚本'}`} checked={item.enabled} disabled={saving} onChange={enabled => change(key, value => updateScriptItem(value, item.id, { enabled }))} />
        </div>;
        return <section className="script-group" key={group.scope} aria-label={group.label}>
          <header><button className="script-group-title" type="button" disabled={!library} onClick={() => setSelection({ key, id: '' })}><strong>{group.label}</strong>{group.name && <span title={group.name}>{group.name}</span>}</button>
            <Tool label={`打开${group.label}目录`} Icon={FolderSimple} disabled={Boolean(openingDirectory) || saving || group.scope === 'preset' && !group.ownerId} onClick={() => void openDirectory(group)} />
            <Tool label={`新增${group.label}`} Icon={Plus} disabled={!library || saving} onClick={() => create(key, 'script')} />
            <Switch label={`启用${group.label}`} checked={library?.enabled || false} disabled={!library || saving} onChange={enabled => change(key, { enabled })} />
          </header>
          {!library ? <p role="status">{error ? '读取失败' : '加载中'}</p> : !library.trees.length ? <p>暂无脚本</p> : library.trees.map(tree => tree.type === 'script' ? scriptRow(tree) : <div key={tree.id} className="script-folder">
            <div className={`script-list-row${selection?.key === key && selection.id === tree.id ? ' is-selected' : ''}`} onContextMenu={event => context.open(event, { key, id: tree.id })}>
              <button type="button" className={`script-tool script-folder-toggle${collapsed.has(tree.id) ? ' is-collapsed' : ''}`} aria-label={`${collapsed.has(tree.id) ? '展开' : '收起'} ${tree.name || '分组'}`} aria-expanded={!collapsed.has(tree.id)} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(tree.id)) next.delete(tree.id); else next.add(tree.id); return next; })}><CaretDown size={16} aria-hidden="true" /></button>
              <button type="button" className="script-list-name" onClick={() => setSelection({ key, id: tree.id })}><FolderSimple size={18} aria-hidden="true" /><span>{tree.name || '未命名分组'}</span></button>
              <Switch label={`启用分组 ${tree.name}`} checked={tree.enabled} disabled={saving} onChange={enabled => change(key, value => updateScriptItem(value, tree.id, { enabled }))} />
            </div>{!collapsed.has(tree.id) && tree.scripts.map(item => scriptRow(item, tree.enabled, true))}
          </div>)}
        </section>;
      })}</div>
    </div>
    {menuItem && <EditorContextMenu menu={context.menu} actions={menuActions} label="脚本操作" onClose={context.close} />}
    <ConfirmationDialog open={Boolean(deleteTarget)} title={`删除“${deleteTarget?.name || '脚本'}”？`}
      description={deleteTarget?.folder ? '分组及其中的脚本会在保存后删除。' : '脚本会在保存后删除。'} confirmLabel="删除" destructive busy={saving} onCancel={() => setDeleteTarget(null)} onConfirm={deleteItem} />
  </EditorSidebarLayout>;
});
