(() => {
  function connect() {
    const port = browser.runtime.connectNative('eleckoi_control');
    port.onDisconnect.addListener(() => setTimeout(connect, 250));
    port.onMessage.addListener(async message => {
      try {
        const url = new URL(message.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('Invalid local Host cookie origin');
        let result;
        if (message.operation === 'get') {
          result = (await browser.cookies.getAll({ url: message.url })).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
        } else if (message.operation === 'set') {
          const parts = message.header.split(';').map(part => part.trim());
          const equals = parts[0].indexOf('=');
          if (equals <= 0) throw new Error('Invalid Host cookie');
          const name = parts[0].slice(0, equals), value = parts[0].slice(equals + 1);
          if (!/^dsh-auth-[A-Za-z0-9_-]{43}$/.test(name)) throw new Error('Unsupported Host cookie name');
          const attributes = new Map(parts.slice(1).map(part => {
            const equals = part.indexOf('=');
            return equals < 0 ? [part.toLowerCase(), true] : [part.slice(0, equals).toLowerCase(), part.slice(equals + 1)];
          }));
          if (attributes.get('max-age') === '0') { await browser.cookies.remove({ url: message.url, name }); result = true; }
          else {
            const details = { url: message.url, name, value, path: attributes.get('path') || '/', httpOnly: attributes.has('httponly'), secure: attributes.has('secure') };
            if (attributes.has('domain')) {
              if (attributes.get('domain') !== url.hostname) throw new Error('Host cookie domain mismatch');
              details.domain = attributes.get('domain');
            }
            if (attributes.has('samesite')) {
              const policy = { strict: 'strict', lax: 'lax', none: 'no_restriction' }[String(attributes.get('samesite')).toLowerCase()];
              if (!policy) throw new Error('Unsupported Host cookie SameSite');
              details.sameSite = policy;
            }
            if (attributes.has('max-age')) {
              const age = Number(attributes.get('max-age'));
              if (!Number.isSafeInteger(age) || age <= 0) throw new Error('Invalid Host cookie Max-Age');
              details.expirationDate = Date.now() / 1000 + age;
            } else if (attributes.has('expires')) {
              const expires = Date.parse(attributes.get('expires'));
              if (!Number.isFinite(expires)) throw new Error('Invalid Host cookie Expires');
              details.expirationDate = expires / 1000;
            }
            const cookie = await browser.cookies.set(details);
            if (!cookie || cookie.name !== name || cookie.value !== value) throw new Error('Host cookie was not installed');
            result = true;
          }
        } else throw new Error('Unknown browser control operation');
        port.postMessage({ id: message.id, success: true, result });
      } catch (error) { port.postMessage({ id: message.id, success: false, error: String(error) }); }
    });
  }
  connect();
})();
