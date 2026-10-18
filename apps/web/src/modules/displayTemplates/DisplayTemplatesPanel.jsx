import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Browse, Copy, NotePencil, Play, Plus, Power, Trash, X } from '../../ui/icons/interfaceIcons.jsx';
import { EditorContextMenu, useEditorContextMenu } from '../../ui/ui/EditorContextMenu.jsx';
import { EditorSidebarLayout } from '../../ui/ui/EditorSidebarLayout.jsx';
import { useEditorPresentation } from '../../ui/ui/EditorPresentationContext.jsx';
import { MobileEditorActions } from '../../ui/ui/MobileEditorActions.jsx';
import { EditorLibraryGroup } from '../../ui/ui/EditorLibraryGroup.jsx';
import { ConfirmationDialog } from '../../ui/ui/ConfirmationDialog.jsx';
import { EditorCollectionSurface, EditorCollectionToolbar, EditorManagementModal, EditorSelectionBar, EditorSelectionCheckbox, useEditorMultiSelect } from '../../ui/ui/EditorCollectionControls.jsx';
import { EditorLibraryVersionManager } from '../../ui/ui/EditorLibraryVersionManager.jsx';
import { useEditorLibraryVersions } from '../../ui/hooks/useEditorLibraryVersions.js';
import { MarkdownTextareaField, SaveControl } from '../settingLibraries/index.js';
import { resolveFailure } from '../../utils/failureText.js';
import { displayTemplateLibrarySchema } from '@shared/contracts/displayTemplates/schemas';
import { runDisplayTemplates } from './runtime/runDisplayTemplates.js';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import '../scripts/styles/script-libraries.css';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export function newDisplayTemplate(id) {
  return { id, name: '新显示模板', enabled: false, position: 'after', pattern: '', flags: '',
    source: '' };
}

