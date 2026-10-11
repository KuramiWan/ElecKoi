import { mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(packageRoot, 'lib/web');
await mkdir(output, { recursive: true });
await cp(path.join(root, 'packages/client/features/dsh-client-tavern-shared/src/runtime.js'), path.join(output, 'runtime.js'));
