import { evaluateRegexEjs } from '@shared/foundation/regex/RegexEjs.js';
self.onmessage = async event => {
  try { self.postMessage({ ok: true, content: await evaluateRegexEjs(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error?.isDSHRemoteError === true && typeof error.code === 'string'
    ? { isDSHRemoteError: true, code: error.code, message: error.message, details: error.details }
    : error instanceof Error ? error.message : String(error) }); }
};
