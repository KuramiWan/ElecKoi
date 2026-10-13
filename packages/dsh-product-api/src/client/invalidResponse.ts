/**
 * 边界⑥（`dsh-client-*`）的失败折叠：Remote 信封本身不成立时折成一条带码的失败。
 *
 * 判据来源：ADR 0002 决定 2（边界闭集 ⑥）/ 决定 8（`throw result.error` 保留实例）、
 * 决定 14（`eleckoi/contract/invalid-response` 的详情带 `issues`）；
 * `contracts/errors/boundaries.ts` 的 ⑥ 行（`carries` = 「官方 RemoteResult 的 ok:false 分支
 * 重建出 RemoteError 实例」）；票 EH-4a 第 1 节。
 *
 * ## 为什么只有这一支需要折叠
 *
 * `RemoteResult.ok === false` 时 `result.error` **已经是**官方 `RemoteError` 实例
 * （`@deepseek-ai/dsh-typert-protocol` 的 `remote-error.d.ts`：构造函数里
 * `isDSHRemoteError = true`，带 `code` 与 `details`），所以正常失败路径就是
 * `throw result.error`——**码与详情逐字保留，本函数不参与**（决定 8）。
 *
 * 只剩一种情况无实例可抛：**信封本身不成立**——`result` 缺失、`ok` 不是 `true` 而 `error`
 * 又缺失或不是带 `code` 的失败对象。这时若退回裸 `Error`，码就丢了（决定 8 禁止），
 * 所以折成 `eleckoi/contract/invalid-response` 并把「观察到什么」装进契约规定的 `issues`。
 *
 * ## 形状与唯一的解析点对接
 *
 * 返回的是普通对象、带官方那个结构标记 `isDSHRemoteError: true` —— 渲染层唯一的解析点
 * （`apps/web/src/utils/failureText.js` 的 `foldFailure`）认的就是它，所以这里**不新建方言**。
 * 详情里只有契约参数名闭集里的 `issues`（ADR 0002 决定 14），不是拼好的用户可见句子
 * （决定 4：用户可见文案的解析点在渲染层）。
 *
 * ## 为什么它住在这个包
 *
 * ADR 0002 决定 8 与票 EH-4a 都要求这一份折叠**只有一份**。12 个 `dsh-client-*` 的
 * `src/client.js` 是运行时经 `window.__ModuleLoader__` 装载的独立 bundle（没有构建步骤把它
 * 们和契约包打在一起），跨 bundle 取共享代码的既有形态就是**在 factory 里 `require` 一个
 * 已在图里的包**（`dsh-client-shell/src/client.js:11` 就是这么 `require`
 * `@deepseek-ai/dsh-client-ui-primitives` 的）。这个包已经是 desktop profile 的 bundle
 * 成员（`apps/desktop-host/src/desktopPluginBundles.ts`），每个含 unwrap 的 `dsh-client-*`
 * 又都 `inject` 它，所以那些 bundle 可以 `require('@eleckoi/dsh-product-api/client')`
 * 拿到本函数——契约代码只此一份，不复制到 12 个 bundle 里。
 */

import {
  ELECKOI_FAILURE_CODES,
  type EleckoiFailureCode
} from '@eleckoi/product-shared/contracts/errors/codes'
import type {
  EleckoiContractIssueDetails,
  EleckoiFailureIssue
} from '@eleckoi/product-shared/contracts/errors/details'

/** 信封不成立时记进 `details.issues` 的路径：调用方连 `result` 都没拿到。 */
export const MISSING_RESULT_ISSUE_PATH = 'result'

/** 信封不成立时记进 `details.issues` 的路径：拿到了 `result`，但它的失败分支没有可用失败。 */
export const MISSING_ERROR_ISSUE_PATH = 'result.error'

/**
 * 信封不成立时的失败形态。
 *
 * 结构与官方 `RemoteError` 的**线上形状**一致（普通对象 + 结构标记），所以渲染层
 * `foldFailure` 的规则 3 一行不改就保住码与详情。
 */
export interface InvalidResponseFailure {
  readonly isDSHRemoteError: true
  readonly code: EleckoiFailureCode
  /** 开发者诊断文案；用户可见文案的解析点在渲染层（ADR 决定 4/9）。 */
  readonly message: string
  readonly details: EleckoiContractIssueDetails
}

/**
 * 把「Remote 信封不成立」这条支折成一个可抛的失败对象。
 *
 * @param what - 开发者诊断文案：调用方**观察到什么**（不是用户可见句子）。
 * @param path - `details.issues[0].path`：哪一层不成立，取 {@link MISSING_RESULT_ISSUE_PATH}
 *   或 {@link MISSING_ERROR_ISSUE_PATH}。缺省是后者（`result` 拿到了、失败分支不可用）。
 * @returns 带契约码 `eleckoi/contract/invalid-response` 的失败对象，调用方直接 `throw` 它。
 */
export function invalidResponseFailure(
  what: string,
  path: string = MISSING_ERROR_ISSUE_PATH
): InvalidResponseFailure {
  const issue: EleckoiFailureIssue = { path, message: what }
  return {
    isDSHRemoteError: true,
    code: ELECKOI_FAILURE_CODES.contractInvalidResponse,
    message: what,
    details: { issues: [issue] }
  }
}
