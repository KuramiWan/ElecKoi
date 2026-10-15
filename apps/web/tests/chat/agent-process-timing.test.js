import { describe, expect, it } from 'vitest';
import { processDurationText } from '../../src/modules/chat/model/agentProcessTiming.js';

describe('processing duration from official turn boundaries', () => {
  it('keeps completed reasoning duration fixed even when items lack completion times', () => {
    const message = { status: 'complete', processTiming: { startedAtMillis: 1000, completedAtMillis: 44000 },
      process: [{ kind: 'reasoning', status: 'complete', startedAtMillis: 3000 }] };
    expect(processDurationText(message, 50000)).toBe('43秒');
    expect(processDurationText(message, 3650000)).toBe('43秒');
  });
  it('updates only an open running turn and freezes at its formal end', () => {
    const message = { pending: true, processTiming: { startedAtMillis: 1000 } };
    expect(processDurationText(message, 45000)).toBe('44秒');
    expect(processDurationText({ ...message, processTiming: { startedAtMillis: 1000, completedAtMillis: 44000 } }, 45000)).toBe('43秒');
  });
  it('does not infer missing turn boundaries from loaded process items or the current clock', () => {
    expect(processDurationText({ status: 'complete', process: [{ startedAtMillis: 1000, completedAtMillis: 2000 }] }, 100000)).toBe('');
    expect(processDurationText({ status: 'complete', processTiming: { startedAtMillis: 1000 } }, 100000)).toBe('');
    expect(processDurationText({ pending: true, processTiming: { completedAtMillis: 2000 } }, 100000)).toBe('');
  });
});
