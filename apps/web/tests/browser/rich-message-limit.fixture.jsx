import React from 'react';
import { createRoot } from 'react-dom/client';
import * as libraries from '@eleckoi/dsh-client-html-resources/browser-libraries';
import { MainPageContext } from '../../src/app/windows/MainPageContext.jsx';
import { RichMessageFrame } from '../../src/modules/authorFrontend/components/RichMessageFrame.jsx';
import { RichMessageRenderProvider } from '../../src/modules/authorFrontend/hooks/RichMessageRenderContext.jsx';
import '../../src/modules/chat/styles/chat-panel.css';

globalThis.React = React;
const ready = { status: 'ready', error: '' };
window.__ElecKoiHtmlResources = { assetsBaseUrl: new URL('./', location.href).href, sdk: libraries,
  getSnapshot: () => ready, subscribe: () => () => {} };
window.counters = {};
window.releases = 0;
window.mounts = 0;
const runtime = { mountDocument(target) {
  window.mounts++;
  target.ElecKoi = { api: { version: '0.1.0' } };
  return () => { window.releases++; };
} };
const connection = { getSnapshot: () => runtime, subscribe: () => () => {} };
const view = { characterConfiguration: { scriptRuntimeConnection: connection } };
const root = createRoot(document.querySelector('#root'));

window.renderLimit = ({ enabled, width, scheme }) => {
  document.documentElement.style.colorScheme = scheme;
  document.body.style.cssText = `margin:0;background:${scheme === 'dark' ? '#141414' : '#fff'};color:${scheme === 'dark' ? '#eee' : '#222'};--surface-subtle:${scheme === 'dark' ? '#292929' : '#f1f3f6'};--muted:currentColor`;
  const messages = ['older-a', 'older-b', 'latest'].map(id => ({ id: `${width}-${scheme}-${id}`, conversationId: 'synthetic-chat', role: 'assistant' }));
  return new Promise(resolve => {
    root.render(<MainPageContext.Provider value={view}>
      <RichMessageRenderProvider key={`${width}-${scheme}`} messages={messages} enabled={enabled} floorLimit={1}>
        {messages.map(message => <section key={message.id} data-message={message.id}><p>Narrative {message.id}</p>
          {[false, true].map(native => {
            const id = `${message.id}-${native}`;
            const source = `<!doctype html><html><head>${native ? '<meta name="eleckoi-author-api" content="0.1.0">' : ''}
              <style>html,body{margin:0;padding:0;background:transparent}.card{height:64px;background:#123456;color:white}</style></head>
              <body><div class="card">Synthetic card</div><script>
              setInterval(()=>{parent.counters[${JSON.stringify(id)}]=(parent.counters[${JSON.stringify(id)}]||0)+1},20);
              </script></body></html>`;
            return <RichMessageFrame key={id} message={message} document={{ contentKey: id, source }} />;
          })}
        </section>)}
      </RichMessageRenderProvider>
    </MainPageContext.Provider>);
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
};
