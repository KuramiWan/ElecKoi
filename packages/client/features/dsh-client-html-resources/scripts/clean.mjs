import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const name of ['lib', 'dist']) {
  const output = resolve(root, name);
  if (relative(root, output) !== name) {
    // 构建脚本，报错给开发者看。这里**不能** import `@eleckoi/dsh-product-api`：根 `build:workspace-runtime`
    // 把本包排在 product-api 之前，冷树里那条 import 会因 lib 还没生成而直接失败。所以就地构造契约形状的失败
    // （码与码表里的 ioFailed 同一个值），`operation` 记动作、`path` 记算出来的输出目录。
    throw {
      isDSHRemoteError: true,
      code: 'eleckoi/io/failed',
      message: 'Invalid HTML resource output directory',
      details: { operation: 'clean', path: output }
    };
  }
  await rm(output, { recursive: true, force: true });
}
