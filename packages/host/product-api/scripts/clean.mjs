import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';

// 失败契约码：本脚本是构建期脚本，先于工作区构建运行，运行时解析不到
// `@eleckoi/dsh-product-api`（契约包 exports 指向 TS 源码，也不能在构建期 import）。
// 所以就地写死线上码字符串；它与 `packages/shared/src/contracts/errors/codes.ts` 的
// ioFailed 逐字一致，码表由 `check:error-codes` 守着。
const IO_FAILED = 'eleckoi/io/failed';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'lib');
const child = relative(root, output);
if (child !== 'lib' || isAbsolute(child)) {
  throw {
    isDSHRemoteError: true,
    code: IO_FAILED,
    message: 'Invalid build output directory',
    details: { operation: 'clean', path: output }
  };
}
await rm(output, { recursive: true, force: true });
