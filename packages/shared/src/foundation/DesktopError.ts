/**
 * 产品失败的抛出形态。
 *
 * 这个类承载**两种**码，用同一套结构（`name` + `code` + `message` + `details`）：
 *
 * 1. {@link DESKTOP_ERROR_CODES} 的 6 个 legacy 码——上游 v0.2.13 还在 **8 个文件**里抛它们
 *    （2026-10-17 实测 35 处：`CONFLICT` 20、`INVALID_REQUEST` 6、`INTERNAL` 5、`NOT_FOUND` 2、
 *    `FORBIDDEN` 2、`RUNTIME_UNAVAILABLE` 0；第三参 `details` 一次都没写）。
 *    它们没有唯一对应的契约码，`foundation/failure.ts` 里有一张防御映射表负责折；
 *    **新代码不许再抛这 6 个码**。
 * 2. {@link EleckoiFailureCode} 的契约码（`eleckoi/<域>/<原因>`）——领域、宿主、插件都抛这一种。
 *
 * 为什么是同一个类而不是第二套类型：`foundation/failure.ts` 的 `foldFailure` 按
 * **`name === 'DesktopError'` 这个形状**识别产品失败（跨 bundle、跨 realm 副本时 `instanceof`
 * 必为假），再拿 `code` 决定走哪张表。多一个类就得多认一套标记 = 第二套失败方言，
 * 这是 ADR 0002 决定 1 明令禁止的。
 *
 * `message` 是**开发者诊断**，不是用户可见句子：用户可见文案只有一个解析点，在渲染层
 * （`apps/web/src/utils/failureText.js` 的按码映射）。
 */

import type { EleckoiFailureCode } from '../contracts/errors/codes.js'

export const DESKTOP_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  INTERNAL: 'INTERNAL'
} as const

/** 上游 6 个 legacy 码。新代码不许再用，见文件头。 */
export type DesktopErrorCode = typeof DESKTOP_ERROR_CODES[keyof typeof DESKTOP_ERROR_CODES]

/** 一种产品失败的码：契约码，或上游还没清掉的 legacy 码。 */
export type AnyProductFailureCode = EleckoiFailureCode | DesktopErrorCode

export class DesktopError extends Error {
  constructor(
    readonly code: AnyProductFailureCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'DesktopError'
  }
}
