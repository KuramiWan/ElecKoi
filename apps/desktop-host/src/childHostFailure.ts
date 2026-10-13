/**
 * 子进程失败的落点：任何抛出（含 ④ 的运行时插件失败）都折成契约的**同一个可记录对象**，
 * 并把码放进 `fatal` 帧。
 *
 * 判据来源：ADR 0002 决定 10（`fatal` 扩字段）与订正 f（④ 的出口要求带码、可记录）；
 * 契约表 `packages/product-shared/src/contracts/errors/boundaries.ts` 的 `host-dsh-subprocess` 条。
 *
 * 三件事不在这里另起一套：
 *
 * 1. **折叠规则**只有 `foldFailure` 一份（ADR 决定 1）；
 * 2. **帧的形状**是 EH-6 的 {@link ChildHostFatalMessage}——本票不新增协议字段，
 *    所以详情不进帧（它随插件侧的诊断行走 stderr → `onDiagnostic`）；
 * 3. **消费侧**读到的仍是 EH-6 的 `DshPluginHostFailure`（`pluginHostFailureOf` 折这个帧）。
 *
 * 子进程入口 `desktopPluginHostChild.ts` 在 `main()` 失败时用它发帧；入口 import 时就会跑
 * `main()`，所以用例不能 import 它，只能验这两个纯函数 + 一条覆盖代理断言（同 EH-6 的手法）。
 */

import { foldFailure, type EleckoiFailure } from '@eleckoi/product-shared/foundation/failure'
import type { ChildHostFatalMessage } from './hostSessionProtocol'

/** 任意抛出 → 契约的同一个可记录对象。 */
export function childHostFailureOf(error: unknown): EleckoiFailure {
  return foldFailure(error)
}

/**
 * 可记录对象 → `fatal` 帧。
 * @param failure - {@link childHostFailureOf} 的产物。
 * @param stack - 子进程侧的 stack；没有就不写这个字段（帧的可选字段在时必须是 string）。
 * @returns 消费侧（`isChildMessage` → `pluginHostFailureOf`）收的帧。
 */
export function childHostFatalFrame(failure: EleckoiFailure, stack: string | undefined): ChildHostFatalMessage {
  return {
    type: 'fatal',
    code: failure.code,
    message: failure.message,
    ...(stack === undefined ? {} : { stack })
  }
}
