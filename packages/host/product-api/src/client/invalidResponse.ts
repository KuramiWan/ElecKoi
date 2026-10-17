/**
 * 边界⑥（`dsh-client-*` → 宿主）的失败折叠：Remote 信封本身不成立时，折成一条**带码**的失败。
 *
 * 判据来源：`contracts/errors/boundaries.ts` 的 `renderer` 行（第 6 条边界）；
 * 参考实现 `packages/dsh-product-api/src/client/invalidResponse.ts`（v0.2.8 布局）。
 *
 * ## 为什么只有这一支需要折叠
 *
 * `RemoteResult.ok === false` 时 `result.error` **已经是**官方 `RemoteError`
 * （`@deepseek-ai/dsh-typert-protocol` 的 `remote-error.js`：构造器里 `isDSHRemoteError = true`，
 * 带 `code` 与 `details`），所以正常失败路径就是 `throw result.error`——码与详情逐字保留，
 * 本函数不参与。
 *
 * 只剩一种情况无实例可抛：**信封本身不成立**——`result` 缺失、`ok` 不是真而 `error` 又缺失或
 * 不是带 `code` 的失败对象。这时退回裸 `Error` 会把码丢掉，所以折成
 * `eleckoi/contract/invalid-response`，并把「观察到了什么」装进契约规定的 `issues`。
 *
 * ## 为什么不 import 契约包
 *
 * 本文件属于 `@eleckoi/dsh-product-api` 的 **client 面**（`tsc` 直出后被 tsdown 打成
 * module-loader bundle）。契约包 `@eleckoi/product-shared` 的 exports 指向 **TS 源码**，
 * 而 client 面是 `rootDir: src` 的增量工程——把源码包 import 进来会越过 `rootDir`，
 * 也不能保证被打进 bundle。所以这里用一份**受测守住的本地常量**：
 * `packages/host/product-api/tests/error-contract-client.test.ts` 断言它与
 * `ELECKOI_FAILURE_CODES.contractInvalidResponse` 逐字相同。改码表时那条用例会红。
 *
 * （P7 会把码表变成生成产物；届时这个常量可以由同一个生成器产出，这条用例随之退役。）
 *
 * ## 形状与唯一的解析点对接
 *
 * 返回的是普通对象、带官方那个结构标记 `isDSHRemoteError: true`——渲染层唯一的解析点
 * （`apps/web/src/utils/failureText.js` 的 `foldFailure`）认的就是它，所以这里**不新建方言**。
 * 详情里只有契约参数名 `issues`，不是拼好的用户可见句子：用户可见文案的解析点在渲染层。
 */

import { ELECKOI_FAILURE_CODES } from '../errorCodes.generated.js'

/** 信封不成立时的契约码（从生成物派生，码表改了会自动跟上）。 */
export const INVALID_RESPONSE_CODE = ELECKOI_FAILURE_CODES.contractInvalidResponse

/** 信封不成立时记进 `details.issues` 的路径：调用方连 `result` 都没拿到。 */
export const MISSING_RESULT_ISSUE_PATH = 'result'

/** 信封不成立时记进 `details.issues` 的路径：拿到了 `result`，但它的失败分支没有可用失败。 */
export const MISSING_ERROR_ISSUE_PATH = 'result.error'

/** 兜底码（从生成物派生）。 */
export const INTERNAL_FAILURE_CODE = ELECKOI_FAILURE_CODES.internal

/** 一条契约违例（与 `contracts/errors/details.ts` 的 `EleckoiFailureIssue` 同形）。 */
export interface InvalidResponseIssue {
  readonly path: string
  readonly message: string
}

/**
 * 信封不成立时的失败形态。
 *
 * 结构与官方 `RemoteError` 的**线上形状**一致（普通对象 + 结构标记），所以渲染层的折叠规则
 * 一行不改就保住码与详情；调用方直接 `throw` 它。
 */
export interface InvalidResponseFailure {
  readonly isDSHRemoteError: true
  readonly code: string
  /** 开发者诊断文案；用户可见文案的解析点在渲染层。 */
  readonly message: string
  readonly details: { readonly issues: readonly InvalidResponseIssue[] }
}

/**
 * 把「Remote 信封不成立」折成一个可抛的失败对象。
 *
 * @param what - 开发者诊断文案：调用方**观察到什么**（不是用户可见句子）。
 * @param path - `details.issues[0].path`：哪一层不成立，取 {@link MISSING_RESULT_ISSUE_PATH}
 *   或 {@link MISSING_ERROR_ISSUE_PATH}。缺省是后者。
 * @returns 带契约码 `eleckoi/contract/invalid-response` 的失败对象。
 */
export function invalidResponseFailure(
  what: string,
  path: string = MISSING_ERROR_ISSUE_PATH
): InvalidResponseFailure {
  return {
    isDSHRemoteError: true,
    code: INVALID_RESPONSE_CODE,
    message: what,
    details: { issues: [{ path, message: what }] }
  }
}

/** 兜底失败的形状：与官方线上形状一致，详情是自由扁平对象（`internal` 码的契约形状）。 */
export interface InternalFailure {
  readonly isDSHRemoteError: true
  readonly code: string
  readonly message: string
  readonly details: Readonly<Record<string, unknown>>
}

/**
 * 兜底失败：拿不到更有语义的码时的形状。
 *
 * 用在"载体不是产品失败"的地方——例如 LLM 的 `LlmFailure`（`{ message, code, status }`：
 * DSH 的 provider 码，不在我们的码表里）。把 provider 码**原样当产品码**传下去会污染码表，
 * 所以折成兜底码，并把 provider 的 `code` / `status` 记进详情做诊断。
 *
 * ⚠️ **不写 `details.what`**：渲染层看到带 `what` 的兜底码会给通用句；不写 `what` 时它退回
 * 开发者诊断，于是 provider 自己那句（常是"余额不足"这类用户看得懂的话）仍然能到用户眼前。
 *
 * @param message - 开发者诊断：优先用载体自己的 message。
 * @param details - 额外诊断（provider 的 code / status 等）。
 * @returns 带兜底码的失败对象。
 */
export function internalFailure(message: string, details: Readonly<Record<string, unknown>> = {}): InternalFailure {
  return { isDSHRemoteError: true, code: INTERNAL_FAILURE_CODE, message, details }
}
