import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';

/** 每次计算拥有独立 worker；取消、超时和结束都释放该 worker。 */
export function runDisplayTemplates(input, { signal, timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('显示模板计算已取消。', 'AbortError')); return; }
    const worker = new Worker(new URL('./displayTemplates.worker.js', import.meta.url), { type: 'module' });
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(new DOMException('显示模板计算已取消。', 'AbortError'));
    const timer = setTimeout(() => finish(new DesktopError(ELECKOI_FAILURE_CODES.timeoutExpired, '显示模板计算超过 3 秒，已停止。', { what: '显示模板计算' })), timeout);
    worker.onmessage = event => {
      const value = event.data?.value;
      if (event.data?.ok && typeof value?.content === 'string' && Array.isArray(value.errors)) finish(null, value);
      // worker 只带回了开发者诊断（码在 worker 边界上已经丢了），兜底码不写 what，诊断才到得了用户眼前。
      else if (typeof event.data?.error === 'string') finish(new DesktopError(ELECKOI_FAILURE_CODES.internal, event.data.error));
      else finish(new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '显示模板返回无效结果。', { what: '显示模板结果' }));
    };
    worker.onerror = event => finish(new DesktopError(ELECKOI_FAILURE_CODES.internal, event.message || '显示模板执行失败。'));
    signal?.addEventListener('abort', cancel, { once: true });
    try { worker.postMessage(input); } catch (error) { finish(error); }
  });
}
