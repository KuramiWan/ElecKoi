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
it('bulk switches actual editor entries and keeps source editing immersive on desktop and narrow windows', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'eleckoi-editor-enablement-'));
  try {
    await build({ entryPoints: ['apps/web/tests/browser/editor-enablement.fixture.jsx'], outfile: resolve(directory, 'fixture.js'), bundle: true,
      format: 'iife', jsx: 'automatic', alias: { '@shared': resolve('packages/shared/src') },
      loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, logLevel: 'silent' });
    const htmlPath = resolve(directory, 'fixture.html'), reportPath = resolve(directory, 'report.json');
    await writeFile(resolve(directory, 'theme.css'), browserThemeCss());
    await writeFile(htmlPath, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(require('electron'), [resolve('apps/web/tests/browser/editor-enablement.probe.cjs'), htmlPath, reportPath], { env, timeout: 45000, windowsHide: true });
    const reports = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(reports).toHaveLength(12);
    for (const report of reports) {
      const { before, off, afterSave, restored, itemOff } = report, evidence = JSON.stringify(report);
      expect(before.nameColors.length, evidence).toBeGreaterThan(0);
      expect(before.text, evidence).not.toBe(before.muted);
      expect(before.nameColors.every(color => color === before.text), evidence).toBe(true);
      for (const state of [off, afterSave]) {
        expect(state.scopeOn, evidence).toBe(false);
        expect(state.nameColors.every(color => color === state.muted), evidence).toBe(true);
        expect(state.itemStates.every(enabled => !enabled), evidence).toBe(true);
      }
      expect(restored.nameColors, evidence).toEqual(before.nameColors);
      expect(restored.itemStates.every(Boolean), evidence).toBe(true);
      expect(itemOff.nameColors.every(color => color === itemOff.muted), evidence).toBe(true);
    }
    expect(reports[0].immersive).toHaveLength(4);
    expect(reports[0].sourceActions).toHaveLength(2);
    for (const report of reports[0].sourceActions) {
      expect(report.headerTest).toBe(false);
      expect(report.buttons).toHaveLength(2);
      expect(report.buttons[0].height).toBe(report.buttons[1].height);
      for (const button of report.buttons) {
        expect(button.left).toBeGreaterThanOrEqual(report.heading.left - 1);
        expect(button.right).toBeLessThanOrEqual(report.heading.right + 1);
        expect(button.top).toBeGreaterThanOrEqual(report.heading.top - 1);
        expect(button.bottom).toBeLessThanOrEqual(report.heading.bottom + 1);
      }
    }
    for (const report of reports[0].immersive) {
      expect(report.left).toBe(0); expect(report.top).toBe(0);
      expect(report.right).toBe(report.width); expect(report.bottom).toBe(report.height);
      expect(report.editorHeight).toBeGreaterThan(200);
      expect(report.code).toBe('pre'); expect(report.preview).toBe(false);
      expect(report.synced).toBe(report.content);
    }
  } finally {
    const path = relative(tmpdir(), directory);
    if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Unexpected fixture path');
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}, 60000);
