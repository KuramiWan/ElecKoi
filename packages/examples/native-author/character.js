import { derive } from '../derive.js';

export default context => {
  const stopRequest = context.api.scripts.registerHandler('calculate-score', ({ data }) => {
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.score !== 'number' || !Number.isFinite(data.score)) {
      throw new Error('score 必须是有限数字');
    }
    return derive(data.score, context.settings.multiplier ?? 2);
  });
  const stopRule = context.api.variables.registerRule({
    id: 'derive-score',
    stage: 'afterSchema',
    async run(candidate) {
      await Promise.resolve();
      candidate.signal.throwIfAborted();
      Object.assign(candidate.state, derive(candidate.state.score, context.settings.multiplier ?? 2));
    },
  });
  const stopButton = context.api.ui.registerButton({
    id: 'settings',
    label: '积分设置',
    async onClick({ api, signal }) {
      const response = await fetch(new URL('../settings.html', import.meta.url), { signal });
      if (!response.ok) throw new Error(`读取设置页面失败：${response.status}`);
      await api.ui.openPanel({ id: 'settings', title: '积分设置', html: await response.text() });
    },
  });
  return () => { stopRequest(); stopButton(); stopRule(); };
};
