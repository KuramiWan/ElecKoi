import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'lib');
const child = relative(root, output);
if (child !== 'lib' || isAbsolute(child)) throw new Error('Invalid build output directory');
await rm(output, { recursive: true, force: true });
