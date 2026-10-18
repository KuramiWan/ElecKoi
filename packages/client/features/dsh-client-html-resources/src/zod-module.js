const z = globalThis.z;
// 本文件由 `scripts/build.mjs` 以**不打包**方式转译（那条 build 没有 `bundle`），任何 import 都会原样留在产物里、
// 浏览器解析不到这个裸标识符，所以这里就地构造契约形状的失败（码与码表里的 internal 同一个值）。
if (!z) throw { isDSHRemoteError: true, code: 'eleckoi/internal', message: 'The pinned browser Zod library is not installed', details: { what: '浏览器 Zod 库' } };
export { z };
export default z;
