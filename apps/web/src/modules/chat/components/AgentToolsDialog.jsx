import { SystemBarOverlay } from '../../../ui/ui/SystemBarOverlay.jsx';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, CaretRight, X } from '../../../ui/icons/interfaceIcons.jsx';
import { AgentToolGroupIcon } from '../../../ui/icons/index.jsx';
import { AutoIllustrationSettings, RoleplayPlanEditor, SubagentSettingsLink, WebSearchSettings } from '../../agentTools/index.js';
import { loadAgentTools, setAgentToolGroupEnabled, setAutoIllustrationModel, setRoleplayPlanSettings } from '../api/agentToolsApi.js';
import { MobileConversationOverlay, MobileOverlayScroll, isMobilePresentation } from '../../../mobile/MobileConversationOverlay.jsx';

export function AgentToolsDialog({
  presetCatalog,
  onClose,
  onManage,
  onNotify,
  purpose = 'roleplay',
}) {
  const mobile = isMobilePresentation();
  const scrollPositions = useRef(new Map()).current;
  const [catalog, setCatalog] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState('');
  const [savingRoleplayPlan, setSavingRoleplayPlan] = useState(false);
  const selected = catalog?.groups.find((item) => item.id === selectedId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadAgentTools(presetCatalog, purpose)
      .then((value) => { if (active) setCatalog(value); })
      .catch(() => { if (active) onNotify?.('error', '读取工具失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onNotify, presetCatalog, purpose]);

  useEffect(() => {
    if (mobile) return undefined;
    const closeOnEscape = (event) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      if (selectedId) setSelectedId('');
      else onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, selectedId, mobile]);

  async function changeEnabled(group, enabled) {
    if (changingId) return;
    setChangingId(group.id);
    setCatalog((current) => current ? {
      ...current,
      groups: current.groups.map((item) => item.id === group.id ? { ...item, enabled } : item),
    } : current);
    try {
      setCatalog(await setAgentToolGroupEnabled(presetCatalog, group.id, enabled, purpose));
    } catch {
      setCatalog((current) => current ? {
        ...current,
        groups: current.groups.map((item) => item.id === group.id ? { ...item, enabled: group.enabled } : item),
      } : current);
      onNotify?.('error', '保存工具设置失败');
    } finally {
      setChangingId('');
    }
  }

  function changeRoleplayPlan(roleplayPlan) {
    setCatalog((current) => current ? { ...current, roleplayPlan } : current);
  }

  async function saveRoleplayPlan(roleplayPlan) {
    if (savingRoleplayPlan) return;
    setSavingRoleplayPlan(true);
    try {
      setCatalog(await setRoleplayPlanSettings(presetCatalog, roleplayPlan));
      onNotify?.('success', '角色扮演计划已保存');
    } catch {
      onNotify?.('error', '保存角色扮演计划失败');
    } finally {
      setSavingRoleplayPlan(false);
    }
  }

  const content = <div className="agent-tools-content">
        {selected ? <ToolDetail
          group={selected}
          changing={changingId === selected.id}
          roleplayPlan={catalog?.roleplayPlan}
          imageConfigId={catalog?.toolModelConfigIds?.['builtin:auto-illustration'] || ''}
          onImageConfigChange={async configId => setCatalog(await setAutoIllustrationModel(presetCatalog, catalog.presetId, configId))}
          savingRoleplayPlan={savingRoleplayPlan}
          onChange={(enabled) => changeEnabled(selected, enabled)}
          onNotify={onNotify}
          onOpenSubagentSettings={onClose}
          onRoleplayPlanChange={changeRoleplayPlan}
          onRoleplayPlanSave={saveRoleplayPlan}
        /> : (
          <div className="agent-tools-list">
            {loading ? <p className="agent-tools-state">正在读取工具</p> : mobile ? [...new Set(catalog?.groups.map(group => group.source))].map(source => <section className="mobile-tool-group" key={source}>
              <h3>{source === 'built_in' ? '内置工具' : source === 'mcp' ? 'MCP' : '扩展'}</h3>
              <div>{catalog.groups.filter(group => group.source === source).map(group => <ToolRow key={group.id} group={group} changing={changingId === group.id} onOpen={() => setSelectedId(group.id)} onChange={enabled => changeEnabled(group, enabled)} />)}</div>
            </section>) : catalog?.groups.map((group) => (
              <ToolRow key={group.id} group={group} changing={changingId === group.id} onOpen={() => setSelectedId(group.id)} onChange={(enabled) => changeEnabled(group, enabled)} />
            ))}
            {!loading && !catalog?.groups.length ? <p className="agent-tools-state">当前预设还没有添加工具</p> : null}
          </div>
        )}
      </div>;
  const manage = <button type="button" className="agent-tools-manage" onClick={() => { onClose(); onManage?.(); }}>管理预设工具 <ArrowRight aria-hidden="true" /></button>;
  if (mobile) return <MobileConversationOverlay title={selected?.name || '工具'} className="mobile-agent-tools" onClose={onClose}
    onBack={selected ? () => setSelectedId('') : undefined} footer={manage}>
    <MobileOverlayScroll key={selectedId || 'list'} scrollKey={selectedId || 'list'} positions={scrollPositions} direction={selected ? 'forward' : 'back'}>{content}</MobileOverlayScroll>
  </MobileConversationOverlay>;
  return createPortal(<SystemBarOverlay className="agent-tools-backdrop" role="presentation" onMouseDown={onClose}>
    <section className={`agent-tools-dialog${selected?.id === 'builtin:auto-illustration' ? ' desktop-illustration-tool-dialog' : ''}`} role="dialog" aria-modal="true" aria-label="预设工具" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        {selected ? <button type="button" onClick={() => setSelectedId('')} aria-label="返回工具列表"><ArrowLeft /></button> : <span />}
        <h2>{selected?.id === 'builtin:auto-illustration' ? selected.name : '预设工具'}</h2>
        <button type="button" onClick={onClose} aria-label="关闭"><X /></button>
      </header>
      {content}
      <footer>
        <button type="button" className="agent-tools-manage" onClick={() => { onClose(); onManage?.(); }}>
          管理预设工具 <ArrowRight aria-hidden="true" />
        </button>
      </footer>
    </section>
  </SystemBarOverlay>, document.body);
}

function ToolRow({ group, changing, onOpen, onChange }) {
  return <div className={`agent-tool-row${group.enabled ? ' enabled' : ''}`}>
    <button type="button" className="agent-tool-open" onClick={onOpen}>
      <span className="agent-tool-icon"><AgentToolGroupIcon groupId={group.id} /></span>
      <strong>{group.name}</strong>
      <CaretRight className="agent-tool-caret" />
    </button>
    <ToolSwitch name={group.name} checked={group.enabled} disabled={changing} onChange={onChange} />
  </div>;
}

function ToolDetail({
  group,
  changing,
  roleplayPlan,
  imageConfigId,
  onImageConfigChange,
  savingRoleplayPlan,
  onChange,
  onNotify,
  onOpenSubagentSettings,
  onRoleplayPlanChange,
  onRoleplayPlanSave,
}) {
  return <div className="agent-tool-detail">
    <div className="agent-tool-detail-switch">
      <strong>启用此工具组</strong>
      <ToolSwitch name={group.name} checked={group.enabled} disabled={changing} onChange={onChange} />
    </div>
    {group.description ? <p className="agent-tool-detail-description">{group.description}</p> : null}
    {group.id === 'builtin:auto-illustration' && <AutoIllustrationSettings configId={imageConfigId} onSelect={onImageConfigChange} />}
    {group.id === 'builtin:collaboration' ? <SubagentSettingsLink
      onOpen={onOpenSubagentSettings}
      onNotify={onNotify}
    /> : null}
    {group.id === 'builtin:web' ? <div className="agent-tool-web-config"><WebSearchSettings /></div> : <>
      {group.id === 'builtin:roleplay-workflow' ? <RoleplayPlanEditor
        value={roleplayPlan}
        saving={savingRoleplayPlan}
        onChange={onRoleplayPlanChange}
        onSave={onRoleplayPlanSave}
      /> : <>
        <h3>{group.members.length ? `包含 ${group.members.length} 个工具` : '工具'}</h3>
        <div className="agent-tool-members">
          {group.members.length ? group.members.map((member) => <div key={member.name}>
            <code>{member.name}</code>
            {member.description ? <small>{member.description}</small> : null}
          </div>) : <p>此工具组没有独立调用项</p>}
        </div>
        <h3>来源</h3>
        <div className="agent-tool-source">
          <span className="agent-tool-icon"><AgentToolGroupIcon groupId={group.id} /></span>
          <span>{group.source === 'built_in' ? 'ElecKoi 内置' : group.source === 'mcp' ? 'MCP 服务器' : '扩展'}</span>
        </div>
      </>}
    </>}
  </div>;
}

function ToolSwitch({ name, checked, disabled, onChange }) {
  return <button
    type="button"
    className="agent-tool-switch"
    role="switch"
    aria-checked={checked}
    aria-label={`${name}工具开关`}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  ><span /></button>;
}
