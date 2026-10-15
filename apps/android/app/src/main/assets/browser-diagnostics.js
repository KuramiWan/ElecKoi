(() => {
  if (window.ElecKoiBrowserDiagnostics) return;
  let sink, timer;
  const emit = event => { try { sink?.(event); } catch { /* Diagnostics must not interrupt platform operations. */ } };
  const errors = new Map(); let dropped = 0;
  const reportError = event => {
    const key = JSON.stringify(event), known = errors.get(key);
    if (known) { known.repeats++; return; }
    if (errors.size >= 16) { dropped++; return; }
    errors.set(key, { event, repeats: 0 }); emit(event);
  };
  const errorFields = value => value && typeof value === 'object'
    ? { name: typeof value.name === 'string' ? value.name : 'Error', message: typeof value.message === 'string' ? value.message.slice(0, 2048) : 'Non-Error rejection', stack: typeof value.stack === 'string' ? value.stack.slice(0, 8192) : '' }
    : { name: 'Error', message: String(value).slice(0, 2048), stack: '' };
  window.ElecKoiBrowserDiagnostics = { emit, install(send) {
    if (sink) return;
    sink = send;
    window.addEventListener('error', event => reportError({ kind: 'page-error', ...errorFields(event.error || event.message || 'Page resource failed'), source: event.filename || '', line: event.lineno || 0, column: event.colno || 0 }));
    window.addEventListener('unhandledrejection', event => reportError({ kind: 'page-error', stage: 'unhandledrejection', ...errorFields(event.reason) }));
    for (const level of ['error', 'warn']) {
      const original = console[level];
      console[level] = (...values) => {
        // Object payloads may contain product content; only explicit errors and primitive summaries are retained.
        const error = values.find(value => value && typeof value === 'object' && typeof value.stack === 'string');
        const summary = values.filter(value => typeof value === 'string').map(value => value.slice(0, 512)).slice(0, 3).join(' ');
        reportError({ kind: 'page-error', stage: 'console', level, ...errorFields(error || summary || 'Console object omitted') });
        original.apply(console, values);
      };
    }
    let scheduled = performance.now(), wasVisible = !document.hidden, ticks = 0;
    const sample = () => {
      for (const { event, repeats } of errors.values()) if (repeats) emit({ ...event, occurrences: repeats });
      errors.clear(); if (dropped) emit({ kind: 'page-error-overflow', occurrences: dropped }); dropped = 0;
      const now = performance.now(), visible = !document.hidden, delayMs = Math.max(0, now - scheduled - 5000);
      if (visible && wasVisible && (delayMs > 250 || ++ticks % 12 === 0)) emit({ kind: 'page-performance', delayMs, visible, pageMs: now });
      scheduled = now; wasVisible = visible; timer = setTimeout(sample, 5000);
    };
    document.addEventListener('visibilitychange', () => { scheduled = performance.now(); wasVisible = !document.hidden; });
    timer = setTimeout(sample, 5000);
    window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
    emit({ kind: 'page-lifecycle', stage: 'diagnostics-ready' });
  } };
})();
