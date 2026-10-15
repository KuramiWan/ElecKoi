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
it('stops shared and native document timers outside the running floors across desktop and mobile sizes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'eleckoi-rich-limit-'));
  try {
    await build({ entryPoints: ['tests/browser/rich-message-limit.fixture.jsx'], outfile: resolve(directory, 'fixture.js'),
      bundle: true, format: 'iife', loader: { '.png': 'file', '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, logLevel: 'silent' });
    for (const file of [...BROWSER_LIBRARY_SCRIPTS, ...BROWSER_LIBRARY_STYLES]) {
      const destination = resolve(directory, 'libraries', file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve('packages/client/features/dsh-client-html-resources/assets', file), destination);
    }
    const htmlPath = resolve(directory, 'fixture.html'), reportPath = resolve(directory, 'report.json');
    await writeFile(htmlPath, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(require('electron'), [resolve('tests/browser/rich-message-limit.probe.cjs'), htmlPath, reportPath], { env, timeout: 45000, windowsHide: true });
    const reports = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(reports).toHaveLength(4);
    for (const report of reports) {
      expect(report.overflow).toBe(false);
      expect(report.heights).toEqual(['64px', '64px', '64px', '64px']);
      expect(report.releasesAfter - report.releasesBefore).toBe(4);
      for (const native of [false, true]) {
        for (const old of ['older-a', 'older-b']) {
          const key = `${report.id}-${old}-${native}`;
          expect(report.after[key]).toBe(report.before[key]);
        }
        const key = `${report.id}-latest-${native}`;
        expect(report.after[key]).toBeGreaterThan(report.before[key]);
      }
    }
  } finally {
    const path = relative(tmpdir(), directory);
    if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Unexpected fixture path');
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}, 60000);
