/**
 * 边界①（领域内抛出）的薄适配器：用**契约码 + 参数化详情**构造 `DesktopError`。
 *
 * 判据来源：ADR 0002 决定 2（边界① 领域内 throw）/ 决定 4（详情参数化、宿主不拼用户可见句子）/
 * 决定 7（词表只有 `contracts/errors/codes.ts` 一套真相）；spec 决定 4/6。
 * 边界① 的落点在 `contracts/errors/boundaries.ts` 的 `domain-throw` 一条里写着
 * 「@eleckoi/dsh-product-data 的仓储与领域服务抛出点（EH-3）」，本文件就是那层适配器。
 *
 * 三个类型与形态约束是这里的全部价值：
 *
 * 1. `code` 只接受 `EleckoiFailureCode`——**legacy 6 码（`DesktopErrorCode`）在这里过不了编译**，
 *    写错一个字面量、或 `codes.ts` 改了码值，都是编译错误。所以抛出点直接写**码字面量**
 *    （`'eleckoi/input/invalid'`）是安全的：`contracts/errors/codes.ts` 仍是唯一的定义处，
 *    这里只是被联合类型核对过的使用处（票的两条可复算判据也是按字面量写的，见 `EH-3.status.md`）。
 * 2. `details` 由码决定：`EleckoiFailureDetailsMap[C]` 让「这条码该带哪些参数」在编译期强制
 *    （例如 `eleckoi/input/invalid` 必须带 `field`，多一个参数就报错）。
 * 3. `EleckoiFailureDetailsMap[C]` 也要求 `C` 从 `code` 实参推断，所以三参必须成对给出——
 *    不能只改码不换详情。
 *
 * 文案是**开发者诊断文案**（说清哪个操作、哪个对象/路径失败），不是用户可见文案；
 * 用户可见的说法由渲染层解析（ADR 0002 决定 4）。
 */

import type { EleckoiFailureCode } from '@shared/contracts/errors/codes'
import type { EleckoiFailureDetailsMap } from '@shared/contracts/errors/details'
import { DesktopError } from '@shared/foundation/DesktopError'

/** 用契约码构造领域失败。`details` 的形状由码决定（见文件头注释）。 */
export function contractFailure<C extends EleckoiFailureCode>(
  code: C,
  message: string,
  details: EleckoiFailureDetailsMap[C]
): DesktopError {
  return new DesktopError(code, message, details)
}
