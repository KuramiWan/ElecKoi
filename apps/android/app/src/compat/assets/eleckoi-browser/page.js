(() => {
  const markBrowser = () => document.documentElement.setAttribute('data-eleckoi-browser', 'compat');
  if (document.documentElement) markBrowser();
  else document.addEventListener('DOMContentLoaded', markBrowser, { once: true });
  const pending = new Map();
  window.ElecKoiAndroidTransport = {
    invoke(method, argumentsJson) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Android operation timed out: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timeout });
        window.postMessage({ type: 'eleckoi:gecko-request', id, method, arguments: JSON.parse(argumentsJson) }, location.origin);
      });
    }
  };
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'eleckoi:gecko-result') {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout); pending.delete(message.id);
      request.resolve(message.result);
    } else if (message?.type === 'eleckoi:gecko-command') {
      try {
        if (!window.ElecKoiPlatform) throw new Error('Android platform facade is not ready');
        const result = window.ElecKoiPlatform.browserCommand(message.command);
        window.postMessage({ type: 'eleckoi:gecko-command-result', id: message.id, success: true, result }, location.origin);
      } catch (error) {
        window.postMessage({ type: 'eleckoi:gecko-command-result', id: message.id, success: false, error: String(error) }, location.origin);
      }
    }
  });
  const report = (level, message, source, line) => window.ElecKoiAndroidTransport.invoke('browserConsole', JSON.stringify([level, message, source, line])).catch(() => {});
  window.addEventListener('error', event => report('ERROR', event.message || 'Page resource failed', event.filename || location.href, event.lineno || 0));
  window.addEventListener('unhandledrejection', event => report('ERROR', String(event.reason), location.href, 0));
  for (const level of ['error', 'warn']) {
    const original = console[level];
    console[level] = (...values) => { report(level, values.map(String).join(' '), location.href, 0); original(...values); };
  }
})();
