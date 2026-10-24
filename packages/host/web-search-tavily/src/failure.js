/**
 * 带契约码的 WebError。
 *
 * 为什么是**本地码常量**而不是 `@eleckoi/dsh-product-api` 的 `productFailure`：
 * 本包是 DSH 插件（`private`，依赖里只有 `@deepseek-ai/*`），运行期解析不到契约包。
 * 本地常量使用与契约完全相同的码字符串，`tests/` 断言与
 * `packages/shared/src/contracts/errors/codes.ts` 的 `ELECKOI_FAILURE_CODES` 一致。
 *
 * 失败形状仍是 `WebError`（保留类型与 `code`，DSH 的工具错误元数据认它），另外挂上官方
 * `RemoteError` 的结构标记 `isDSHRemoteError` 与 `details`——网关的 `rpcFailure` 只认这个标记，
 * 码与参数化详情因此能原样穿过边界（`foldFailure` 的 remote 分支认同一个标记）。
 *
 * `details` 的参数名只用契约闭集：`field` / `issues` / `path` / `operation` / `guard` /
 * `what` / `expected` / `actual`。
 */
import { WebError } from '@deepseek-ai/dsh-web'

/** 本包用到的契约码（与契约码表逐字一致，`tests/` 守住）。 */
export const FAILURE_CODES = Object.freeze({
  contractInvalidResponse: 'eleckoi/contract/invalid-response',
  modelConfigInvalid: 'eleckoi/model/config-invalid',
  netOperationFailed: 'eleckoi/net/operation-failed'
})

/**
 * 造一条带契约码的 `WebError`。
 * @param code - 契约码（取 {@link FAILURE_CODES} 的值）。
 * @param message - 开发者诊断；用户可见文案只在渲染层按码生成。
 * @param details - 参数化详情（契约闭集里的键）。
 * @param options - `Error` 选项（`cause`）。
 * @returns 带结构标记与详情的 `WebError`。
 */
export function webFailure(code, message, details, options) {
  const failure = new WebError(message, code, options)
  failure.isDSHRemoteError = true
  failure.details = details
  return failure
}
