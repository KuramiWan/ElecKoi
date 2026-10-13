/**
 * 边界④ 的出口：DSH 运行时插件的 `apply()` 失败（抛出、注册失败）在这里收口。
 *
 * 判据来源：ADR 0002 决定 2 的边界闭集 ④ 与**订正 f**（④ 要求的是插件失败必须产出带码的、
 * 可记录的对象并进日志；agent 面向的工具结果 `fail(status, detail)` 沿用既有写法，不在本线范围）。
 * 契约表 `packages/product-shared/src/contracts/errors/boundaries.ts` 的 `runtime-plugin` 条：
 *
 * - 插件抛出**已带契约码**的失败 → 码与详情原样保留（折法里的 `code: null`）；
 * - 未分类失败 → 兜底码 `eleckoi/internal`。
 *
 * 三件事都不在本文件里另起一套：
 *
 * 1. **码与折法**来自契约的 `foldFailure`（六条边界共用的那一条规则），不是这里拼的字符串；
 * 2. **记下来的对象**就是契约的 `EleckoiFailure`（⑦：任何边界都产出同一个
 *    `{ code, message, details }`），这里只是把它写进诊断出口；
 * 3. **诊断出口**是子进程的 stderr——宿主的 `onDiagnostic` 已经把它接进 `ctx.appLog`
 *    （EH-6），文件输出是 EH-7 的 `AppLog`。不新建通道、不动 `fatal` 协议字段。
 *
 * 折完后抛出的是带码的 `DesktopError`（契约里**已有**的产品失败形状）：Cordis 把它标成这条
 * entry 的失败，子进程的 `fatal` 帧带上这个码（EH-6 的 `code` 字段），宿主侧折成
 * `DshPluginHostFailure` —— ②③ 两层读到的就是同一个对象。
 */

import { DesktopError } from '@eleckoi/product-shared/foundation/DesktopError'
import { foldFailure } from '@eleckoi/product-shared/foundation/failure'

/** 诊断出口上那行的标记：宿主的日志里一眼能认出这是插件失败，不是普通诊断。 */
const RUNTIME_PLUGIN_FAILURE_EVENT = 'eleckoi/runtime-plugin-failure'

/**
 * 跑一个运行时插件的 `apply()`。
 *
 * - 同步抛出 → 收口后抛出带码的失败；
 * - 同步返回值 → **原样透传**（插件的 disposer 不能变成 Promise 包一层）；
 * - 返回 Promise（`async apply`）→ 拒绝同样收口，兑现照常透传。
 *
 * 所以包装不改插件的对外形状，只补失败出口。
 *
 * @param pluginId - 插件标识，只为诊断（`cordis.yml` 的 entry id / preset 里的插件 id）。
 * @param run - 真正调用 `apply(ctx, config)` 的闭包。
 * @returns 插件原本的返回值（disposer 或 Promise）。
 */
export function runRuntimePluginApply(pluginId, run) {
  let result
  try {
    result = run()
  } catch (error) {
    throw recordRuntimePluginFailure(pluginId, error)
  }
  if (typeof result?.then === 'function') {
    return result.then(undefined, (error) => {
      throw recordRuntimePluginFailure(pluginId, error)
    })
  }
  return result
}

/**
 * 折成契约的同一个可记录对象、写进诊断出口、返回**带码的**抛出值。
 * @param pluginId - 插件标识（诊断用）。
 * @param error - `apply()` 抛出的任意值。
 * @returns 带契约码与详情的 `DesktopError`。
 */
export function recordRuntimePluginFailure(pluginId, error) {
  const failure = foldFailure(error)
  const coded = new DesktopError(failure.code, failure.message, failure.details)
  // 诊断要指向插件里真正抛出的那一行，而不是这个包装函数。
  if (error instanceof Error && typeof error.stack === 'string') coded.stack = error.stack
  console.error(runtimePluginFailureLine(pluginId, failure, coded))
  return coded
}

/**
 * 诊断出口上的一行：一行 JSON，宿主的 logger 原样收下（`onDiagnostic` → `appLog` → 文件）。
 * 详情也在这里——`fatal` 帧只有四个字段（EH-6 定的），塞不下详情，所以它随诊断走。
 *
 * @param pluginId - 插件标识。
 * @param failure - 折叠后的可记录对象。
 * @param error - 抛出的失败本身（取 stack）。
 * @returns 一行诊断文本。
 */
export function runtimePluginFailureLine(pluginId, failure, error) {
  return `${RUNTIME_PLUGIN_FAILURE_EVENT} ${JSON.stringify({
    plugin: pluginId,
    code: failure.code,
    message: failure.message,
    details: failure.details,
    stack: error instanceof Error ? error.stack : undefined
  })}`
}
