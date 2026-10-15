import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');

it('aligns the brand and caption controls while preserving equal logo insets', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'eleckoi-caption-layout-'));
  try {
    await build({entryPoints:['apps/web/tests/browser/window-caption.fixture.jsx'],outfile:resolve(directory,'fixture.js'),
      bundle:true,format:'iife',jsx:'automatic',alias:{'@shared':resolve('packages/shared/src')},
      loader:{'.woff2':'file','.woff':'file','.ttf':'file','.png':'file'},logLevel:'silent'});
    const htmlPath=resolve(directory,'fixture.html'),reportPath=resolve(directory,'report.json');
    await writeFile(htmlPath,'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(require('electron'),[resolve('apps/web/tests/browser/window-caption.probe.cjs'),htmlPath,reportPath],
      {env,timeout:45000,windowsHide:true});
    const reports=JSON.parse(await readFile(reportPath,'utf8'));
    expect(reports).toHaveLength(3);
    for (const report of reports) {
      const detail=JSON.stringify(report);
      expect(report.windowCenters,detail).toHaveLength(3);
      for (const center of [report.nameCenter,report.toggleCenter,...report.windowCenters]) {
        expect(Math.abs(center-report.markCenter),detail).toBeLessThan(0.1);
      }
      expect(Math.abs(report.markTop-report.markLeft),detail).toBeLessThan(0.1);
      expect(Math.abs(report.mainTop-report.captionHeight),detail).toBeLessThan(0.1);
      if (report.rightbar) {
        expect(report.rightbarTop,detail).toBeCloseTo(report.mainTop,1);
        expect(report.resizeTop,detail).toBeCloseTo(report.mainTop,1);
        expect(report.stripTop+report.stripHeight,detail).toBeCloseTo(0,1);
        expect(report.stripHeight,detail).toBeCloseTo(report.captionHeight,1);
      }
    }
  } finally {
    await rm(directory,{recursive:true,force:true,maxRetries:3});
  }
},60000);
