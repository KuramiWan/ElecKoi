(() => {
  const port = browser.runtime.connectNative('eleckoi_page');
  const diagnostic = entry => { try { port.postMessage({ diagnostic: entry }); } catch { /* Native disconnect is recorded by the shell. */ } };
  port.onMessage.addListener(message => {
    if (message.command?.type === 'back') diagnostic({ kind: 'browser-command', id: message.id, command: 'back', stage: 'extension-received' });
    window.postMessage({ type: 'eleckoi:gecko-command', ...message }, location.origin);
  });
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'eleckoi:gecko-request' && typeof message.id === 'string') {
      let result;
      try { result = await browser.runtime.sendNativeMessage('eleckoi', { method: message.method, arguments: message.arguments }); }
      catch (error) { result = JSON.stringify({ success: false, error: String(error) }); }
      window.postMessage({ type: 'eleckoi:gecko-result', id: message.id, result }, location.origin);
    } else if (message?.type === 'eleckoi:gecko-command-result') {
      if (message.command === 'back') diagnostic({ kind: 'browser-command', id: message.id, command: 'back', stage: 'extension-result', success: message.success === true });
      port.postMessage(message);
    } else if (message?.type === 'eleckoi:gecko-diagnostic' && message.entry && typeof message.entry === 'object') {
      diagnostic(message.entry);
    }
  });
})();
