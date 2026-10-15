import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

const read = path => readFileSync(new URL(`../apps/android/app/src/${path}`, import.meta.url), 'utf8');
const collector = read('main/assets/browser-diagnostics.js'), page = read('compat/assets/eleckoi-browser/page.js'), transport = read('compat/assets/eleckoi-browser/transport.js');
const setup = () => new JSDOM('', { url: 'http://127.0.0.1:31001/', runScripts: 'outside-only', pretendToBeVisual: true });
it('keeps runtime error names and stacks after readiness, omits product objects and installs only once', () => {
  const dom = setup(), { window } = dom, entries = [];
  try {
    window.console.error = () => {};
    window.eval(collector); window.ElecKoiBrowserDiagnostics.install(entry => entries.push(entry));
    window.ElecKoiBrowserDiagnostics.install(() => { throw new Error('Must not reinstall'); });
    window.dispatchEvent(new window.CustomEvent('eleckoi:client-ready'));
    const error = new window.TypeError('Synthetic runtime failure'); error.stack = 'TypeError: Synthetic runtime failure\n at apply (synthetic.js:10:8)';
    window.dispatchEvent(new window.ErrorEvent('error', { error, filename: 'synthetic.js', lineno: 10, colno: 8 }));
    const rejection = new window.Event('unhandledrejection'); Object.defineProperty(rejection, 'reason', { value: error }); window.dispatchEvent(rejection);
    window.console.error('Synthetic summary', { content: 'synthetic private content' }, error);
    expect(entries.filter(entry => entry.kind === 'page-error')).toHaveLength(3);
    expect(entries[1]).toMatchObject({ name: 'TypeError', source: 'synthetic.js', line: 10, column: 8, stack: error.stack });
    expect(entries[2]).toMatchObject({ stage: 'unhandledrejection', stack: error.stack });
    expect(JSON.stringify(entries)).not.toContain('synthetic private content');
  } finally { window.close(); }
});
it('correlates native back through extension and page while keeping command payloads out of diagnostics', async () => {
  const dom = setup(), { window } = dom, messages = []; let nativeCommand;
  const port = { onMessage: { addListener: fn => nativeCommand = fn }, postMessage: entry => messages.push(entry) };
  try {
    window.browser = { runtime: { connectNative: () => port } };
    window.postMessage = data => queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin, data })));
    window.eval(collector); window.eval(transport); window.eval(page);
    window.ElecKoiPlatform = { browserCommand: () => true };
    await new Promise(resolve => setTimeout(resolve, 20));
    nativeCommand({ id: 'synthetic-back', command: { type: 'back', payload: { content: 'synthetic private content' } } });
    await new Promise(resolve => setTimeout(resolve, 40));
    const stages = messages.filter(entry => entry.diagnostic?.id === 'synthetic-back').map(entry => entry.diagnostic.stage);
    expect(stages).toEqual(['extension-received', 'page-received', 'page-completed', 'extension-result']);
    expect(messages.find(entry => entry.id === 'synthetic-back')).toMatchObject({ success: true, result: true });
    expect(JSON.stringify(messages.filter(entry => entry.diagnostic))).not.toContain('synthetic private content');
    window.ElecKoiPlatform.browserCommand = () => { throw new window.Error('Synthetic command failure'); };
    nativeCommand({ id: 'synthetic-failed', command: { type: 'back', payload: {} } });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(messages.find(entry => entry.diagnostic?.id === 'synthetic-failed' && entry.diagnostic.kind === 'page-error').diagnostic.stack).toContain('Synthetic command failure');
    expect(messages.find(entry => entry.id === 'synthetic-failed')).toMatchObject({ success: false, error: 'Error: Synthetic command failure' });
  } finally { window.close(); }
});
it('measures delayed foreground execution without treating background pause as page lag', () => {
  const dom = setup(), { window } = dom, entries = []; let callback, now = 0, hidden = false;
  try {
    Object.defineProperty(window.document, 'hidden', { get: () => hidden }); window.performance.now = () => now;
    window.setTimeout = fn => { callback = fn; return 1; };
    window.eval(collector); window.ElecKoiBrowserDiagnostics.install(entry => entries.push(entry));
    now = 9000; callback(); expect(entries.at(-1)).toMatchObject({ kind: 'page-performance', delayMs: 4000 });
    hidden = true; window.document.dispatchEvent(new window.Event('visibilitychange')); now = 100_000; callback();
    hidden = false; window.document.dispatchEvent(new window.Event('visibilitychange')); now += 5000; callback();
    expect(entries.filter(entry => entry.kind === 'page-performance')).toHaveLength(1);
  } finally { window.close(); }
});
it('bounds bridge traffic when repeated or distinct console errors flood the page', () => {
  const dom = setup(), { window } = dom, entries = []; let callback;
  try {
    window.console.error = () => {}; window.setTimeout = fn => { callback = fn; return 1; };
    window.eval(collector); window.ElecKoiBrowserDiagnostics.install(entry => entries.push(entry));
    for (let i = 0; i < 1000; i++) window.console.error('Synthetic repeat');
    expect(entries.filter(entry => entry.kind === 'page-error')).toHaveLength(1);
    for (let i = 0; i < 1000; i++) window.console.error(`Synthetic error ${i}`);
    expect(entries.filter(entry => entry.kind === 'page-error')).toHaveLength(16);
    callback();
    expect(entries.find(entry => entry.occurrences === 999)).toBeTruthy();
    expect(entries.find(entry => entry.kind === 'page-error-overflow')).toMatchObject({ occurrences: 985 });
  } finally { window.close(); }
});
