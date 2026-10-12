import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const name of ['lib', 'dist']) {
  const output = resolve(root, name);
  if (relative(root, output) !== name) throw new Error('Invalid HTML resource output directory');
  await rm(output, { recursive: true, force: true });
}
