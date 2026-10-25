import React from 'react';
import { createRoot } from 'react-dom/client';
import { WebSearchProvider } from '../../src/modules/agentTools/model/WebSearchContext.jsx';
import { WebSearchSettings } from '../../src/modules/agentTools/components/WebSearchSettings.jsx';
import '../../src/app/windows/styles/tokens.css';
import '../../src/app/windows/styles/base.css';
import '../../src/modules/agentTools/styles/web-search-settings.css';
import '../../src/mobile/mobile-conversation-overlays.css';

let snapshot = { status: 'ready', mode: 'deepseek_search_api', fetchMode: 'deepseek_fetch_api', writable: true, tavilyAvailable: true,
  apiKeyConfigured: false, apiKeyWritable: true, apiKeyRef: 'TAVILY_API_KEY', maxResults: 5, officialDeepSeekAvailable: true };
const listeners = new Set();
const calls = [];
const model = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  update: async patch => { calls.push(patch); snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); },
  openPluginSettings: () => calls.push({ open: 'web-search' }),
  saveAndTest: async () => { calls.push({ credentialProvider: 'tavily' }); return { connection: { ok: true, plan: 'Test', used: 0, limit: 100 } }; } };
window.webSearchFixture = { calls };
createRoot(document.getElementById('root')).render(<main style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}><WebSearchProvider model={model}><WebSearchSettings onOpenPluginSettings={() => calls.push({ closed: true })} /></WebSearchProvider></main>);
