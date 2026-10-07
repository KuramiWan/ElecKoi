/**
 * 【判据绑定】第 3 层那 13 条语义断言，每条必须**申报**它凭什么说"酒馆是这样"。
 *
 * 为什么要有这个文件：目标套件的判据是人手对 `wi.js` 的转写。转写本身可以是对的（第一轮审计核过
 * 11/11 行号命中），但如果没有机械绑定，谁都可以把断言改成"电子爱现在的行为"而不惊动任何测试。
 * 这里把"依据"变成**数据**：
 *   ① `st` 引用（`wi.js:NNNN`）与**摘录**必须能在 `wi.js` 对应行上就地命中；
 *   ② 题目标题里写的 `wi.js:NNNN` 必须与表里的一致（标题与依据不许各说各话）；
 *   ③ 只做反证的两条（`getwi`，ST 核心没有这个函数）也必须可执行地反证（全文只允许 1 处别名命中）。
 *
 * 行从哪来（2026-10-07 独立评估 P0-1 起，见 `tests/helpers/stUpstream.ts`）：
 *   - ① 这类**行级**核对：本机有整份 `wi.js` 就用它，否则用**仓库内的摘录** ⇒ 干净检出（CI）上也跑；
 *   - ③ 这类**全文**反证：只有本机有整份副本时才跑（拿摘录数"全文出现次数"是假绿）。
 * 这条闸保证的是"依据不许被悄悄抽走"，不是"依据一定正确"——后者要么靠第二个人核，要么靠真实卡语料。
 */
import { stFullLines, stLocalFile, stSourceLines } from './stUpstream'

// 申报表（数据）在 `tavernStEvidenceTable.ts`：生成器也要读它，所以数据与"读文件"的代码分开放。
export { SEMANTIC_EVIDENCE, SEMANTIC_TEST_COUNT, refLines } from './tavernStEvidenceTable'
export type { SemanticBasis, SemanticEvidence, StCitation } from './tavernStEvidenceTable'

/**
 * 本机整份 `wi.js` 的路径（保留给"确实需要整份文件"的地方）；没有就 undefined。
 * 路径解析与"环境变量给了就是权威"的约定在 `stUpstream.ts` 里。
 */
export function wiJsFile(): string | undefined {
  return stLocalFile('wi.js')
}

/** 行级核对用的 wi.js 行：本机整份副本优先，其次仓库内摘录（稀疏行数组，洞 = 没摘的行） */
export function wiJsLines(): string[] | undefined {
  return stSourceLines('wi.js')
}

/** 全文反证用的 wi.js 行：**只**在本机有整份副本时才有值 */
export function wiJsFullLines(): string[] | undefined {
  return stFullLines('wi.js')
}
