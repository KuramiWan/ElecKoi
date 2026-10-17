/**
 * 边界⑥ 的**信封拆解**：`ok` 成立就给值，不成立就抛失败。
 *
 * 判据来源：`contracts/errors/boundaries.ts` 的 `renderer` 行；ADR 0002 决定 8
 * （`throw result.error` 保留官方失败实例）；参考实现
 * `packages/dsh-product-api/src/client/unwrapFailure.ts`（v0.2.8 布局）。
 *
 * ## 为什么收在这里
 *
 * `if (!result?.ok) throw new Error(result?.error?.message || '…')` 这个形状在
 * `packages/client/features/<name>/src/client.js` 里抄了 **27 份**（2026-10-17 实测；另有
 * `!result.ok` 的变体若干）。每一份都把码与详情压成一句 message——宿主明明已经给出了
 * 带码的失败，客户端却在最后一跳把它丢掉。那 14 个 bundle 是运行时独立加载的，跨 bundle
 * 取共享代码的既有形态是 `require('@eleckoi/dsh-product-api/client')`（本包是
 * `ELECKOI_DESKTOP_BUNDLES` 的成员，`apps/desktop-host/src/desktopPluginBundles.ts`），
 * 所以拆信封也放这里：跨 bundle 只有一份实现。
 *
 * ## 行为
 *
 * - `result?.ok` 为真 → 返回 `result.value`；
 * - 否则 `result?.error` 带真值 `code` → 抛出**那个失败对象本身**（码与详情逐字保留）；
 * - 否则 → 抛出 {@link invalidResponseFailure} 的产物（`eleckoi/contract/invalid-response`，
 *   `details.issues[0].path` 是 `result` 或 `result.error`）。
 *
 * ⚠️ 失败分支的判据与旧写法逐字等价：只认「带真值 `code` 的对象/函数」，所以字符串、
 * 数字这类失败值走折叠那条路。**不要**在这里 `instanceof`：跨 bundle 副本原型不同。
 */

import { MISSING_ERROR_ISSUE_PATH, MISSING_RESULT_ISSUE_PATH, invalidResponseFailure } from './invalidResponse.js'

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
 * @param what - 开发者诊断文案：**调用方观察到什么**（不是用户可见句子）。
 * @returns 信封成立时是 `result.value`。
 * @throws 信封成立但失败时抛 `result.error` 本身；信封不成立时抛契约失败
 *   `eleckoi/contract/invalid-response`。
 */
export function unwrapOrFail<T>(result: RemoteResultEnvelope<T> | null | undefined, what: string): T {
  if (!result?.ok) {
    // `issues[0].path` 要说真话：连 `result` 都没拿到是 `result`，拿到了但失败分支不可用是 `result.error`。
    const path = result === undefined || result === null ? MISSING_RESULT_ISSUE_PATH : MISSING_ERROR_ISSUE_PATH
    throw failureOrInvalidResponse(result?.error, what, path)
  }
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
export function failureOrInvalidResponse(
  error: unknown,
  what: string,
  path: string = MISSING_ERROR_ISSUE_PATH
): unknown {
  return hasFailureCode(error) ? error : invalidResponseFailure(what, path)
}

function hasFailureCode(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const type = typeof value
  if (type !== 'object' && type !== 'function') return false
  return Boolean((value as { readonly code?: unknown }).code)
}
