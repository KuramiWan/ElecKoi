/**
 * 边界⑥（`dsh-client-*`）的**信封拆解**：`ok` 成立就给值，不成立就抛失败。
 *
 * 判据来源：ADR 0002 决定 8（`throw result.error` 保留 `RemoteError` 实例）、决定 2（边界闭集 ⑥）、
 * 决定 14（`eleckoi/contract/invalid-response` 的详情带 `issues`）；票 EH-4a 第 1 节与票 EH-11 的 E 项。
 *
 * ## 为什么收在这里
 *
 * `throw result?.error?.code ? result.error : invalidResponse('…')` 这句话在 9 个
 * `dsh-client-*` 的 `src/client.js` 里抄了 23 份（变量名有 `result` 也有 `accepted`）。
 * 那 9 个包**已经** `require('@eleckoi/dsh-product-api/client')` 取「信封不成立」的折叠
 * （见 `invalidResponse.ts` 的文件头），所以拆信封也放这里：跨 bundle 只有一份实现。
 *
 * ## 行为（一个字没变）
 *
 * - `result?.ok` 为真 → 返回 `result.value`；
 * - 否则 `result?.error.code` 为真 → 抛出**那个失败对象本身**（官方 `RemoteError` 实例，
 *   码与详情逐字保留，见 {@link failureOrInvalidResponse}）；
 * - 否则 → 抛出 {@link invalidResponseFailure} 的产物（`eleckoi/contract/invalid-response`，
 *   `details.issues[0].path` 是 `result` 或 `result.error`）。
 */

import { invalidResponseFailure } from './invalidResponse.js'

/** 官方 `RemoteResult` 的最小结构：`ok` 判定、成功值与失败分支。 */
export interface RemoteResultEnvelope<T> {
  readonly ok?: boolean
  readonly value?: T
  readonly error?: unknown
}

/**
 * 拆开一次 Remote 调用：成功给值，失败就抛。
 *
 * @param result - 官方 Remote 调用的返回值（可能整个缺失）。
 * @param what - 开发者诊断文案：**调用方观察到什么**（不是用户可见句子；
 *   用户可见文案只有一个解析点在渲染层，ADR 决定 4/8）。
 * @returns 信封成立时是 `result.value`。
 * @throws 信封成立但失败时抛 `result.error` 本身；信封不成立时抛契约失败
 *   `eleckoi/contract/invalid-response`。
 */
export function unwrapOrFail<T>(result: RemoteResultEnvelope<T> | null | undefined, what: string): T {
  if (!result?.ok) throw failureOrInvalidResponse(result?.error, what)
  return result.value as T
}

/**
 * 失败分支可用的判据：它带一个**真值** `code`。
 *
 * 与旧的 `result?.error?.code ? result.error : …` 逐字等价（`''` / `0` / `null` 都算没有码）；
 * 只在对象或函数上取属性，所以字符串、数字这类失败值走折叠那条路。
 *
 * @param error - 信封的 `error` 分支（任意值）。
 * @param what - 同上，折叠时作为 `issues[0].message` 的开发者诊断。
 * @returns 可抛的失败对象：原失败实例，或折出来的契约失败。
 */
export function failureOrInvalidResponse(error: unknown, what: string): unknown {
  return hasFailureCode(error) ? error : invalidResponseFailure(what)
}

function hasFailureCode(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const type = typeof value
  if (type !== 'object' && type !== 'function') return false
  return Boolean((value as { readonly code?: unknown }).code)
}
