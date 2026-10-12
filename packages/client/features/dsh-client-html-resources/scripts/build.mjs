import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist');
await mkdir(join(output, 'client'), { recursive: true });
await build({ entryPoints: [join(root, 'src/browser-libraries.js')], bundle: true,
  format: 'iife', globalName: 'ElecKoiHtmlLibraries', target: 'chrome108', sourcemap: true,
  outfile: join(output, 'html-libraries.global.js') });
await build({ entryPoints: ['zod-module', 'lodash-module'].map(name => join(root, 'src', name + '.js')),
  format: 'esm', target: 'chrome108', outdir: output });
await cp(join(root, 'src/runtime.js'), join(output, 'client/runtime.js'));
await cp(join(root, 'assets'), join(output, 'assets'), { recursive: true });
console.log('Built ElecKoi HTML resources.');
