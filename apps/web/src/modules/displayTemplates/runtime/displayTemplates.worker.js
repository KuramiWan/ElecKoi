import { evaluateDisplayTemplates } from './evaluateDisplayTemplates.js';

self.onmessage = async event => {
  try { self.postMessage({ ok: true, value: await evaluateDisplayTemplates(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
