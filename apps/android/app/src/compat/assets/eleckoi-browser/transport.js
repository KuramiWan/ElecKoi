(() => {
  const port = browser.runtime.connectNative('eleckoi_page');
  port.onMessage.addListener(message => window.postMessage({ type: 'eleckoi:gecko-command', ...message }, location.origin));
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'eleckoi:gecko-request' && typeof message.id === 'string') {
      let result;
      try { result = await browser.runtime.sendNativeMessage('eleckoi', { method: message.method, arguments: message.arguments }); }
      catch (error) { result = JSON.stringify({ success: false, error: String(error) }); }
      window.postMessage({ type: 'eleckoi:gecko-result', id: message.id, result }, location.origin);
    } else if (message?.type === 'eleckoi:gecko-command-result') {
      port.postMessage(message);
    }
  });
})();
