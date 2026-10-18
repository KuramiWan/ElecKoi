import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { BROWSER_LIBRARY_SCRIPTS, BROWSER_LIBRARY_STYLES } from '@eleckoi/dsh-client-html-resources/browser-libraries';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
it('keeps shared and native rich message corners transparent across client themes and window sizes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'eleckoi-rich-corners-'));
  try {
    await build({ entryPoints: ['apps/web/tests/browser/rich-message-corners.fixture.js'], outfile: resolve(directory, 'fixture.js'), bundle: true,
      format: 'iife', alias: { '@shared': resolve('packages/shared/src') }, loader: { '.png': 'file', '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, logLevel: 'silent' });
    for (const file of [...BROWSER_LIBRARY_SCRIPTS, ...BROWSER_LIBRARY_STYLES]) {
      const destination = resolve(directory, 'libraries', file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve('packages/client/features/dsh-client-html-resources/assets', file), destination);
    }
    const htmlPath = resolve(directory, 'fixture.html'), reportPath = resolve(directory, 'report.json');
    await writeFile(htmlPath, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0;padding:8px}</style></head><body><script src="fixture.js"></script></body></html>');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(require('electron'), [resolve('apps/web/tests/browser/rich-message-corners.probe.cjs'), htmlPath, reportPath], { env, timeout: 45000, windowsHide: true });
    const reports = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(reports).toHaveLength(16);
    for (const report of reports) {
      const evidence = JSON.stringify(report);
      expect(report.frameScheme, evidence).toBe(report.scheme);
      expect(report.preferredDark, evidence).toBe(report.scheme === 'dark');
      expect(report.cardColor, evidence).toBe('rgb(21, 36, 60)');
      expect(report.height, evidence).toBe(64);
      if (report.authoredScheme) expect(report.htmlScheme, evidence).toBe('light only');
      else for (const corner of report.corners) expect(corner, evidence).toEqual([80, 64, 40, 255]);
    }
  } finally {
    const path = relative(tmpdir(), directory);
    if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Unexpected fixture path');
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}, 60000);
