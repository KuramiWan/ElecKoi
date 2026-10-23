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
 * 这是 ADR 0040 决定 1 明令禁止的。
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
  /**
   * 网关认得的**载体标记**（`@deepseek-ai/dsh-typert-protocol` 的 `remoteErrorOf` 只认
   * `isDSHRemoteError === true && typeof code === 'string'`）。
   *
   * 为什么产品失败要自带这个标记：DSH 网关的折叠函数 `rpcFailure`
   * （`@deepseek-ai/dsh-api-gateway/lib/index.js:1425-1446`）把**非**载体的一切抛出换成
   * `{ code: 'gateway/internal', message, details: {} }`——码与详情不是被改写，是被丢掉。
   * 而"在 Remote 出口处包一层"需要 `packages/host/product-api`（tsc 直出、不打包）在**运行时**
   * import 契约包的 `foldFailure`，而契约包是 TS 源码、exports 指向 `src/*.ts`，Node/Electron
   * 运行时解析不了。让失败自己就是合法载体，就消掉了这层翻译与那条运行期依赖：
   * 领域里抛出来的码与详情**原样**过网关。
   *
   * 代价（故意接受，与 `contracts/errors/ipc.ts` 复用同一标记是同一个决定）：DSH 的代码看到这个
   * 对象会把它当 `RemoteError`；本类的码不在协议那张封闭枚举里，类型上要由
   * `RemoteErrorDetailsMap` 的声明合并兜住（今天没有 TS 代码构造/分派它，所以先不加声明合并）。
   *
   * ⚠️ 这个标记是**结构性**的：跨 bundle 副本、跨 realm 复制都还在；不要改成 getter，
   * 也不要在序列化时丢掉它（结构化克隆保留自有属性）。
   */
  readonly isDSHRemoteError = true

  constructor(
    readonly code: AnyProductFailureCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'DesktopError'
  }
}
