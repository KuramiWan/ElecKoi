import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, {recursive: true});
await build({entryPoints: [path.join(root,'src/realm.js')], bundle: true, format: 'iife', target: 'chrome108',
  minify: true, legalComments: 'eof', loader: {'.html': 'text'}, outfile: path.join(output,'tavern-native.global.js'),
  banner: {js: '/* SillyTavern 1.19.0 (06bde939), AGPL-3.0. Licensed ST modules and native ElecKoi adapters; independent TavernHelper facade. */'},
});
await cp(path.join(root,'src/st/runtime/vendor/sillytavern/LICENSE'),path.join(output,'SillyTavern.LICENSE.txt'));
await cp(path.join(root,'src/st/SOURCE.json'),path.join(output,'SillyTavern.SOURCE.json'));
console.log('Built native Tavern browser realm with licensed ST runtime.');
