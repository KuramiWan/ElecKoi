import React from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import * as libraries from '@eleckoi/dsh-client-html-resources/browser-libraries';
import { OfficialMarkdownProvider } from '../../apps/web/src/ui/messages/OfficialMarkdown.jsx';
import { MessageBubble } from '../../apps/web/src/ui/messages/MessageBubble.jsx';
import { MainPageContext } from '../../apps/web/src/app/windows/MainPageContext.jsx';
import { RichMessageRenderProvider } from '../../apps/web/src/modules/authorFrontend/hooks/RichMessageRenderContext.jsx';
import { decorateRichDisplayReplacement } from '../../packages/shared/src/foundation/richMessage';
import '../../apps/web/src/modules/chat/styles/chat-panel.css';

globalThis.React = React;
const ready = { status: 'ready', error: '' };
window.__ElecKoiHtmlResources = { assetsBaseUrl: new URL('./', document.baseURI).href, sdk: libraries,
  getSnapshot: () => ready, subscribe: () => () => {} };
const runtime = { mountDocument(target) { target.ElecKoi = { api: { version: '0.1.0' } }; return () => {}; } };
const connection = { getSnapshot: () => runtime, subscribe: () => () => {} };
const view = { characterConfiguration: { scriptRuntimeConnection: connection } };
const root = createRoot(document.querySelector('#root'));
window.renderPresentation = ({ enabled = false, native = false, key = 'first' } = {}) => {
  const narrative = Array.from({ length: 18 }, (_, index) => `Synthetic narrative paragraph ${index}.`).join('\n\n');
  const message = { id: 'synthetic-reply', conversationId: key, role: 'assistant', status: 'complete',
    content: narrative + '\n\n[TOP]\n\n[MIDDLE]\n\n[BOTTOM]' };
  message.displayContent = narrative + ['TOP', 'MIDDLE', 'BOTTOM'].map(name => decorateRichDisplayReplacement(
    `<!doctype html><html><head>${native ? '<meta name="eleckoi-author-api" content="0.1.0">' : ''}
    <style>html,body{margin:0;padding:0}.card{height:600px;background:#123456;color:#fff}</style></head>
    <body><section class="card">Synthetic ${name} card</section></body></html>`)).join('\n');
  root.render(<MainPageContext.Provider value={view}><OfficialMarkdownProvider component={MarkdownText}>
    <section className="chat-panel view-chat layout-roleplay" style={{ height: '100vh' }}>
      <div className="chat-conversation-body"><div className="message-area layout-roleplay" data-conversation-scroll="">
        <div className="chat-transcript-region">
          <RichMessageRenderProvider key={key} messages={[message]} enabled={enabled} floorLimit={1}>
            <MessageBubble message={message} />
          </RichMessageRenderProvider>
        </div>
        <div className="chat-composer-region" data-composer-seat=""><textarea aria-label="Synthetic composer" /></div>
      </div></div>
    </section>
  </OfficialMarkdownProvider></MainPageContext.Provider>);
};
