import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useMainPageView } from '../app/windows/MainPageContext.jsx';
import { RoleplayInputMenu } from '../modules/chat/components/RoleplayInputMenu.jsx';
import { ChatModelPicker } from '../modules/chat/components/ChatModelPicker.jsx';
import { AgentToolsDialog } from '../modules/chat/components/AgentToolsDialog.jsx';
import { MobileConversationPage } from './MobileConversationPage.jsx';
import { MobileDialog } from './MobileChrome.jsx';

/** Official Chat keeps its native tool cards; the resident mobile composer owns input and stats. */
export function MobileCreatorStudioConversation({ model, editing = false, onCreate, onSelectCharacter, onError,
  sessionId, useSession, useInput, useSessionStatus, useProjection, useInspectCall, useStore, actions, openView, renderSlot, renderSlotChain }) {
  const view = useMainPageView();
  const session = useSession(snapshot => snapshot);
  const input = useInput(snapshot => snapshot);
  const pendingInteraction = useSessionStatus(snapshot => snapshot.get(sessionId)?.pendingInteraction);
  const projectedModel = useProjection('modelSelection');
  const inspectCall = useInspectCall(value => value);
  const activeView = useStore(value => value.view);
  const viewRequest = useStore(value => value.viewRequest ?? null);
  const viewOwner = { inspectCall, viewRequest, openView, completeViewRequest: actions.completeViewRequest };
  const models = useSyncExternalStore(view.models.subscribe, view.models.getSnapshot);
  const [defaultModel, setDefaultModel] = useState(null);
  const [tools, setTools] = useState(false);
  const [messages, setMessages] = useState(null);
  const [deleteFrom, setDeleteFrom] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const selected = projectedModel?.next ?? projectedModel?.lastUsed ?? defaultModel;
  const notify = useCallback((kind, text) => { if (kind === 'error') onError(text); }, [onError]);
  useEffect(() => {
    let active = true;
    model.readDefaultModel().then(value => { if (active) setDefaultModel(value); }).catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [model, onError]);
  async function regenerate() {
    try { await model.regenerate(); } catch (error) { onError(error.message); }
  }
  async function openDelete() {
    try { setMessages(await model.messages()); setDeleteFrom(null); } catch (error) { onError(error.message); }
  }
  async function removeMessages() {
    if (!deleteFrom) return;
    setDeleting(true);
    try { await model.deleteMessagesFrom(deleteFrom.eventSeq, deleteFrom.role); setMessages(null); }
    catch (error) { onError(error.message); }
    finally { setDeleting(false); }
  }
  const menu = <RoleplayInputMenu purpose="creator" isSending={session.running}
    onSelectCharacter={onSelectCharacter} onCreateChat={onCreate} onOpenTools={() => setTools(true)}
    onEnterDeleteMode={openDelete} canDeleteMessages={!session.blank}
    onRegenerate={regenerate} regenerateTargetMessageId={session.blank ? null : sessionId} />;
  const picker = <ChatModelPicker configs={models.configs} selectedConfigId={selected?.provider}
    selectedModel={selected?.model} onLoadModels={config => view.models.discover(config)} onNotify={notify}
    onSelect={selection => model.selectModel({ provider: selection.configId, model: selection.model })} />;
  const resident = renderSlot('eleckoi.creator-studio.composer.bar', {
    variant: 'composer', placeholder: '输入消息', leadingAccessory: menu, modelAccessory: picker,
  });
  const composer = renderSlotChain('eleckoi.creator-studio.composer', {
    sessionId, session, pendingInteraction,
  }, { fallback: resident, overlay: true });
  return <MobileConversationPage>
    <div className="creator-studio-session-body">
      <div className="creator-studio-chat-scroll" data-conversation-scroll="true">{renderSlot('eleckoi.creator-studio.view', viewOwner, { only: 'chat' })}</div>
      <div className="chat-composer-region" data-composer-seat="true" inert={editing ? true : undefined} aria-busy={editing || undefined}>
        {renderSlot('eleckoi.creator-studio.input.dock', { session, input })}
        {composer}
      </div>
    </div>
    {activeView && activeView !== 'chat' && <MobileDialog title="详情" onClose={() => openView('chat')} className="creator-studio-native-detail">
      {renderSlot('eleckoi.creator-studio.view', viewOwner, { only: activeView })}
    </MobileDialog>}
    {tools && <AgentToolsDialog purpose="creator" presetCatalog={view.presets} onNotify={notify}
      onClose={() => setTools(false)} onManage={view.openPresetTools} />}
    {messages && <MobileDialog title="删除消息" busy={deleting} onClose={() => setMessages(null)} className="creator-studio-message-picker creator-studio-confirmation">
      <div className="creator-studio-message-list">
        {messages.map(message => <label key={message.eventSeq}><input type="radio" name="studio-delete-from"
          checked={deleteFrom?.eventSeq === message.eventSeq} onChange={() => setDeleteFrom(message)} />
          <span>{message.text}</span></label>)}
      </div>
      <p>删除选中的消息及之后的内容</p>
      <div className="confirmation-actions">
        <button type="button" disabled={deleting} onClick={() => setMessages(null)}>取消</button>
        <button type="button" className="is-destructive" disabled={!deleteFrom || deleting} onClick={removeMessages}>{deleting ? '删除中…' : '删除'}</button>
      </div>
    </MobileDialog>}
  </MobileConversationPage>;
}