export const DisplayTemplatesPanel = forwardRef(function DisplayTemplatesPanel({ scope, ownerId, displayTemplates, onDirtyChange }, ref) {
  const { compact } = useEditorPresentation();
  const context = useEditorContextMenu();
  const [drafts, setDrafts] = useState({}), [baselines, setBaselines] = useState({}), [selectedId, setSelectedId] = useState('');
  const [selectedScope, setSelectedScope] = useState(scope), [query, setQuery] = useState(''), [managerOpen, setManagerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false), [deleteTarget, setDeleteTarget] = useState(null);
  const [testOpen, setTestOpen] = useState(false), [testText, setTestText] = useState(''), [testVariables, setTestVariables] = useState('{}');
  const [testOutput, setTestOutput] = useState(''), [testError, setTestError] = useState(''), [testing, setTesting] = useState(false);
  const draftRef = useRef({}), baselineRef = useRef({}), pendingRef = useRef({}), busyRef = useRef(false), testRef = useRef(null), dirtyRef = useRef(false);
  const receivedRef = useRef({}), acceptRef = useRef(null), nameRef = useRef(null);
  const versions = useEditorLibraryVersions({ kind: 'displayTemplates', scope, ownerId, service: displayTemplates?.versions,
    editorDirty: () => dirtyRef.current,
    capture: libraryScope => { const library = draftRef.current[libraryScope]; if (!library) throw new DesktopError(ELECKOI_FAILURE_CODES.lifecycleNotReady, '显示模板库尚未载入。', { what: '显示模板库' }); return { enabled: library.enabled, templates: library.templates }; },
    apply: (libraryScope, content) => { change(current => ({ ...current, ...content }), libraryScope); setSelectedId(''); },
  });
  const dirty = !same(drafts, baselines) || versions.dirty;
  dirtyRef.current = dirty;
  const entries = ['global', scope].flatMap(libraryScope => (drafts[libraryScope]?.templates || []).map(template => ({ libraryScope, template, key: JSON.stringify([libraryScope, template.id]) })));
  const selection = useEditorMultiSelect(entries.map(entry => entry.key), JSON.stringify([scope, ownerId]));
  const visible = entries.filter(entry => !query.trim() || entry.template.name.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => { context.close(); }, [scope, ownerId, saving, selection.active]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => { testRef.current?.abort(); setTesting(false); setTestOutput(''); setTestError(''); setTestOpen(false); }, [selectedScope, selectedId]);
  useEffect(() => {
    let active = true;
    draftRef.current = {}; baselineRef.current = {}; pendingRef.current = {}; receivedRef.current = {};
    setDrafts({}); setBaselines({}); setSelectedScope(scope); setSelectedId(''); setEditing(false); setError(''); setNotice(''); setManagerOpen(false); setQuery('');
    if (!displayTemplates) { setError('显示模板服务尚未就绪。'); return undefined; }
    const accept = library => {
      if (!active || library.revision < (baselineRef.current[library.scope]?.revision ?? 0)) return;
      if (busyRef.current) { receivedRef.current[library.scope] = library; return; }
      if (dirtyRef.current) {
        if (library.revision !== baselineRef.current[library.scope]?.revision) { pendingRef.current[library.scope] = library; setError('显示模板已在其他窗口更新，请退出并放弃未保存修改后载入最新内容。'); }
        return;
      }
      draftRef.current = { ...draftRef.current, [library.scope]: library }; baselineRef.current = { ...baselineRef.current, [library.scope]: library };
      setDrafts(draftRef.current); setBaselines(baselineRef.current);
    };
    acceptRef.current = accept;
    const stop = displayTemplates.subscribe((changedScope, changedOwner, snapshot) => {
      if (!active || !(changedScope === 'global' && changedOwner === '' || changedScope === scope && changedOwner === ownerId)) return;
      if (snapshot.status === 'ready') accept(snapshot.value);
      if (snapshot.status === 'error') setError(snapshot.error);
    });
    void Promise.all([displayTemplates.read('global', ''), displayTemplates.read(scope, ownerId)]).then(values => values.forEach(accept)).catch(cause => active && setError(resolveFailure(cause, { fallback: '读取显示模板失败' }).text));
    return () => { active = false; stop(); testRef.current?.abort(); };
  }, [scope, ownerId, displayTemplates]);
  function change(update, libraryScope = selectedScope) {
    if (busyRef.current) return;
    const next = typeof update === 'function' ? update(draftRef.current[libraryScope]) : update;
    draftRef.current = { ...draftRef.current, [libraryScope]: next }; setDrafts(draftRef.current); setNotice('');
    if (!Object.keys(pendingRef.current).length) setError('');
  }
  const save = useCallback(async () => {
    if (busyRef.current || Object.keys(draftRef.current).length !== 2) return false;
    busyRef.current = true; setSaving(true);
    try {
      if (Object.keys(pendingRef.current).length) throw new DesktopError(ELECKOI_FAILURE_CODES.statePrecondition, '显示模板存在其他修改，请退出并放弃未保存修改后重新载入。', { what: '放弃未保存的修改并重新载入显示模板' });
      const versionDrafts = versions.prepare();
      const values = Object.values(draftRef.current).map(library => displayTemplateLibrarySchema.parse(library))
        .filter(library => versionDrafts.some(version => version.scope === library.scope));
      if (!values.length) return true;
      const result = await displayTemplates.versions.save(values, versionDrafts);
      const next = { ...draftRef.current, ...Object.fromEntries(result.documents.map(library => [library.scope, library])) };
      draftRef.current = next; baselineRef.current = next; setDrafts(next); setBaselines(next); versions.acceptSaved(result.versions);
      dirtyRef.current = false; setError(''); setNotice('saved'); return true;
    } catch (cause) { setError(resolveFailure(cause, { fallback: '保存显示模板失败' }).text); return false; }
    finally {
      busyRef.current = false; setSaving(false);
      const received = Object.values(receivedRef.current); receivedRef.current = {};
      received.forEach(library => acceptRef.current?.(library));
    }
  }, [displayTemplates, versions]);
  const discard = useCallback(() => {
    if (busyRef.current) return;
    const latest = { ...baselineRef.current, ...pendingRef.current };
    draftRef.current = latest; baselineRef.current = latest; pendingRef.current = {}; dirtyRef.current = false;
    setDrafts(latest); setBaselines(latest); setError(''); setNotice(''); versions.discard(); selection.clear();
  }, [versions, selection]);
  useImperativeHandle(ref, () => ({ save, discard }), [save, discard]);
  const draft = drafts[selectedScope], selected = draft?.templates.find(template => template.id === selectedId);
  const selectedEntry = entries.find(entry => entry.libraryScope === selectedScope && entry.template.id === selectedId);
  function closeEditor() { if (compact) setEditing(false); else setSelectedId(''); }
  function patch(changes) { change(current => ({ ...current, templates: current.templates.map(template => template.id === selectedId ? { ...template, ...changes } : template) })); }
  function uniqueName(library, base) { let name = base, suffix = 1; while (library.templates.some(template => template.name === name)) name = `${base} ${++suffix}`; return name; }
  function create(libraryScope) {
    const library = draftRef.current[libraryScope]; if (!library) return;
    const item = { ...newDisplayTemplate(crypto.randomUUID()), name: uniqueName(library, '新显示模板') };
    change({ ...library, templates: [...library.templates, item] }, libraryScope); setSelectedScope(libraryScope); setSelectedId(item.id); setEditing(true);
  }
  function duplicate(entriesToCopy) {
    for (const entry of entriesToCopy) change(current => ({ ...current, templates: [...current.templates,
      { ...entry.template, id: crypto.randomUUID(), name: uniqueName(current, `${entry.template.name} 副本`), enabled: false }] }), entry.libraryScope);
    selection.clear();
  }
  function remove() {
    const keys = new Set(deleteTarget.keys);
    for (const libraryScope of ['global', scope]) change(current => ({ ...current,
      templates: current.templates.filter(template => !keys.has(JSON.stringify([libraryScope, template.id]))) }), libraryScope);
    setSelectedId(''); setDeleteTarget(null); selection.clear();
  }
  function move(offset, entry) {
    const libraryScope = entry?.libraryScope || selectedScope, library = draftRef.current[libraryScope];
    const index = library.templates.findIndex(template => template.id === (entry?.template.id || selectedId)), next = index + offset;
    if (index < 0 || next < 0 || next >= library.templates.length) return;
    const templates = [...library.templates]; [templates[index], templates[next]] = [templates[next], templates[index]]; change({ ...library, templates }, libraryScope);
  }
  async function test() {
    testRef.current?.abort(); const controller = new AbortController(); testRef.current = controller; setTesting(true); setTestError(''); setTestOutput('');
    try {
      const variables = JSON.parse(testVariables);
      if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '测试变量必须是 JSON 对象。', { field: 'testVariables' });
      const library = displayTemplateLibrarySchema.parse({ ...draft, enabled: true, templates: [{ ...selected, enabled: true }] });
      const result = await runDisplayTemplates({ libraries: [library], content: testText, variables,
        message: { id: 'preview', conversationId: '', role: 'assistant', status: 'complete', content: testText } }, { signal: controller.signal });
      if (!controller.signal.aborted) { setTestOutput(result.content); setTestError(result.errors.map(item => item.message).join('\n')); }
    } catch (cause) { if (!controller.signal.aborted) setTestError(resolveFailure(cause, { fallback: '测试显示模板失败' }).text); }
    finally { if (!controller.signal.aborted) setTesting(false); }
  }
  const labelFor = libraryScope => libraryScope === 'global' ? '全局显示模板' : libraryScope === 'preset' ? '预设显示模板' : '角色显示模板';
  function entryActions(entry) {
    const library = drafts[entry.libraryScope];
    return [
      { label: '重命名', Icon: NotePencil, run: () => { setSelectedScope(entry.libraryScope); setSelectedId(entry.template.id); setEditing(true); requestAnimationFrame(() => nameRef.current?.select()); } },
      { label: '复制', Icon: Copy, run: () => duplicate([entry]) },
      { label: '上移', Icon: ArrowUp, disabled: library.templates[0]?.id === entry.template.id, run: () => move(-1, entry) },
      { label: '下移', Icon: ArrowDown, disabled: library.templates.at(-1)?.id === entry.template.id, run: () => move(1, entry) },
      { label: entry.template.enabled ? '停用' : '启用', Icon: Power, run: () => change(current => ({ ...current, templates: current.templates.map(template => template.id === entry.template.id ? { ...template, enabled: !template.enabled } : template) }), entry.libraryScope) },
      { label: '删除', Icon: Trash, danger: true, run: () => setDeleteTarget({ keys: [entry.key], name: entry.template.name }) },
    ];
  }
  function openContext(event, target) {
    event.preventDefault(); event.stopPropagation();
    if (!selection.active) context.open(event, target);
  }
  const contextEntry = context.menu?.target.key && entries.find(entry => entry.key === context.menu.target.key);
  const menuActions = context.menu?.target.key ? contextEntry ? entryActions(contextEntry) : []
    : ['global', scope]
      .map(libraryScope => ({ label: `新建${labelFor(libraryScope)}`, Icon: Plus, disabled: !drafts[libraryScope], run: () => create(libraryScope) }));
  const inspector = selected && !selection.active && (!compact || editing) ? <aside className="script-inspector"><header><strong>{selected.name}</strong>
    <button type="button" className="script-tool" aria-label="关闭编辑器" onClick={closeEditor}><X size={18} /></button></header>
    <div className="script-inspector-fields"><label className="script-field"><span>名称</span><input ref={nameRef} value={selected.name} disabled={saving} onChange={event => patch({ name: event.target.value })} /></label>
      <label className="script-field"><span>AI 消息显示方式</span><select value={selected.position} disabled={saving} onChange={event => patch({ position: event.target.value })}>
        <option value="before">AI 消息开头</option><option value="after">AI 消息末尾</option><option value="replace">替换 AI 消息片段</option></select></label>
      {selected.position === 'replace' && <><label className="script-field"><span>匹配表达式</span><input value={selected.pattern} disabled={saving} onChange={event => patch({ pattern: event.target.value })} /></label>
        <label className="script-field"><span>正则标志</span><input value={selected.flags} disabled={saving} onChange={event => patch({ flags: event.target.value })} /></label></>}
      <MarkdownTextareaField key={selected.id} label="EJS 模板" value={selected.source} disabled={saving} preview={false} code textareaClassName="script-source" onChange={source => patch({ source })}
        labelAction={<button type="button" aria-label="测试显示模板" disabled={saving} onClick={() => setTestOpen(true)}><Play size={14} />测试</button>} />
    </div></aside> : null;
  const feedback = <SaveControl dirty={dirty} saving={saving} error={error || versions.error} notice={notice} onSave={save} />;
  const createItems = ['global', scope].map(libraryScope => ({ label: labelFor(libraryScope), disabled: !drafts[libraryScope] || !versions.ready, run: () => create(libraryScope) }));
  return <EditorSidebarLayout className={`script-libraries-panel display-templates-panel${selection.active ? ' is-multiselect' : ''}`} inspector={inspector}
    inspectorTitle={selected?.name}
    onCloseInspector={closeEditor} feedback={feedback}>
    <div className="editor-collection-browser editor-collection-material editor-collection-continuous"><EditorCollectionToolbar query={query} onQueryChange={setQuery} placeholder="搜索显示模板" selection={{ ...selection, toggle: () => { selection.toggle(); setEditing(false); } }}
      disabled={saving || !versions.ready || Object.keys(drafts).length !== 2} createItems={createItems}
      onManage={() => setManagerOpen(true)} save={feedback} />
      <EditorSelectionBar selection={selection} visibleIds={visible.map(entry => entry.key)} disabled={saving}
        onCopy={() => duplicate(entries.filter(entry => selection.selected.has(entry.key)))} onDelete={() => setDeleteTarget({ keys: [...selection.selected], name: `选中的 ${selection.selected.size} 个显示模板` })} />
      <div className="editor-collection-directory editor-sidebar-directory" onContextMenu={event => openContext(event, {})}
        onMouseDown={event => { if (!selection.active && !event.target.closest('.editor-library-row')) setSelectedId(''); }}><EditorCollectionSurface grouped>{['global', scope].map(libraryScope => {
        const library = drafts[libraryScope]; return <EditorLibraryGroup key={libraryScope} title={labelFor(libraryScope)}
          onContextMenu={event => openContext(event, { libraryScope })}
          actions={!selection.active && library && <label className="script-switch"><input type="checkbox" aria-label={`启用${labelFor(libraryScope)}`} checked={library.enabled} disabled={saving} onChange={event => {
            const enabled = event.target.checked;
            change(current => ({ ...current, enabled, templates: current.templates.map(template => ({ ...template, enabled })) }), libraryScope);
          }} /><i /></label>}>
          {!library ? <p className="editor-library-empty" role="status">正在读取…</p> : visible.filter(entry => entry.libraryScope === libraryScope).map(entry => <div key={entry.key}
            className={`editor-library-row${selection.active ? selection.selected.has(entry.key) ? ' is-selected' : '' : selectedScope === libraryScope && selectedId === entry.template.id ? ' is-selected' : ''}`}
            data-enabled={library.enabled && entry.template.enabled} onContextMenu={event => openContext(event, { key: entry.key })}>
            <EditorSelectionCheckbox selection={selection} id={entry.key} label={entry.template.name} disabled={saving} />
            <button type="button" className="editor-library-name"
              onDoubleClick={compact && !selection.active && !saving ? () => { setSelectedScope(libraryScope); setSelectedId(entry.template.id); setEditing(true); } : undefined}
              onClick={() => { if (selection.active) selection.check(entry.key, !selection.selected.has(entry.key)); else { setSelectedScope(libraryScope); setSelectedId(entry.template.id); if (compact) setEditing(false); } }}><Browse size={18} /><span>{entry.template.name}</span></button>
            {!selection.active && <label className="script-switch"><input type="checkbox" aria-label={`启用${entry.template.name}`} checked={entry.template.enabled} disabled={saving}
              onChange={event => change(current => ({ ...current, templates: current.templates.map(template => template.id === entry.template.id ? { ...template, enabled: event.target.checked } : template) }), libraryScope)} /><i /></label>}
          </div>)}{library && !visible.some(entry => entry.libraryScope === libraryScope) && <p className="editor-library-empty">{query ? '没有匹配的模板' : '暂无模板'}</p>}</EditorLibraryGroup>;
      })}</EditorCollectionSurface></div>
      {compact && !selection.active && <MobileEditorActions label="显示模板操作" selectionId={selectedEntry?.key || ''} busy={saving} createItems={createItems}
        canEdit={Boolean(selected)} canModify={Boolean(selected)} onEdit={() => setEditing(true)}
        moveItems={[
          { label: '上移', Icon: ArrowUp, disabled: draft?.templates[0]?.id === selectedId, run: () => move(-1) },
          { label: '下移', Icon: ArrowDown, disabled: draft?.templates.at(-1)?.id === selectedId, run: () => move(1) },
        ]} onDelete={() => setDeleteTarget({ keys: [selectedEntry.key], name: selected.name })}
        moreItems={selectedEntry ? [
          { label: '复制', Icon: Copy, run: () => duplicate([selectedEntry]) },
          { label: '重命名', Icon: NotePencil, run: () => { setEditing(true); requestAnimationFrame(() => nameRef.current?.select()); } },
          { label: '测试模板', Icon: Browse, run: () => setTestOpen(true) },
        ] : []} />}
    </div>
    {managerOpen && versions.ready && <EditorLibraryVersionManager title="显示模板版本管理" versions={versions} ownerScope={scope} ownerLabel={scope === 'preset' ? '预设' : '角色卡'} busy={saving} onClose={() => setManagerOpen(false)} />}
    {context.menu && menuActions.length > 0 && <EditorContextMenu menu={context.menu} label="显示模板操作" onClose={context.close}
      actions={menuActions.map(({ Icon, ...action }) => ({ ...action, icon: Icon, disabled: action.disabled || saving || !versions.ready }))} />}
    {testOpen && selected && <EditorManagementModal title="测试显示模板" onClose={() => { testRef.current?.abort(); setTesting(false); setTestOpen(false); }}
      footer={<Button variant="primary" icon={<Play size={16} />} disabled={testing} onClick={test}>{testing ? '计算中…' : '测试模板'}</Button>}>
      <div className="script-inspector-fields"><label className="script-field"><span>测试 AI 消息</span><textarea value={testText} onChange={event => setTestText(event.target.value)} /></label>
        <label className="script-field"><span>测试变量 JSON</span><textarea value={testVariables} onChange={event => setTestVariables(event.target.value)} /></label>
        <label className="script-field"><span>计算结果</span><textarea value={testOutput} readOnly /></label>
        {testError && <p className="script-execution-error" role="alert">{testError}</p>}</div>
    </EditorManagementModal>}
    <ConfirmationDialog open={Boolean(deleteTarget)} title="删除显示模板" description={`删除“${deleteTarget?.name || ''}”？保存后生效。`} confirmLabel="删除" destructive onCancel={() => setDeleteTarget(null)} onConfirm={remove} />
  </EditorSidebarLayout>;
});
