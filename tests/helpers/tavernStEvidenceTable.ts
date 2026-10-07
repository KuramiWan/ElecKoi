/**
 * 【判据绑定 · 数据】第 3 层那 13 条语义断言"凭什么说酒馆是这样"的申报表（纯数据，**import-free**）。
 *
 * 为什么与 `tavernStEvidence.ts` 分开（2026-10-07）：`scripts/generate-st-excerpts.mjs` 要读这张表去摘上游原文，
 * 而**测试用的 helper 不能被生成器 import**——`tavernStEvidence.ts` 里有 `stUpstream` 的依赖，Node 的 ESM
 * 解析不了无扩展名的相对导入（TS 的 `Bundler` 解析能）。数据放这里，两边读的是**同一份对象**，不会各写一份。
 * 同一套做法见 `tavernWiAnchors.ts`。
 *
 * 边界（必须诚实）：这张表是人手对上游的转写；闸只能保证"依据不被悄悄抽走 / 引用的行里确实有这段原文"，
 * 保证不了"转写本身对"——后者靠第二个人核或真实卡语料。
 */
export interface StCitation {
  /** `wi.js:5640` 或 `wi.js:33-38` */
  ref: string
  /** 该行（或该范围首尾行）必须包含的原文片段 */
  snippet: string
}

export type SemanticBasis =
  | { kind: 'st'; citations: StCitation[]; fullTextAbsent?: string[] }
  | { kind: 'ei'; reverseProof: { pattern: string; occurrences: number }; basis: string }

export interface SemanticEvidence {
  /** 必须是第 3 层用例的**完整标题**（标题里同时带着人可读的依据） */
  title: string
  /** 这条断言在说什么（一句话，给报告用） */
  claim: string
  basis: SemanticBasis
}

/** `wi.js:33-38` → [33, 38] */
export function refLines(ref: string): [number, number] {
  const match = /^wi\.js:(\d+)(?:-(\d+))?$/.exec(ref.trim())
  if (!match) throw new Error(`引用格式应为 wi.js:NNNN 或 wi.js:NNNN-NNNN，收到「${ref}」`)
  const first = Number(match[1])
  const last = match[2] ? Number(match[2]) : first
  if (last < first) throw new Error(`引用范围反了：「${ref}」`)
  return [first, last]
}

