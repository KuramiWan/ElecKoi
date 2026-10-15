import React from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { OfficialMarkdownProvider } from '../../apps/web/src/ui/messages/OfficialMarkdown.jsx';
import { MessageBubble } from '../../apps/web/src/ui/messages/MessageBubble.jsx';
import '../../apps/web/src/app/windows/styles/tokens.css';
import '../../apps/web/src/app/windows/styles/dsh-theme-bridge.css';
import '../../apps/web/src/app/windows/styles/base.css';
import '../../apps/web/src/modules/chat/styles/chat-panel.css';
import '../../apps/web/src/mobile/mobile.css';

const query = new URLSearchParams(location.search);
const mobile = !query.has('desktop');
document.documentElement.dataset.eleckoiMobile = String(mobile);
const sample = [
  '“合成对白”以及很长的正文。'.repeat(12),
  '# 合成标题与长行内代码 `' + 'synthetic-token-'.repeat(24) + '`',
  '- 合成长单词 ' + 'synthetic'.repeat(80),
  ['| 合成类型 | 合成示例 | 合成备注 | 合成说明 |',
    '| --- | --- | --- | --- |',
    '| 合成内容 | “合成引号” | ' + 'synthetic-note-'.repeat(28) + ' | 合成说明 |'].join('\n'),
  '```json\n{"synthetic":"' + 'long-value-'.repeat(50) + '"}\n```',
].join('\n\n');
createRoot(document.querySelector('#eleckoi-root')).render(
  <OfficialMarkdownProvider component={MarkdownText}>
    <main className={mobile ? 'mobile-shell' : 'main-window-shell'}>
      <section className={mobile ? 'mobile-conversation-page' : 'main-panel-content'}>
        <div className="chat-conversation-body"><div className="chat-panel">
          <header className="chat-header">合成聊天</header>
          <div className="message-area layout-roleplay">
            <MessageBubble message={{ id: 'synthetic-message', role: query.get('role') || 'assistant', pending: query.has('streaming'), content: sample }}
              name="合成角色" layoutMode={query.get('layout') || 'roleplay'} onEdit={() => {}} />
          </div>
        </div></div>
      </section>
    </main>
  </OfficialMarkdownProvider>,
);
