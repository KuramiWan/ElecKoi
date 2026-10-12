import { useMemo, useState } from 'react';
import { DotsThree, PushPin, Trash } from '@phosphor-icons/react';
import { MessagesPage } from '../../../../packages/client/features/dsh-client-conversations/src/page.jsx';
import { useMainPageView } from '../app/windows/MainPageContext.jsx';
import { characterAvatar, characterCover, characterName } from '../utils/characterDisplay.js';
import { SidebarCharacterArtwork } from '../ui/ui/SidebarCharacterArtwork.jsx';
import { MobileDialog, MobileHeader, MobileState, useMobileScroll } from './MobileChrome.jsx';
import { formatDate } from '../utils/format.js';
import { MobileSwipeRow } from './MobileSwipeRow.jsx';
import { MobileBackIcon } from './MobileIcons.jsx';
import { MobileConversationPage } from './MobileConversationPage.jsx';

export function MobileMessagesPage() {
  const view = useMainPageView();
  const { chat } = view;
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(null);
  const [hideEntry, setHideEntry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const characters = useMemo(() => new Map(chat.characters.items.map(item => [item.id, item])), [chat.characters.items]);
  if (view.route.kind === 'conversation') return <MobileConversationPage>
    <MessagesPage headerLeading={<button type="button" className="mobile-conversation-back" aria-label="返回" onClick={view.goBack}><MobileBackIcon /></button>} />
  </MobileConversationPage>;
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); setMenu(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="mobile-root-page">
    <MobileHeader title="消息" onSearch={view.openSearch} onAdd={() => setPicker(true)} addLabel="新建对话" />
    <MobileMessageList sessions={chat.filteredSessions} characters={characters} pinnedIds={chat.pinnedIds} artworkMode={view.appearance.sidebarCharacterArtwork} loading={view.routeBusy || busy} onOpen={view.selectConversation} onMenu={setMenu}
      onPin={item => run(() => chat.togglePinChat(item.id))} onHide={setHideEntry} />
    {error && !menu && !hideEntry && <p className="mobile-inline-error" role="alert">{error}</p>}
    {picker && <MobileDialog title="选择角色" onClose={() => setPicker(false)}>
      <div className="mobile-picker-list">{chat.characters.items.map(item => <button type="button" key={item.id} disabled={view.routeBusy} onClick={async () => { setPicker(false); await view.openCharacterConversation(item.id); }}>
        <SidebarCharacterArtwork mode={view.appearance.sidebarCharacterArtwork} name={characterName(item)} cover={characterCover(item)} avatar={characterAvatar(item)} /><span>{characterName(item)}</span>
      </button>)}</div>
      {!chat.characters.items.length && <button type="button" onClick={() => { setPicker(false); view.selectPanel('character'); }}>创建角色</button>}
    </MobileDialog>}
    {menu && <MobileDialog title={menu.character_name || '会话操作'} busy={busy} onClose={() => setMenu(null)}>
      <button type="button" disabled={busy} onClick={() => run(() => chat.togglePinChat(menu.id))}><PushPin size={22} />{chat.pinnedIds.includes(menu.id) ? '取消置顶' : '置顶会话'}</button>
      <button type="button" disabled={busy} onClick={() => { setHideEntry(menu); setMenu(null); }}><Trash size={22} />隐藏会话入口</button>
      {error && <p role="alert">{error}</p>}
    </MobileDialog>}
    {hideEntry && <MobileDialog title="删除消息入口？" busy={busy} onClose={() => setHideEntry(null)}>
      <p>只会从消息列表隐藏这个入口；角色和聊天记录都会保留。</p>
      <button type="button" disabled={busy} onClick={() => run(async () => { await chat.hideChatEntry(hideEntry.id); setHideEntry(null); })}>删除入口</button>
      {error && <p role="alert">{error}</p>}
    </MobileDialog>}
  </div>;
}

export function MobileMessageList({ sessions, characters, pinnedIds, artworkMode = 'cover', loading, onOpen, onMenu, onPin, onHide }) {
  const ref = useMobileScroll('messages');
  const [openKey, setOpenKey] = useState(null);
  return <div ref={ref} className={`mobile-scroll mobile-message-list${sessions.length ? '' : ' is-empty'}`}>
    {sessions.map(item => {
      const character = characters.get(item.character_id);
      const name = item.character_name || characterName(character);
      return <MobileSwipeRow key={item.id} rowKey={item.id} openKey={openKey} onOpenKeyChange={setOpenKey} disabled={loading} actions={[
        { label: pinnedIds.includes(item.id) ? '取消置顶' : '置顶', icon: <PushPin size={19} />, onClick: () => onPin(item) },
        { label: '删除', icon: <Trash size={19} />, destructive: true, onClick: () => onHide(item) },
      ]}>{safeClick => <div className={`mobile-message-row${pinnedIds.includes(item.id) ? ' is-pinned' : ''}`}>
        <button type="button" className="mobile-message-open" disabled={loading} onClick={() => safeClick(() => onOpen(item.id))} onContextMenu={event => { event.preventDefault(); onMenu(item); }}>
          <SidebarCharacterArtwork mode={artworkMode} name={name} cover={characterCover(character) || item.character_persona?.assistant_cover || item.character_avatar} avatar={characterAvatar(character) || item.character_avatar} />
          <span className="mobile-message-text"><span className="mobile-message-heading"><strong>{name}</strong><time>{formatDate(item.updated_at)}</time></span><span className="mobile-message-preview">{item.summary || '暂无历史对话'}</span></span>
        </button>
        <button type="button" className="mobile-message-menu" aria-label={`${name}的会话操作`} onClick={() => onMenu(item)}><DotsThree size={22} /></button>
      </div>}</MobileSwipeRow>;
    })}
    {!sessions.length && <MobileState empty="暂无会话" />}
  </div>;
}
