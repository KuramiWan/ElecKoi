import { derive } from '../derive.js';

export default context => {
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
  return () => { stopButton(); stopRule(); };
};
