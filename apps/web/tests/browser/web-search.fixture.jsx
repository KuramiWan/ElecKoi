import React from 'react';
import { createRoot } from 'react-dom/client';
import { WebSearchProvider } from '../../src/modules/agentTools/model/WebSearchContext.jsx';
import { WebSearchSettings } from '../../src/modules/agentTools/components/WebSearchSettings.jsx';
import '../../src/app/windows/styles/tokens.css';
import '../../src/app/windows/styles/base.css';
import '../../src/modules/agentTools/styles/web-search-settings.css';
import '../../src/mobile/mobile-conversation-overlays.css';

let snapshot = { status: 'ready', mode: 'deepseek_api', fetchMode: 'deepseek_api', writable: true, tavilyAvailable: true,
  apiKeyConfigured: false, apiKeyWritable: true, apiKeyRef: 'TAVILY_API_KEY', maxResults: 5,
  deepseek: { available: true, count: 10, needContent: false, localization: '', apiKeyRef: 'DEEPSEEK_WEB_API_KEY', apiKeyConfigured: false, apiKeyWritable: true } };
const listeners = new Set();
const calls = [];
const model = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  update: async patch => { calls.push(patch); snapshot = { ...snapshot, ...patch, deepseek: { ...snapshot.deepseek, ...(patch.deepseekCount !== undefined ? { count: patch.deepseekCount } : {}), ...(patch.needContent !== undefined ? { needContent: patch.needContent } : {}) } }; listeners.forEach(listener => listener()); },
  saveAndTest: async (_key, provider) => { calls.push({ credentialProvider: provider }); return { connection: { ok: true, provider: 'deepseek_api', search: true, fetch: true } }; } };
window.webSearchFixture = { calls };
createRoot(document.getElementById('root')).render(<main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}><WebSearchProvider model={model}><WebSearchSettings /></WebSearchProvider></main>);
