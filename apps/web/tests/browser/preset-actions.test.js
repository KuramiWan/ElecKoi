import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
it('keeps position actions above adjacent rows and allows deleting the last update with failure recovery', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'eleckoi-preset-actions-'));
  try {
    await build({ entryPoints: ['apps/web/tests/browser/preset-actions.fixture.jsx'], outfile: resolve(directory, 'fixture.js'), bundle: true,
      format: 'iife', jsx: 'automatic', alias: { '@shared': resolve('packages/shared/src') },
      loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, logLevel: 'silent', plugins: [{ name: 'inline-css', setup(builder) {
        builder.onResolve({ filter: /\.css\?inline$/ }, args => ({ path: resolve(dirname(args.importer), args.path.replace(/\?inline$/, '')), namespace: 'inline-css' }));
        builder.onLoad({ filter: /.*/, namespace: 'inline-css' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
      } }] });
    const htmlPath = resolve(directory, 'fixture.html'), reportPath = resolve(directory, 'report.json');
    await writeFile(htmlPath, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(require('electron'), [resolve('apps/web/tests/browser/preset-actions.probe.cjs'), htmlPath, reportPath], { env, timeout: 45000, windowsHide: true });
    const reports = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(reports).toHaveLength(4);
    for (const report of reports) {
      expect(report.menu.targets, JSON.stringify(report)).toEqual([true, true]);
      expect(report.menu.withinViewport, JSON.stringify(report)).toBe(true);
      expect(report.menu.detached).toBe(true);
      expect(report.correctPosition).toBe(true);
      expect(report.failurePreserved).toBe(true);
      expect(report.empty).toBe('暂无更新记录');
    }
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
}, 60000);
