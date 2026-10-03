import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { installRequestConfig, projectCompactionRequest } from '../resources/dsh/request-config.mjs';

describe('DSH request configuration', () => {
  it('overrides a persisted legacy route with the model frozen for the current turn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-request-route-'));
    try {
      const path = join(root, 'session-a.json');
      writeFileSync(path, JSON.stringify({
        model: { provider: 'legacy-provider-label', model: 'synthetic-model' },
      }));
      const listeners = new Map();
      const agentCtx = {
        on(name, listener) {
          listeners.set(name, listener);
          return () => undefined;
        },
        llm: { stream: vi.fn() },
      };
      installRequestConfig(agentCtx, root, 'session-a');
      await listeners.get('system-prompt/assemble')({}, {}, async () => ({ variables: {} }));

      writeFileSync(path, JSON.stringify({
        model: {
          provider: 'current-provider-route', model: 'synthetic-model',
          reasoningEffort: 'high', temperature: 0.4, topP: 0.9, maxTokens: 8_000,
        },
      }));
      const resolved = await listeners.get('agent/request')({}, async () => ({
        provider: 'legacy-provider-label', model: 'synthetic-model', reasoningEffort: 'low',
        temperature: 0.1, topP: 0.2, maxTokens: 1_000, purpose: 'agent',
      }));

      expect(resolved).toEqual({
        provider: 'current-provider-route', model: 'synthetic-model', reasoningEffort: 'high',
        temperature: 0.4, topP: 0.9, maxTokens: 8_000, purpose: 'agent',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('replaces only the final compaction instruction with the active preset template', () => {
    const first = { id: 'earlier', role: 'user', content: [{ type: 'text', text: '较早对话' }] };
    const upstream = { id: 'upstream', role: 'user', content: [{ type: 'text', text: 'DSH 默认英文压缩模板' }] };
    const projected = projectCompactionRequest({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      purpose: 'compaction',
      reasoningEffort: 'high',
      tools: [{ name: 'read', description: 'read', parameters: {} }],
      messages: [first, upstream],
    }, '请用中文保留角色状态和未完成剧情。', 'low');

    expect(projected.messages[0]).toBe(first);
    expect(projected.messages[1]).toMatchObject({ id: 'upstream', role: 'user' });
    expect(projected.messages[1].content[0].text).toContain('请用中文保留角色状态和未完成剧情。');
    expect(projected.messages[1].content[0].text).not.toContain('DSH 默认英文压缩模板');
    expect(projected).not.toHaveProperty('tools');
    expect(projected.reasoningEffort).toBe('high');
  });

  it('leaves ordinary requests and blank preset templates untouched', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: '你好' }] }];
    expect(projectCompactionRequest({ purpose: undefined, messages }, '模板')).toBeUndefined();
    expect(projectCompactionRequest({ purpose: 'compaction', messages }, '   ')).toBeUndefined();
  });

  it('inherits the active main-model reasoning effort when compaction has no explicit override', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: '上游默认模板' }] }];
    const projected = projectCompactionRequest({
      provider: 'example-provider', model: 'always-thinking-model', purpose: 'compaction', messages,
    }, '   ', 'low');

    expect(projected).toMatchObject({ reasoningEffort: 'low', messages });
  });

  it('keeps the durable prompt definition out of compaction input', () => {
    const history = { id: 'history', role: 'assistant', content: [{ type: 'text', text: '较早回复' }] };
    const projection = {
      id: 'eleckoi-request-projection:v1',
      role: 'user',
      source: { kind: 'plugin:eleckoi-request-projection' },
      content: [{ type: 'text', text: 'ELECKOI_REQUEST_PROJECTION_V1\n[]' }],
    };
    const upstream = { id: 'upstream', role: 'user', content: [{ type: 'text', text: 'DSH 默认英文压缩模板' }] };

    const customized = projectCompactionRequest({
      purpose: 'compaction',
      messages: [history, projection, upstream],
    }, '请保留剧情状态。');
    expect(customized.messages).toHaveLength(2);
    expect(customized.messages).not.toContain(projection);
    expect(customized.messages[0]).toBe(history);
    expect(customized.messages[1].content[0].text).toContain('请保留剧情状态。');

    const upstreamOnly = projectCompactionRequest({
      purpose: 'compaction',
      messages: [history, projection, upstream],
    }, '   ');
    expect(upstreamOnly.messages).toEqual([history, upstream]);
  });

  it('routes a compaction through the public DSH llm stream with the session preset template', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-request-config-'));
    try {
      writeFileSync(join(root, 'session-a.json'), JSON.stringify({
        model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' },
        historyCompactionInstructions: '只保留角色状态与剧情伏笔。',
      }));
      const listeners = new Map();
      const disposers = [];
      let streamListener;
      const terminal = vi.fn((request) => request);
      const agentCtx = {
        on(name, listener) {
          listeners.set(name, listener);
          if (name === 'llm/stream') streamListener = listener;
          const dispose = vi.fn();
          disposers.push(dispose);
          return dispose;
        },
        llm: {
          stream(request) {
            return streamListener(request, () => terminal(request));
          },
        },
      };
      const dispose = installRequestConfig(agentCtx, root, 'session-a');
      const options = deepFreeze({
        provider: 'deepseek-official', model: 'deepseek-flash', purpose: 'compaction',
        tools: [{ name: 'read', description: 'read', parameters: {} }],
        messages: [{ role: 'user', content: [{ type: 'text', text: '上游默认模板' }] }],
      });
      const frozenMessages = options.messages;
      const originalContinuation = vi.fn(() => {
        throw new Error('the frozen request must be replaced before terminal dispatch');
      });

      const projected = listeners.get('llm/stream')(options, originalContinuation);
      expect(originalContinuation).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledOnce();
      expect(options.messages).toBe(frozenMessages);
      expect(projected).not.toBe(options);
      expect(projected.messages[0].content[0].text).toContain('只保留角色状态与剧情伏笔。');
      expect(projected).not.toHaveProperty('tools');
      expect(projected.reasoningEffort).toBe('low');

      dispose();
      expect(disposers.every((entry) => entry.mock.calls.length === 1)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
