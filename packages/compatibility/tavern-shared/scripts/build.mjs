import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'dist');
if (path.relative(root, output) !== 'dist') throw new Error('Invalid build output directory');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
await import('./build-tavern-runtime.mjs');
await build({ entryPoints: [path.join(root, 'src/index.js')], bundle: true, format: 'iife', globalName: 'ElecKoiTavernShared',
  target: 'chrome108', sourcemap: true, outfile: path.join(root, 'dist/tavern-shared.global.js') });
await build({ entryPoints: ['zod-module', 'lodash-module'].map(name => path.join(root, 'src', name + '.js')),
  format: 'esm', target: 'chrome108', outdir: path.join(root, 'dist') });
await cp(path.join(root, 'assets'), path.join(root, 'dist/assets'), { recursive: true });
console.log('Built Tavern format resources and browser libraries.');
