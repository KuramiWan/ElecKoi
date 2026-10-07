/**
 * 【红绿台账】目标套件的**红数/绿数**的唯一真相。
 *
 * 为什么要有这个文件（独立评审 P1-1）：
 *   两份对外文档在散文里写"49 条红 / 52 条绿"，而闸（`tavern-compatibility-docs.test.ts`）
 *   只比对文档与**另一份手写常量**——把文档里的数改成 48、再让一条红断言变绿，
 *   闸全绿（评审实验 E5）。所以这里把数从"文档里的字"变成"一份被三方引用的台账"：
 *
 *   1. 文档闸从**本文件**取数核文档 ⇒ 文档不能与台账漂移；
 *   2. 每个目标套件文件在**运行期**断言自己登记的目标条数 == 台账对应项
 *      （`character-card-fidelity-target.test.ts` 断言本文件 42、伴生文件断言自己的 3、
 *      世界书面断言 `setWorldInfo.length == WORLD_TARGET_COUNT == 4`）⇒ 台账不能与套件漂移。
 *
 *   ⚠️ **残留局限（必须知道，别当成已经解决）**：把某一条红断言的**期望值**改成恒真、
 *   而**不增删用例**（评审实验 E5 的手法），三处都不会响——进程内的闸看不到"这条断言其实已经满足了"。
 *   这一类只能靠"跑目标套件看红数"或人工评审发现，不是本台账能堵的。
 *   台账堵的是"数字在四个地方各写各的"。
 */

/** 世界书面（第二条导入面）的目标断言条数：由 `tavernWorldFileTargetEvidence.ts` 自己再核一次 */
import { WORLD_TARGET_COUNT } from './tavernWorldFileTargetEvidence'

/** `character-card-fidelity-target.test.ts` 本文件的目标断言数（运行期由该文件自查） */
export const CARD_TARGETS = 42

/** 伴生文件 `character-card-fidelity-target-context.test.js` 的目标断言数（运行期由该文件自查） */
export const COMPANION_TARGETS = 3

/** 三个目标文件合计的红数 */
export const RED_TOTAL = CARD_TARGETS + COMPANION_TARGETS + WORLD_TARGET_COUNT

/**
 * 目标模式下的绿数。**分文件钉住**（不是派生数：它是"今天通过"的用例总数，只有跑起来才知道），
 * 合计由三者相加得出，不再单独写一个字面量。
 *
 * 52 → 55 → 57：三轮把世界书面的判据绑定闸移出开关门控后，它在目标模式下也计入（1 → 4 条）；
 * 三段修复（独立验证 F1：伴生文件的台账自查原先是**死代码**，接在一条今天必红的断言之后）后，
 * 卡面与伴生各多了一条**不受开关门控**的台账核对用例（+2）。
 *
 * 分文件（目标模式）：卡面 42 红 / 50 绿、伴生 3 红 / 3 绿、世界书面 4 红 / 4 绿。
 */
export const CARD_GREEN = 50
export const COMPANION_GREEN = 3
export const WORLD_GREEN = 4

/** 三个目标文件合计的绿数（由分文件相加，不是手写字面量） */
export const GREEN_TOTAL = CARD_GREEN + COMPANION_GREEN + WORLD_GREEN

/** 目标模式下三个文件的用例总数（红 + 绿） */
export const TARGET_CASE_TOTAL = RED_TOTAL + GREEN_TOTAL

/**
 * 【缺口账】known-gap 的绝对条数与三桶分解。
 *
 * 为什么这些数在这里、而不是只在目标套件的用例里（`character-card-fidelity-target.test.ts` 的
 * 「账目闭合」那条今天还写着字面量）：
 *   对外文档的散文里有 `59 = 27 + 29 + 3`、`34 条空白证据`、`5 条非缺口证据` 这些数。
 *   先把它们**从散文搬进生成块**（`tavernSummaryBlock.ts`），再让"生成块 → 台账 → 套件运行期实测值"
 *   串成一条链，散文就再也没有机会自己编一个数。留在套件里的那份字面量会变成同一事实的**第二份副本**，
 *   所以它改成引用本文件——这是唯一真相原则，不是把断言放宽：
 *   `rows.length` / `blankWitnesses.length` 仍然是运行期算出来的，改清单照样当场红。
 */
export const GAP_TOTAL = 59
export const GAP_ASSERTED = 27
export const GAP_BLANK = 29
export const GAP_BY_DESIGN = 3
export const BLANK_TOTAL = 34
export const NON_GAP_TOTAL = 5
