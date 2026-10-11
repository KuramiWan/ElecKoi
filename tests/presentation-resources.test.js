import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as libraries from '@eleckoi/compatibility-tavern-shared';
import { TavernSharedClient } from '../packages/client/features/dsh-client-tavern-shared/src/runtime.js';
import { createAuthorAssetHandler } from '../packages/host/compatibility-host/src/assets.js';

describe('presentation-only resources', () => {
  it('starts and stops without installing external SDK globals or requesting author capabilities', () => {
    const window = new EventTarget(); window.Event = Event;
    const runtime = new TavernSharedClient({ window, sdk: libraries, assetsBaseUrl: '/eleckoi/compat/' });
    runtime.start();
    expect(window.__ElecKoiClientCompatibility).toBe(runtime);
    expect(runtime.getSnapshot()).toEqual({ status: 'ready', error: '' });
    for (const name of ['TavernHelper', 'Mvu', 'SillyTavern', 'ElecKoi']) expect(window[name]).toBeUndefined();
    for (const name of ['installSharedFrame', 'installTavernCompatibility', 'installHostAdapter']) expect(libraries[name]).toBeUndefined();
    for (const name of ['prepareDocument', 'registerChatUi', 'setEnvironment', 'registerFrontendTargets']) expect(runtime[name]).toBeUndefined();
    runtime.dispose();
    expect(window.__ElecKoiClientCompatibility).toBeUndefined();
  });

  it('serves declared libraries but rejects old executable resources even if stale files exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-presentation-'));
    try {
      mkdirSync(join(root, 'assets'));
      for (const file of ['tavern-shared.global.js', 'mvu-engine.js', 'mvu-schema.js']) writeFileSync(join(root, file), 'synthetic bytes');
      writeFileSync(join(root, 'assets', 'jquery.min.js'), 'synthetic library');
      const handler = createAuthorAssetHandler(root);
      const request = async (path, method = 'GET') => {
        const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
        await handler({ url: '/eleckoi/compat/' + path, method }, response);
        return response;
      };
      expect((await request('assets/tavern-shared.global.js')).status).toBe(200);
      expect((await request('assets/assets/jquery.min.js')).body.toString()).toBe('synthetic library');
      expect((await request('assets/assets/jquery.min.js', 'HEAD')).body).toBeUndefined();
      for (const path of ['assets/mvu-engine.js', 'assets/mvu-schema.js', 'plugin/synthetic/index.html', 'panel/synthetic']) {
        expect((await request(path)).status).toBe(404);
      }
      expect((await request('assets/assets/%2e%2e%2fmvu-engine.js')).status).toBe(403);
      expect((await request('assets/tavern-shared.global.js', 'POST')).status).toBe(405);
    } finally {
      const child = relative(tmpdir(), root);
      if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected test cleanup path');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
