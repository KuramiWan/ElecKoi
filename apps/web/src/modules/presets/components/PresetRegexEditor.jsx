import { useMemo, useState } from 'react';
import { Copy, FileCode, MagnifyingGlass, NotePencil, Plus } from '../../../ui/icons/interfaceIcons.jsx';
import { TrashIcon } from '../../../ui/icons/index.jsx';
import { RegexRuleInspector, newRegexId, moveRegexRule } from '../../regex/index.js';
import { PresetContextMenu, usePresetContextMenu } from './PresetContextMenu.jsx';
import { EditorSidebarLayout } from '../../../ui/ui/EditorSidebarLayout.jsx';
import { useEditorPresentation } from '../../../ui/ui/EditorPresentationContext.jsx';
import { MobileEditorActions } from '../../../ui/ui/MobileEditorActions.jsx';

export function PresetRegexEditor({ preset, onChange, saveAction, onTest }) {
  const { compact } = useEditorPresentation();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const context = usePresetContextMenu();
  const visible = useMemo(() => {
    const key = query.trim().toLocaleLowerCase();
    return preset.regexRules.filter((rule) => !key || `${rule.name} ${rule.pattern} ${rule.replacement}`.toLocaleLowerCase().includes(key));
  }, [preset.regexRules, query]);
  const selected = preset.regexRules.find((rule) => rule.id === selectedId);

  function addRule() {
    const rule = {
      id: newRegexId(), name: '未命名规则', pattern: '', replacement: '', targets: ['AiOutput'],
      enabled: true, displayOnly: false, promptOnly: false, runOnEdit: false, order: 0,
    };
    onChange({ ...preset, regexRules: [rule, ...preset.regexRules].map((item, order) => ({ ...item, order })) });
    setSelectedId(rule.id);
    setEditing(true);
    setQuery('');
  }

  function updateRule(patch) {
    onChange({ ...preset, regexRules: preset.regexRules.map((rule) => rule.id === selectedId ? { ...rule, ...patch } : rule) });
  }

  function deleteRule(id) {
    onChange({ ...preset, regexRules: preset.regexRules.filter((rule) => rule.id !== id).map((rule, order) => ({ ...rule, order })) });
    if (selectedId === id) setSelectedId('');
  }

  function duplicateRule(rule) {
    const copy = { ...rule, id: newRegexId(), name: `${rule.name || '未命名规则'} 副本` };
    const index = preset.regexRules.findIndex((item) => item.id === rule.id);
    const rules = [...preset.regexRules];
    rules.splice(index + 1, 0, copy);
    onChange({ ...preset, regexRules: rules.map((item, order) => ({ ...item, order })) });
    setSelectedId(copy.id);
    setQuery('');
  }

  const closeEditor = () => compact ? setEditing(false) : setSelectedId('');
  const inspector = selected && (!compact || editing) ? <RegexRuleInspector
    scope="AgentPreset" scopeLocked rule={selected} onTest={onTest} onChange={updateRule}
    onMoveScope={() => {}} onClose={closeEditor}
    onDuplicate={() => duplicateRule(selected)} onDelete={() => deleteRule(selected.id)}
  /> : null;
  const Layout = compact ? EditorSidebarLayout : 'section';

  return (
    <Layout className="preset-regex-editor" aria-label="预设正则"
      {...(compact ? { inspector, inspectorTitle: selected?.name || '正则', onCloseInspector: closeEditor } : {})}>
      <div className="preset-regex-browser">
        <div className="preset-subtoolbar">
          <label><MagnifyingGlass size={15} /><input value={query} placeholder="搜索正则" aria-label="搜索正则" onChange={(event) => setQuery(event.target.value)} /></label>
          {!compact && <button type="button" onClick={addRule}><Plus size={16} />新建</button>}
          {saveAction}
        </div>
        <div className="preset-regex-list" tabIndex={0} aria-label="预设正则列表" onContextMenu={(event) => context.open(event)}>
          {visible.map((rule) => <div className={`preset-regex-row${selectedId === rule.id ? ' is-selected' : ''}${rule.enabled ? '' : ' is-disabled'}`} key={rule.id} onContextMenu={(event) => context.open(event, rule)}>
            <button type="button" className="preset-regex-open" aria-pressed={compact ? selectedId === rule.id : undefined}
              onClick={() => { setSelectedId(rule.id); setEditing(false); }}
              onDoubleClick={() => { setSelectedId(rule.id); setEditing(true); }}>
              <FileCode size={18} aria-hidden="true" /><span>{rule.name || '未命名规则'}</span>
            </button>
            <button type="button" className="preset-regex-enabled" role="switch" aria-checked={rule.enabled} aria-label={`${rule.name}启用状态`} onClick={(event) => { event.stopPropagation(); updateRuleForId(preset, onChange, rule.id, { enabled: !rule.enabled }); }}><i /></button>
          </div>)}
          {!visible.length ? <p className="setting-library-empty">{query ? '没有匹配的规则' : '还没有预设正则'}</p> : null}
        </div>
        {compact && <MobileEditorActions label="正则操作" selectionId={selectedId}
          canEdit={Boolean(selected)} canModify={Boolean(selected)}
          onEdit={() => setEditing(true)} onDelete={() => deleteRule(selectedId)}
          moveItems={[{ label: '上移', disabled: !selected || preset.regexRules.indexOf(selected) === 0, run: () => reorder(-1) },
            { label: '下移', disabled: !selected || preset.regexRules.indexOf(selected) === preset.regexRules.length - 1, run: () => reorder(1) }]}
          createItems={[{ label: '正则', Icon: FileCode, run: addRule }]}
          moreItems={selected ? [{ label: '复制', Icon: Copy, run: () => duplicateRule(selected) }] : []} />}
      </div>
      {!compact && inspector}
      {context.menu ? <PresetContextMenu menu={context.menu} onClose={context.close} actions={context.menu.target ? [
        { label: '编辑', icon: NotePencil, run: () => { setSelectedId(context.menu.target.id); setEditing(true); } },
        { label: '复制', icon: Copy, run: () => duplicateRule(context.menu.target) },
        { label: '删除', icon: TrashIcon, danger: true, run: () => deleteRule(context.menu.target.id) },
      ] : [{ label: '新建正则', icon: Plus, run: addRule }]} /> : null}
    </Layout>
  );

  function reorder(offset) {
    const index = preset.regexRules.findIndex(rule => rule.id === selectedId);
    const next = moveRegexRule({ agentPresetRules: preset.regexRules }, 'AgentPreset', selectedId, index + offset);
    onChange({ ...preset, regexRules: next.agentPresetRules });
  }
}

function updateRuleForId(preset, onChange, id, patch) {
  onChange({ ...preset, regexRules: preset.regexRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) });
}
