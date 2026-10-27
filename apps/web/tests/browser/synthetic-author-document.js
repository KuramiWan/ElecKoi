import { installElecKoiAuthorApi } from '@eleckoi/author-sdk/browser';

/** A native SDK transport with only the capabilities needed by static documents. */
export function mountSyntheticAuthorDocument(page, conversationId, messageId) {
  const methods = {
    'context.current': () => ({ surface: 'message-renderer', scope: 'current-character', conversationId, messageId, characterId: 'synthetic-character' }),
    'app.getCapabilities': () => Object.keys(methods).map(method => ({ method })),
    'events.list': () => ({ items: [] }),
  };
  installElecKoiAuthorApi(page, {
    request: async (method, params) => {
      if (!Object.hasOwn(methods, method)) throw new Error(`Synthetic method unavailable: ${method}`);
      return methods[method](params);
    },
    on: () => { throw new Error('Synthetic events unavailable'); },
  });
  return () => page.dispatchEvent(new page.Event('pagehide'));
}
