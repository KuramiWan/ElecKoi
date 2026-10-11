import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MainPageContext } from '../../apps/web/src/app/windows/MainPageContext.jsx';
import { RichMessageFrame } from '../../apps/web/src/modules/authorFrontend/components/RichMessageFrame.jsx';

const source = `<!doctype html><html lang="en"><head>
<meta name="eleckoi-author-api" content="0.1.0">
<style>body{font:16px system-ui;margin:16px}input,button{font:inherit;padding:8px}output{display:block;margin-top:12px;overflow-wrap:anywhere}</style>
<script type="module">
const api = await window.ElecKoiReady;
if (globalThis.TavernHelper || globalThis.Mvu || globalThis.SillyTavern) throw new Error('Unexpected compatibility resource');
const context = await api.context.current();
document.querySelector('#confirm').onclick = async () => {
  const result = document.querySelector('#result');
  try {
    const accepted = await api.variables.merge({score: Number(document.querySelector('#score').value)});
    const receipt = await api.chat.send('Synthetic score ' + accepted.score);
    result.textContent = JSON.stringify({accepted, receipt, context});
  } catch (error) { result.textContent = error.message || String(error); }
};
document.querySelector('#result').textContent = 'ready';
</script></head><body><label>Score <input id="score" type="number" value="4"></label>
<button id="confirm">Confirm</button><output id="result"></output></body></html>`;

window.mountNativeMessageFixture = runtime => {
  const root = createRoot(document.querySelector('#author-root'));
  const connection = { getSnapshot: () => runtime, subscribe: () => () => {} };
  flushSync(() => root.render(<MainPageContext.Provider value={{ characterConfiguration: { scriptRuntimeConnection: connection } }}>
    <RichMessageFrame message={{ id: 'synthetic-opening', conversationId: 'synthetic-chat' }}
      document={{ source, contentKey: 'synthetic-native-document' }} />
  </MainPageContext.Provider>));
  document.querySelector('#author-root iframe').id = 'author-page';
  return () => flushSync(() => root.unmount());
};
