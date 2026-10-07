/**
 * 【wi.js 侧引用的登记表】世界书清单里出现的每个 `wi.js:NNNN` 都必须登记在这里，
 * 且登记的那一行必须**真的**包含这段原文。
 *
 * 为什么补：`wi.js` 侧原来只有那 4 条世界书**目标断言**的申报表有闸（`tavernWorldFileTargetEvidence.ts`），
 * 而 51 行清单里的 `wi.js:*` 引用**零闸**——三轮独立验证实测两处已经指错行（`disable` 引 5641，
 * 那是 `addMemo`；`disable` 的定义引 4087，那是 `constant`）。这与电子爱侧行号的闸同一个目的。
 *
 * 约定：范围（`wi.js:4082-4125`）只登记**起始行**；`wi.js:4113, 5652` 这种一串里每个逗号段
 * 各取第一个数字。所以这张表是"引用锚点"的集合，不是"提到过的每一行"。
 *
 * 为什么单独成一个文件（2026-10-07）：`scripts/generate-st-excerpts.mjs` 要把这张表喂给
 * `tests/fixtures/st-upstream/excerpts.json`，而**测试文件不能被生成器 import**（会连带加载 vitest
 * 与产品模块）。数据搬到 helper 后，测试与生成器读的是同一份对象，不会各写一份。
 */
export const ST_CITATIONS: Record<number, string> = {
  339: 'const keyRegex = parseRegexFromString(needle);',
  855: 'export const world_info_position = {',
  2102: '* @returns {any[]} Data with backfilled fields',
  3339: 'const isActive = !entry.disable;',
  4082: 'export const newWorldInfoEntryDefinition = {',
  4083: 'key: { default: [], type: \'array\' },',
  4084: 'keysecondary: { default: [], type: \'array\' },',
  4085: 'comment: { default: \'\', type: \'string\' },',
  4086: 'content: { default: \'\', type: \'string\' },',
  4087: 'constant: { default: false, type: \'boolean\' },',
  4089: 'selective: { default: true, type: \'boolean\' },',
  4090: 'selectiveLogic: { default: world_info_logic.AND_ANY, typ',
  4094: 'disable: { default: false, type: \'boolean\' },',
  4113: 'caseSensitive: { default: null, type: \'boolean?\' },',
  4114: 'matchWholeWords: { default: null, type: \'boolean?\' },',
  4709: 'export async function checkWorldInfo(chat, maxContext, i',
  4924: 'const hasSecondaryKeywords = (',
  4939: 'const selectiveLogic = entry.selectiveLogic ?? 0; // If ',
  5617: 'export function convertCharacterBook(characterBook) {',
  5622: 'if (entry.id === undefined) {',
  5629: 'key: entry.keys,',
  5635: 'order: entry.insertion_order,',
  5636: 'position: entry.extensions?.position ?? (entry.position ',
  5637: 'excludeRecursion: entry.extensions?.exclude_recursion ??',
  5642: 'displayIndex: entry.extensions?.display_index ?? index,',
  5643: 'probability: entry.extensions?.probability ?? 100,',
  5645: 'depth: entry.extensions?.depth ?? DEFAULT_DEPTH,',
  5648: 'group: entry.extensions?.group ?? \'\',',
  5651: 'scanDepth: entry.extensions?.scan_depth ?? null,',
  5652: 'caseSensitive: entry.extensions?.case_sensitive ?? null,',
  5653: 'matchWholeWords: entry.extensions?.match_whole_words ?? ',
  5656: 'role: entry.extensions?.role ?? extension_prompt_roles.S',
  5658: 'sticky: entry.extensions?.sticky ?? null,',
  5668: 'triggers: entry.extensions?.triggers || [],',
}
