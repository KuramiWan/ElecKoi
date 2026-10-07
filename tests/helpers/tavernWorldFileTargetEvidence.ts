/**
 * 【判据绑定 · 世界书导入面】世界书红目标那 4 条断言，每条必须**申报**它凭什么说"酒馆是这样"。
 *
 * 与卡面 `tavernStEvidence.ts` 同构、同一个目的：断言是人手对上游源码的转写，转写可以是对的，
 * 但如果没有机械绑定，谁都可以把断言改成"电子爱现在的行为"而不惊动任何测试。
 * 所以依据是**数据**：`wi.js` 引用 + 该行必须包含的原文片段。
 *
 * `tavern-world-file-target.test.js` 里那条闸（**不受开关门控**）负责：
 *   ① 标题与申报表一一对应、条数 == `WORLD_TARGET_COUNT`；
 *   ② 标题里写的 `wi.js` 依据必须都在申报表里；
 *   ③ 有 `wi.js` 的机器上，**逐条**把引用与摘录对照原文（index 漂移会报出"它现在在 wi.js:NNNN"）。
 *
 * ⚠️ 三轮订正（`.redgreen/60`）：本文件上一版表头写着"逐行命中由卡面套件那条闸统一负责"——
 * **不成立**：卡面那条闸只遍历 `SEMANTIC_EVIDENCE`，`setWorldInfo` 从来没被它看过。
 * 现在世界书面自己核（③）。
 *
 * 命名：`setWorldInfo` 是"世界书目标断言的申报表"（set = 申报）。
 */

export interface WorldTargetCitation {
  /** `wi.js:4939` 或 `wi.js:4113-4114`（范围写成整串，与用例标题里的写法必须**逐字一致**） */
  ref: string
  /** 该行（或该范围里至少一行）必须包含的原文片段 */
  snippet: string
}

export interface WorldTargetEvidence {
  /** 必须是 `tavern-world-file-target.test.js` 里用例的**完整标题** */
  title: string
  /** 这条断言在说什么（一句话） */
  claim: string
  citations: WorldTargetCitation[]
  /** 反向证据：这些字符串在 `wi.js` 全文里必须**0 命中** */
  fullTextAbsent?: string[]
}

export const setWorldInfo: WorldTargetEvidence[] = [
  {
    title: '世界书条目的键写成 /…/flags 时应被当作正则（酒馆 wi.js:339 `parseRegexFromString(needle)` 按键名自动识别）',
    claim: 'ST 按键名自动识别正则（不需要开关，wi.js 全文也没有 use_regex 这个键）。电子爱只在显式 use_regex 时才解析 /…/，而 ST 导出的世界书里没有该键。判据两半缺一不可：原样保留 /…/flags（剥定界符与合并 flags 是匹配器的活）+ 置 keywordUseRegex: true',
    citations: [{ ref: 'wi.js:339', snippet: 'const keyRegex = parseRegexFromString(needle);' }],
    fullTextAbsent: ['use_regex']
  },
  {
    title: '世界书导入路径应像卡导入路径一样过滤 MVU 基础设施条目（酒馆 wi.js:2104 `addMissingWorldInfoFields` 只补字段、不改变"哪条该进设定库"）',
    claim: '⚠️ 口径说明（独立评审 1.3）：这**不是**"与酒馆一致"的判据——ST 侧没有"某些条目不该成为设定"的概念（本表上一版的 claim 自己就写着这点），`addMissingWorldInfoFields` 只回填缺省字段时也确实不碰"哪条该进设定库"。它钉的是 **ElecKoi 两条导入路径彼此一致**（卡路径过滤 [initvar]/[mvu_update]，世界书路径不该例外）。红数里它仍是世界书面 4 条之一，但请按"内部一致性"读，别读成 ST 行为。用例里有正向控制（普通条目必须还在），否则"全过滤掉"也能过',
    citations: [{ ref: 'wi.js:2104', snippet: 'function addMissingWorldInfoFields(data) {' }]
  },
  {
    title: '世界书条目的顶层 selectiveLogic 应被读取（酒馆 wi.js:4090 定义在顶层、wi.js:4939 `entry.selectiveLogic ?? 0` 是世界书读取侧；wi.js:4930 只在有副键时才走到）',
    claim: 'ST 把 selectiveLogic 定义在条目的顶层字段集里，读世界书文件时按顶层字段读（wi.js:4939 在副键门 wi.js:4930 之后）。⚠️ 三轮订正：上一版引的是 `wi.js:5646`，那行在 `convertCharacterBook`（卡内嵌形状 → 运行时形状）里，恰恰不是世界书文件读取侧',
    citations: [
      { ref: 'wi.js:4090', snippet: "selectiveLogic: { default: world_info_logic.AND_ANY, type: 'enum' }" },
      { ref: 'wi.js:4939', snippet: 'const selectiveLogic = entry.selectiveLogic ?? 0;' },
      { ref: 'wi.js:4930', snippet: 'if (!hasSecondaryKeywords) {' }
    ]
  },
  {
    title: '世界书条目的驼峰 caseSensitive / matchWholeWords 应被读取（酒馆 wi.js:4113-4114 定义这两个顶层名、wi.js:2104 按同名回填）',
    claim: 'ST 落盘与回填都用驼峰这两个名字；导入器只读蛇形别名 ⇒ 标准 ST 世界书里两个开关被忽略',
    citations: [
      { ref: 'wi.js:4113-4114', snippet: "caseSensitive: { default: null, type: 'boolean?' }" },
      { ref: 'wi.js:2104', snippet: 'function addMissingWorldInfoFields(data) {' }
    ]
  }
]

/** 世界书目标断言的绝对条数闸：防"删一条用例、报告数字也跟着变小" */
export const WORLD_TARGET_COUNT = 4
