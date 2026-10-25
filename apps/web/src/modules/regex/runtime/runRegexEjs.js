/** Each render owns its worker; source changes, close and cancellation release it. */
import { hasRegexEjsOutput } from '@shared/foundation/regex/RegexEjsMarkers';
export function runRegexEjs(input, { signal } = {}) {
  if (!hasRegexEjsOutput(input.content)) return Promise.resolve({ content: input.content });
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const worker = new Worker(new URL('./regexEjs.worker.js', import.meta.url), { type: 'module' });
    let done = false;
    const finish = (error, content) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', cancel); worker.terminate();
      if (error) reject(error); else resolve({ content });
    };
    const cancel = () => finish(signal.reason ?? new DOMException('正则 EJS 计算已取消。', 'AbortError'));
    worker.onmessage = event => {
      if (event.data?.ok && typeof event.data.content === 'string') finish(null, event.data.content);
      else if (event.data?.error && typeof event.data.error === 'object') finish(event.data.error);
      else finish(new Error(event.data?.error || '正则 EJS 返回无效结果。'));
    };
    worker.onerror = event => finish(new Error(event.message || '正则 EJS 执行失败。'));
    signal?.addEventListener('abort', cancel, { once: true });
    try { worker.postMessage(input); } catch (error) { finish(error); }
  });
}
