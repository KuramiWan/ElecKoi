import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { DshAgentPresetIcon } from '../../../ui/icons/dshComposerIcons.jsx';
import { RoleplayInputMenu, ChatModelPicker, AgentToolsDialog } from '../../chat/index.js';
import { openPresetManagerWindow } from '../../presets/index.js';

/** Desktop assembly of the shared Studio Session with native views and resident input. */
export function CreatorStudioConversation({ model, editing = false, models, presetCatalog, title, presetName, onCreate, onSelectCharacter, onError,
  sessionId, useSession, useInput, useSessionStatus, useProjection, useInspectCall, useStore, actions, openView, renderSlot, renderSlotChain }) {
  const session = useSession(value => value), input = useInput(value => value);
  const pendingInteraction = useSessionStatus(value => value.get(sessionId)?.pendingInteraction);
  const projectedModel = useProjection('modelSelection'), projectedTitle = useProjection('title');
  const inspectCall = useInspectCall(value => value), activeView = useStore(value => value.view);
  const viewRequest = useStore(value => value.viewRequest ?? null);
  const owner = { inspectCall, viewRequest, openView, completeViewRequest: actions.completeViewRequest };
  const configs = useSyncExternalStore(models.subscribe, models.getSnapshot);
  const [defaultModel, setDefaultModel] = useState(null), [tools, setTools] = useState(false), [normalView, setNormalView] = useState('chat');
  const [messages, setMessages] = useState(null), [selectedMessage, setSelectedMessage] = useState(null), [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState('');
  const body = useRef(null), composer = useRef(null);
  const notify = useCallback((kind, text) => { if (kind === 'error') onError(text); }, [onError]);
  const selectedModel = projectedModel?.next ?? projectedModel?.lastUsed ?? defaultModel;
  useEffect(() => {
    let active = true;
    model.readDefaultModel().then(value => { if (active) setDefaultModel(value); }).catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [model, onError]);
  useEffect(() => { if (!session.running) void model.refresh().catch(error => onError(error.message)); }, [model, session.running, onError]);
  useLayoutEffect(() => {
    if (!body.current || !composer.current) return;
    const scroller = body.current, seat = composer.current;
    const update = () => scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`);
    const observer = new ResizeObserver(update); observer.observe(seat); update();
    return () => { observer.disconnect(); scroller.style.removeProperty('--dsh-composer-height'); };
  }, []);
  async function regenerate() { try { await model.regenerate(); } catch (error) { onError(error.message); } }
  async function showMessages() { try { setMessages(await model.messages()); setSelectedMessage(null); setDeleteError(''); } catch (error) { onError(error.message); } }
  async function removeMessages() {
    if (!selectedMessage) return;
    setDeleting(true); setDeleteError('');
    try { await model.deleteMessagesFrom(selectedMessage.eventSeq, selectedMessage.role); setMessages(null); }
    catch (error) { setDeleteError(error.message); onError(error.message); }
    finally { setDeleting(false); }
  }
  function selectView(view) { setNormalView(view); openView(view); }
  const menu = <RoleplayInputMenu purpose="creator" isSending={session.running} onCreateChat={onCreate} onSelectCharacter={onSelectCharacter}
    onOpenTools={() => setTools(true)} onEnterDeleteMode={showMessages} canDeleteMessages={!session.blank}
    onRegenerate={regenerate} regenerateTargetMessageId={session.blank ? null : sessionId} />;
  const modelPicker = <ChatModelPicker configs={configs.configs} selectedConfigId={selectedModel?.provider} selectedModel={selectedModel?.model}
    onLoadModels={config => models.discover(config)} onNotify={notify} onSelect={selection => model.selectModel({ provider: selection.configId, model: selection.model })} />;
  const resident = renderSlot('eleckoi.creator-studio.composer.bar', { variant: 'composer', placeholder: '输入消息', leadingAccessory: menu, modelAccessory: modelPicker });
  const inputSeat = renderSlotChain('eleckoi.creator-studio.composer', { sessionId, session, pendingInteraction }, { fallback: resident, overlay: true });
  return <div className="creator-simple-conversation">
    <header className="creator-simple-chat-header">
      <div className="creator-simple-chat-heading"><h1 title={projectedTitle || title}>{projectedTitle || title}</h1>
        <button type="button" className="creator-simple-preset" title={presetName} onClick={() => openPresetManagerWindow('creator')}><DshAgentPresetIcon size={16} /><span>{presetName}</span></button>
      </div>
      <div role="tablist" aria-label="工作室视图">{[['chat', '对话'], ['trajectory', '轨迹']].map(([id, label]) => <button type="button" role="tab" key={id}
        aria-selected={normalView === id} onClick={() => selectView(id)}>{label}</button>)}</div>
    </header>
    <div ref={body} className="creator-simple-conversation-scroll" data-conversation-scroll="true">
      <div className={`creator-simple-transcript${normalView === 'trajectory' ? ' is-trajectory' : ''}`}>{renderSlot('eleckoi.creator-studio.view', owner, { only: normalView })}</div>
      <div ref={composer} className="chat-composer-region creator-simple-composer" data-composer-seat="true" inert={editing ? true : undefined} aria-busy={editing || undefined}>
        {renderSlot('eleckoi.creator-studio.input.dock', { session, input })}{inputSeat}
      </div>
    </div>
    <Modal open={!!activeView && activeView !== 'chat' && activeView !== 'trajectory'} title="详情" closeLabel="关闭" onClose={() => openView(normalView)} className="creator-simple-detail">
      {activeView && activeView !== 'chat' && activeView !== 'trajectory' && renderSlot('eleckoi.creator-studio.view', owner, { only: activeView })}
    </Modal>
    {tools && <AgentToolsDialog purpose="creator" presetCatalog={presetCatalog} onNotify={notify} onClose={() => setTools(false)} onManage={() => openPresetManagerWindow('creator')} />}
    <Modal open={!!messages} title="删除消息" closeLabel="关闭" onClose={() => !deleting && setMessages(null)} className="creator-simple-message-dialog"
      footer={<button type="button" disabled={!selectedMessage || deleting} onClick={removeMessages}>删除</button>}>
      {deleteError && <p className="creator-simple-error" role="alert">{deleteError}</p>}
      <div className="creator-simple-message-list">{messages?.filter(message => message.text.trim()).map(message => <label key={message.eventSeq}>
        <input type="radio" name="creator-message-delete" checked={selectedMessage?.eventSeq === message.eventSeq} onChange={() => setSelectedMessage(message)} /><span>{message.text}</span>
      </label>)}</div><p>删除选中的消息及之后的内容</p>
    </Modal>
  </div>;
}
