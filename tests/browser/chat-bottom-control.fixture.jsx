import React, { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatView } from 'official-chat-fixture';
import '../../apps/web/src/modules/chat/styles/chat-panel.css';

const listeners = new Set();
const empty = [];
const node = index => ({ key: `synthetic-turn-${index}`, kind: 'turn-process', anchorSeq: index + 1,
  location: { kind: 'turn', turn: { turn: index + 1, status: 'closed', data: { get() {} } } }, data: { turn: index + 1 } });
let nodes = Array.from({ length: 24 }, (_, index) => node(index));
let state = { order: nodes.map(item => item.key), nodes: new Map(nodes.map(item => [item.key, item])) };
let saved = null;
const snapshot = () => state;
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const session = { running: false, openState: 'open', openError: null, hasMore: false, loadingOlder: false, pendingSubmissions: empty };
const props = {
  sessionId: 'synthetic-scroll-session',
  useSession: select => select(session),
  useChat: select => select({ ...useSyncExternalStore(subscribe, snapshot), navigation: { items: () => empty } }),
  useChatNode: (key, select = value => value) => select(useSyncExternalStore(subscribe, snapshot).nodes.get(key)),
  useChatNodeProcess: () => undefined, useChatGroup: () => undefined,
  useConversation: select => select({ views: { grouped: () => undefined } }),
  useSessions: select => select({ byId: { 'synthetic-scroll-session': {} } }),
  useProjection: key => key === 'inbox' ? { 'next-step': empty } : undefined,
  usePresentation: select => select({ foldCompletedTurns: false, stepGrouping: 'expanded' }),
  useStore: select => select({ turnProcess: {} }), actions: { setTurnProcessOpen() {} }, t: key => key,
  chatScroll: { read: () => saved, save: value => { saved = value; } },
  loadOlder: async () => {}, loadThrough: async () => {}, openFile: async () => {}, openSkill() {},
  openExternalLink() {}, loadImage: async () => '', inspectCall() {}, fileMentions() {},
  renderSlot: (name, owner, options) => name === 'conversation.chat.node'
    ? <article className="synthetic-message">{owner.node.key}</article> : options?.fallback ?? null,
};

window.chatBottomFixture = {
  setCount(count) {
    nodes = Array.from({ length: count }, (_, index) => node(index));
    state = { order: nodes.map(item => item.key), nodes: new Map(nodes.map(item => [item.key, item])) };
    listeners.forEach(listener => listener());
  },
};

function Fixture() {
  const scroller = useRef(null), composer = useRef(null);
  useLayoutEffect(() => {
    const update = () => scroller.current.style.setProperty('--dsh-composer-height', `${composer.current.offsetHeight}px`);
    const observer = new ResizeObserver(update);
    observer.observe(composer.current); update();
    return () => observer.disconnect();
  }, []);
  return <section className="chat-panel view-chat layout-roleplay">
    <header className="chat-header">合成聊天</header>
    <div className="chat-conversation-body">
      <div className="message-area layout-roleplay" data-conversation-scroll="" ref={scroller}>
        <div className="chat-transcript-region"><ChatView {...props} /></div>
        <div className="chat-composer-region" data-composer-seat="" ref={composer}>
          <textarea aria-label="合成输入框" />
        </div>
      </div>
    </div>
  </section>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
