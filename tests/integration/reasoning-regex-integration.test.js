import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as Cordis from '@deepseek-ai/cordis';
import { expect, it, vi } from 'vitest';
import productDataPlugin from '../../packages/host/product-data/src/index.ts';
import { officialChatFixture } from '../helpers/officialTrajectory.js';
import { dshClientPlugin } from '../helpers/dshClientPlugin.ts';

it('displays regex-transformed reasoning from the official Session projection through real Host data, including after a database and Client reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-reasoning-integration-'));
  vi.stubEnv('ELECKOI_DATABASE_PATH', join(directory, 'synthetic.sqlite3'));
  vi.stubEnv('ELECKOI_MEDIA_ROOT', join(directory, 'media'));
  vi.stubEnv('ELECKOI_WORKSPACE_ROOT', directory);
  let ctx = new Cordis.Context(), catalog;
  try {
    await ctx.plugin(productDataPlugin);
    ctx.eleckoiProductData.createCharacter({ id: 'synthetic-character', name: 'Synthetic character' });
    const created = ctx.eleckoiProductData.createConversation({ metadata: { characterId: 'synthetic-character' } });
    const id = created.conversation.id;
    const rules = [{ id: 'synthetic-rule', name: 'Synthetic reasoning', pattern: '/SYNTHETIC/g', replacement: 'Changed reasoning',
      targets: ['Reasoning'], enabled: true, displayOnly: true, promptOnly: false, runOnEdit: false, order: 0 }];
    const initial = ctx.eleckoiProductData.readRegexRules('synthetic-character');
    ctx.eleckoiProductData.importRegexRules('synthetic-character', 'Global', [{ displayName: 'synthetic.json', json: JSON.stringify(rules) }], initial.revision);
    const event = (type, seq, data, surfaceOp) => ({ type, seq, time: seq * 100, data, ...(surfaceOp ? { surfaceOp } : {}) });
    const events = [
      event('turn/start', 1, { turn: 1 }), event('step/start', 2, { turn: 1, step: 1 }),
      event('user/message', 3, { id: 'synthetic-input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic input' }] }, 'append'),
      event('assistant/message', 4, { turn: 1, step: 1, stream: [], message: {
        id: 'synthetic-reply', role: 'assistant', source: { provider: 'synthetic', model: 'synthetic' },
        content: [{ type: 'reasoning', text: 'SYNTHETIC' }, { type: 'text', text: '<FINAL>Synthetic final reply</FINAL>' }],
      } }, 'append'), event('step/end', 5, { turn: 1, step: 1 }), event('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
    ];
    const transcript = JSON.stringify(events);
    const reopen = async () => {
      let registration;
      runInNewContext(readFileSync(resolve('packages/client/features/dsh-client-conversations/src/client.js'), 'utf8'), {
        AbortController, console, setTimeout, clearTimeout,
        window: { __ModuleLoader__: { load: value => { registration = value; } } },
      });
      const projectDisplay = vi.fn(async (conversationId, messages) => ({ ok: true, value: ctx.eleckoiProductData.projectConversationMessages(conversationId, messages) }));
      dshClientPlugin(registration).apply({ remote: { eleckoiConversations: { projectDisplay } },
        provide: (_name, value) => { catalog = value; }, effect() {}, on: () => () => {} });
      const chat = officialChatFixture().replace(events);
      const session = { getSnapshot: () => ({ running: false }), projections: { faceOf: () => undefined } };
      const details = ctx.eleckoiProductData.readConversationDetails(id);
      catalog.detailsSnapshot = { id, status: 'ready', error: '', details: { ...details, messages: [],
        runtimeSessionId: 'synthetic-session', runtimeVariableStateByTurn: {}, hasMore: false } };
      catalog.sessionReference = { sessionId: 'synthetic-session', binding: { session,
        eventSource: { getSnapshot: () => ({ hasMore: false, entries: events.map(event => ({ type: 'event', event })) }) } }, release() {} };
      catalog.acceptOfficialSession(id, 'synthetic-session', session, { getSnapshot: () => chat });
      for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve));
      const reply = catalog.getDetailsSnapshot().details.messages.find(message => message.id === 'synthetic-reply');
      expect(reply.displayContent).toBe('Synthetic final reply');
      expect(reply.process.find(item => item.kind === 'reasoning')).toMatchObject({ detail: 'SYNTHETIC', displayDetail: 'Changed reasoning' });
      expect(projectDisplay.mock.calls[0][1].find(message => message.id === reply.id).reasoning[0].text).toBe('SYNTHETIC');
      expect(JSON.stringify(events)).toBe(transcript);
    };
    await reopen();
    catalog.dispose(); catalog = undefined;
    await ctx.fiber.dispose(); ctx = new Cordis.Context(); await ctx.plugin(productDataPlugin);
    await reopen();
  } finally { catalog?.dispose(); await ctx.fiber.dispose(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
}, 30000);