export const SEMANTIC_EVIDENCE: SemanticEvidence[] = [
  {
    title: '条目没写 enabled 时应导入成**停用**（酒馆 wi.js:5640 `disable: !entry.enabled`）',
    claim: '缺 enabled ⇒ 停用（电子爱相反：缺 enabled ⇒ 启用）',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5640', snippet: 'disable: !entry.enabled' }, { ref: 'wi.js:4801', snippet: 'if (entry.disable == true)' }] }
  },
  {
    title: '条目没写 selective 时副键不应生效（酒馆 wi.js:5634 `selective: entry.selective || false`）',
    claim: '卡导入路径里 selective 缺省是 false ⇒ 副键不参与',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5634', snippet: 'selective: entry.selective || false' }, { ref: 'wi.js:4924', snippet: 'const hasSecondaryKeywords = (' }] }
  },
  {
    title: 'selectiveLogic = 1 应落成"任一未命中"（酒馆 wi.js:33-38 的 NOT_ALL + 4955-4961）',
    claim: 'NOT_ALL = 1，且分支是"副键未命中即通过"',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:33-38', snippet: 'NOT_ALL: 1' }, { ref: 'wi.js:4959', snippet: 'if (selectiveLogic === world_info_logic.NOT_ALL && !hasSecondaryMatch) {' }] }
  },
  {
    title: 'extensions.case_sensitive = null 应表示"跟随全局"，不是布尔（酒馆 wi.js:5652 + 4113 是三态）',
    claim: '三态：null 表示跟随全局',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5652', snippet: 'caseSensitive: entry.extensions?.case_sensitive ?? null' }, { ref: 'wi.js:4113', snippet: "caseSensitive: { default: null, type: 'boolean?' }" }] }
  },
  {
    title: '条目映射：insertion_order 必须落进排序键 order（酒馆 wi.js:5635 `order: entry.insertion_order`）',
    claim: '卡里的 insertion_order 就是排序键 order（映射层；行为层另有用例）',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5635', snippet: 'order: entry.insertion_order' }, { ref: 'wi.js:88', snippet: 'const sortFn = (a, b) => b.order - a.order;' }] }
  },
  {
    title: '条目的关键词扫描深度应来自 extensions.scan_depth（酒馆 wi.js:5651 `scanDepth: entry.extensions?.scan_depth ?? null`）',
    claim: '条目级 scan_depth 会落进条目自己的 scanDepth',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5651', snippet: 'scanDepth: entry.extensions?.scan_depth ?? null' }] }
  },
  {
    title: '条目没写 extensions.role 时，注入角色应为 system（酒馆 wi.js:5656 `role: entry.extensions?.role ?? extension_prompt_roles.SYSTEM`）',
    claim: '缺省 role = SYSTEM（枚举数值不在工作区，未取证）',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5656', snippet: 'role: entry.extensions?.role ?? extension_prompt_roles.SYSTEM' }] }
  },
  {
    title: 'extensions.match_whole_words = null 也应表示"跟随全局"（酒馆 wi.js:5653 + 4114 是三态）',
    claim: '三态：null 表示跟随全局',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5653', snippet: 'matchWholeWords: entry.extensions?.match_whole_words ?? null' }, { ref: 'wi.js:4114', snippet: "matchWholeWords: { default: null, type: 'boolean?' }" }] }
  },
  {
    title: '条目同时有 name 与 comment 时标题应取 comment（酒馆 wi.js:5631 只认 comment）',
    claim: '卡导入路径不读 entry.name 当标题',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5631', snippet: "comment: entry.comment || ''" }, { ref: 'wi.js:5622', snippet: 'if (entry.id === undefined) {' }] }
  },
  {
    title: '常驻条目的关键词应保留（酒馆 wi.js:5629 无条件存 `key: entry.keys`）',
    claim: '常驻条目也把 key 存下来，不在导入时清空',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:5629', snippet: 'key: entry.keys' }, { ref: 'wi.js:4893', snippet: 'if (entry.constant) {' }] }
  },
  {
    title: '条目顶层 use_regex 不应改变匹配方式（酒馆全文 0 命中该键，只按 /…/flags 识别正则）',
    claim: 'ST 没有 use_regex 这个键；正则识别看键名是否写成 /…/flags',
    basis: { kind: 'st', citations: [{ ref: 'wi.js:2901', snippet: 'export function parseRegexFromString(input) {' }], fullTextAbsent: ['use_regex', 'useRegex'] }
  },
  {
    title: '被 getwi 字面量指向的条目不应被强制启用',
    claim: '电子爱的 EJS 引用会把条目强制启用；ST 侧只做反证（没有 getwi，且 enabled 只由卡决定）',
    basis: { kind: 'ei', reverseProof: { pattern: 'getwi', occurrences: 1 }, basis: 'ST 核心没有 getwi()：全文唯一命中是别名表 wi.js:1782；且 5632 原样存 content、5640 只由 enabled 决定 disable、5622-5674 逐条独立无跨条目状态' }
  },
  {
    title: '控制器里的 getwi 不是字面量时，不应改写整本书',
    claim: '同上：非字面量 getwi 导致电子爱把整本书按 EJS 引用处理，ST 侧无对应机制',
    basis: { kind: 'ei', reverseProof: { pattern: 'getwi', occurrences: 1 }, basis: '同上一行：ST 全文只有别名表命中（wi.js:1782），没有"按内容改写条目"的路径' }
  },
]

/** 第 3 层必须申报依据的条数（防"删一条用例、报告数字也跟着变小"） */
export const SEMANTIC_TEST_COUNT = 13
