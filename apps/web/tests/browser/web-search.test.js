import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { browserThemeCss } from '../helpers/browserTheme.js';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
it('keeps DeepSeek controls usable in desktop/mobile themes and submits the separate credential', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'eleckoi-web-search-'));
  try {
    await build({ entryPoints: ['apps/web/tests/browser/web-search.fixture.jsx'], outfile: resolve(directory, 'fixture.js'), bundle: true, format: 'iife', jsx: 'automatic', alias: { '@shared': resolve('packages/shared/src') }, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, logLevel: 'silent' });
    const html = resolve(directory, 'fixture.html'), report = resolve(directory, 'report.json');
    await writeFile(resolve(directory, 'theme.css'), browserThemeCss());
    await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(require('electron'), [resolve('apps/web/tests/browser/web-search.probe.cjs'), html, report], { env, windowsHide: true, timeout: 30000 });
    const result = JSON.parse(await readFile(report, 'utf8'));
    expect(result.layouts).toHaveLength(6);
    for (const layout of result.layouts) {
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport);
      for (const control of layout.controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(layout.viewport); }
    }
    expect(result.calls).toContainEqual({ needContent: true });
    expect(result.calls).toContainEqual({ credentialProvider: 'deepseek_api' });
    expect(result.cleared).toBe(true);
    expect(result.message).toContain('Search 和 Fetch 均连接正常');
  } finally { const child = relative(tmpdir(), directory); if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected cleanup target'); await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
}, 45000);
