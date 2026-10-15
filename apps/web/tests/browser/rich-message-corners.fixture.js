import { buildAuthorDocumentSource } from '@eleckoi/author-sdk';
import * as sdk from '@eleckoi/dsh-client-html-resources/browser-libraries';
import { buildRichMessageHtml } from '../../src/modules/authorFrontend/model/buildRichMessageHtml.js';
import '../../src/modules/chat/styles/chat-panel.css';

const runtime = { assetsBaseUrl: new URL('./', location.href).href, sdk };
window.renderCorners = scheme => {
  document.body.replaceChildren();
  window.framesReady = 0;
  for (const native of [false, true]) for (const authoredScheme of [false, true]) {
    const channel = `corners-${native}-${authoredScheme}`;
    const cell = document.createElement('section');
    cell.style.cssText = `padding:12px;background:#284050;color-scheme:${scheme}`;
    const source = `<!doctype html><html><head>
      ${native ? '<meta name="eleckoi-author-api" content="0.1.0">' : ''}
      <style>
        ${authoredScheme ? 'html{color-scheme:only light}' : ''}
        html,body{background:transparent;margin:0;padding:0}
        .card{box-sizing:border-box;height:64px;border-radius:20px;background:#15243c;color:white;padding:20px}
      </style></head><body><div class="card">合成卡片</div>
      <script>document.documentElement.dataset.preferredDark=String(matchMedia('(prefers-color-scheme:dark)').matches)</script>
      </body></html>`;
    const frame = document.createElement('iframe');
    frame.className = 'rich-message-frame';
    frame.dataset.native = String(native);
    frame.dataset.authoredScheme = String(authoredScheme);
    frame.style.height = '64px';
    frame.onload = () => {
      if (native) frame.contentWindow.__ElecKoiCompleteDocument({ api: { version: '0.1.0' } });
      window.framesReady++;
    };
    frame.srcdoc = native ? buildAuthorDocumentSource(source, channel, true) : buildRichMessageHtml({ source }, channel, runtime);
    cell.append(frame); document.body.append(cell);
  }
};
