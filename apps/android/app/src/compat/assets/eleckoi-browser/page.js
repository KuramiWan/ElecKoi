(() => {
  const markBrowser = () => document.documentElement.setAttribute('data-eleckoi-browser', 'compat');
  if (document.documentElement) markBrowser();
  else document.addEventListener('DOMContentLoaded', markBrowser, { once: true });
  const pending = new Map();
  const diagnostic = entry => window.postMessage({ type: 'eleckoi:gecko-diagnostic', entry }, location.origin);
  window.ElecKoiBrowserDiagnostics?.install(diagnostic);
  window.ElecKoiAndroidTransport = {
    invoke(method, argumentsJson) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => { pending.delete(id); diagnostic({ kind: 'bridge-timeout', id, command: method, pending: pending.size }); reject(new Error(`Android operation timed out: ${method}`)); }, 30000);
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
      const started = performance.now(), command = message.command.type;
      if (command === 'back') diagnostic({ kind: 'browser-command', id: message.id, command, stage: 'page-received', pageMs: started });
      try {
        if (!window.ElecKoiPlatform) throw new Error('Android platform facade is not ready');
        const result = window.ElecKoiPlatform.browserCommand(message.command);
        if (command === 'back') diagnostic({ kind: 'browser-command', id: message.id, command, stage: 'page-completed', elapsedMs: performance.now() - started });
        window.postMessage({ type: 'eleckoi:gecko-command-result', id: message.id, command, success: true, result }, location.origin);
      } catch (error) {
        diagnostic({ kind: 'page-error', stage: 'browser-command', id: message.id, command, name: error.name, message: error.message, stack: error.stack });
        window.postMessage({ type: 'eleckoi:gecko-command-result', id: message.id, command, success: false, error: String(error) }, location.origin);
      }
    }
  });
})();
