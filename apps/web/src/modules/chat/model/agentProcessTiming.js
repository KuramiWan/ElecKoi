export function formatLiveRunDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

export function isProcessTimingRunning(message) {
  return (message?.pending === true || message?.status === 'streaming' || message?.status === 'running')
    && Number.isFinite(message?.processTiming?.startedAtMillis)
    && !Number.isFinite(message?.processTiming?.completedAtMillis);
}

export function processDurationText(message, now) {
  const start = message?.processTiming?.startedAtMillis;
  const end = message?.processTiming?.completedAtMillis;
  if (!Number.isFinite(start)) return '';
  const stop = Number.isFinite(end) ? end : isProcessTimingRunning(message) ? now : undefined;
  return Number.isFinite(stop) ? formatLiveRunDuration(Math.max(1000, stop - start)) : '';
}
