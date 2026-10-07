/**
 * 世界书导出通道的字段清单：**第二条导入面的唯一真相**。
 *
 * 与 `tavernCardFieldManifest.ts` 的关系（重要）：
 *   - 卡清单（133 项）描述**卡导入路径**：输入是角色卡（`data.*` / `$top.*` / `$root.*`）。
 *   - 本清单描述**世界书导入路径**：输入是世界书导出通道（ST 自己的 `worlds/*.json` 形态，
 *     顶层 `entries`，条目键为 ST 拼写）。
 *   - **两个分母不合并**（`CONTEXT.md` 的「单列分母」）。
 *
 * 路径语法：`$worlds.<条目键>`，用 **ST 世界书文件自己的拼写**。
 *
 * ## 形状的事实来源（2026-10-05 对上游 v1.19.0 取证；两轮订正见 `.redgreen/58` / `60`）
 *
 * 三个位置必须分清（三轮验证 F3b 就是这里出的错）：
 *
 * - **世界书文件的字段集**（ST 落盘写什么）：`wi.js:4082-4125`（`newWorldInfoEntryDefinition`
 *   → `newWorldInfoEntryTemplate`）。`selectiveLogic` / `caseSensitive` / `matchWholeWords` /
 *   `depth` / `role` / `displayIndex` 等都在**顶层**；ST 另有 `addMissingWorldInfoFields`
 *   （`wi.js:2102-2130`）按**同一批名字**给老文件回填缺省值。**mapped 行的 `stReference` 指这里。**
 * - **世界书的读取侧**（谁在运行时消费这些名字）：`checkWorldInfo`（`wi.js:4709` 起）——
 *   例如 `const isActive = !entry.disable`（`wi.js:3339`）、`entry.selectiveLogic ?? 0`
 *   （`wi.js:4939`，副键门 `wi.js:4924-4930`）、按键名识别正则 `parseRegexFromString(needle)`
 *   （`wi.js:339`）。
 * - ⚠️ **`convertCharacterBook`（`wi.js:5617-5673`）不是世界书文件读取侧**：它把**卡内嵌**形状
 *   （`entry.keys` / `entry.secondary_keys` / `entry.extensions.*`）**转成**运行时的条目形状
 *   （`key` / `keysecondary` / `order` / `caseSensitive`…）——"读卡的输入、写世界的输出"。
 *   第一版把它当成世界书读入侧，据此漏判了 7 行（见下）。下面 `dropped` 行里引它的那些
 *   （`wi.js:5629-5668`）只用来证明"ST 的条目模型里有这个名字"，**不是**"ST 从世界书文件里读它"；
 *   真正的读取侧依据是上面那个定义 + `checkWorldInfo`。
 * - **电子爱的世界书导入路径**（`settingLibraryTransfer.js:307-346`）实际读的条目键是 **14 个**，
 *   见下面 `mapped()` 那批；其余键**根本没被读**（`dropped`），不是"读了但不用值"。
 *   ⚠️ 三轮订正（`.redgreen/60`，独立评审 2.1）：第一版漏了 `name` / `enabled` / `use_regex`
 *   三行（它们都在 `:311` / `:336` / `:331` 被读），分母从 11/48 变成 **14/51**。
 *   漏掉的原因值得记下来：夹具 `world-full.json` 恰好不含这三个键，所以
 *   "夹具里出现的键必须在清单里"这条闸**永远抓不到**——只有"清单里每行都要被夹具演练"
 *   那条才逼着补夹具；补了夹具，这三个键才同时被两条闸看见。
 *
 * ## 判定标准（与卡清单同义，逐字对齐）
 *
 *   `mapped`  = 世界书导入路径**读取了该键**，且结果里有可观察落点
 *   `dropped` = 没被读取
 *   `alignment: 'deviates'` = **mapped 行专用**：键被读了，但不按 ST 的值走
 *   `alignment: 'st-unread'` = ElecKoi 读、ST 的世界书文件里没有这个拼写（3 行：`name` / `enabled` / `use_regex`）
 *
 * ⚠️ 第一版把 7 行按"键名被读到、值被丢弃"记成 `mapped`，**那是错的**：
 * `uid` / `selective` / 顶层 `selectiveLogic` / 顶层 `caseSensitive` / 顶层 `matchWholeWords` /
 * `order` / `position` / `depth` / `role` / `displayIndex` 在导入器里**一次都没出现**
 * （`grep -n "item\.\(position\|depth\|role\|displayIndex\|order\|uid\|selective\)\b"
 * settingLibraryTransfer.js` → 0 命中）。所以它们全是 `dropped`，覆盖率从虚高的
 * 18/46 变成 **11/46**。二轮订正留档 `.redgreen/58`。
 */

export type WorldFieldStatus = 'mapped' | 'dropped'

export interface WorldFieldExpectation {
  /** `$worlds.` + ST 条目键名 */
  path: string
  status: WorldFieldStatus
  /** mapped：ElecKoi 落点（导入条目的字段名） */
  landing?: string
  /** mapped 专用：`aligned`（按 ST 的值走）、`deviates`（读了，但不按文件里的值走）或 `st-unread`（ElecKoi 读、ST 不读） */
  alignment?: 'aligned' | 'deviates' | 'st-unread'
  /** deviates 专用：差在哪（一句话，必须可核） */
  deviation?: string
  note?: string
  /** 该键在卡清单里的对应行（`data.character_book.entries[].<键>`），没有则省略 */
  viaCardRow?: string
  /** ST 侧源码位置 */
  stReference?: string
}

function mapped(path: string, landing: string, extra: Partial<WorldFieldExpectation> = {}): WorldFieldExpectation {
  return { path: `$worlds.${path}`, status: 'mapped', alignment: 'aligned', landing, ...extra }
}

/** ElecKoi 读了、ST 的世界书文件里**没有这个拼写**（`alignment: 'st-unread'`，与卡清单同名同义） */
function stUnread(path: string, landing: string, note: string): WorldFieldExpectation {
  return { path: `$worlds.${path}`, status: 'mapped', alignment: 'st-unread', landing, note }
}

function dropped(path: string, note: string, extra: Partial<WorldFieldExpectation> = {}): WorldFieldExpectation {
  return { path: `$worlds.${path}`, status: 'dropped', note, ...extra }
}

const CARD = 'data.character_book.entries[].'

export const worldFields: readonly WorldFieldExpectation[] = [
  // ── 真正被读的 14 个键 ────────────────────────────────────────────────────
  stUnread('name', 'entry.title', '标题的第一优先是 `item.name`（`settingLibraryTransfer.js:311`）；ST 的世界书条目定义里没有这个名字（`wi.js:4082-4125` 只有 `comment`）⇒ 标准 ST 世界书走 comment 分支，ElecKoi 多认一个别名'),
  mapped('comment', 'entry.title', {
    viaCardRow: `${CARD}comment`,
    stReference: 'wi.js:4085',
    note: '标题取 comment（`settingLibraryTransfer.js:311`）。⚠️ 三轮订正（`.redgreen/60`）：本条原写"卡里 name 优先、世界书路径反过来"，**与代码相反**——两条路都是 `name || comment || keys[0]`（`settingLibraryTransfer.js:311`、`characterCardFormats.ts:154`），name 都优先'
  }),
  mapped('content', 'entry.content', { viaCardRow: `${CARD}content`, stReference: 'wi.js:4086' }),
  mapped('key', 'entry.keywords', { viaCardRow: `${CARD}key`, stReference: 'wi.js:4083' }),
  mapped('keysecondary', 'entry.conditionKeywords', { viaCardRow: `${CARD}keysecondary`, stReference: 'wi.js:4084' }),
  mapped('keys', 'entry.keywords', {
    viaCardRow: `${CARD}keys`,
    note: '卡规范的键名（ST 自己的文件用 key）；ElecKoi 两种名字都接受'
  }),
  mapped('secondary_keys', 'entry.conditionKeywords', { viaCardRow: `${CARD}secondary_keys` }),
  mapped('constant', 'entry.agentReadStrategy', { viaCardRow: `${CARD}constant`, stReference: 'wi.js:4087' }),
  mapped('disable', 'entry.enabled', {
    viaCardRow: `${CARD}disable`,
    stReference: 'wi.js:4094, 3339',
    note: '`Object.hasOwn(item, "enabled") ? bool(item.enabled, true) : !bool(item.disable)`（`settingLibraryTransfer.js:336`）。ST 的激活判据是 `const isActive = !entry.disable`（`wi.js:3339`），定义 `disable: { default: false }`（`wi.js:4094`）⇒ 这一条两条路一致'
  }),
  stUnread('enabled', 'entry.enabled', '`item.enabled` 优先于 `item.disable`（`settingLibraryTransfer.js:336`）；ST 的世界书条目形状用 `disable`（`wi.js:3339` 的 `!entry.disable`，定义在 `wi.js:4094`），没有 `enabled` 这个名字 ⇒ 标准 ST 世界书走 disable 分支'),
  stUnread('use_regex', 'entry.keywordUseRegex', '`!constant && bool(item.use_regex)`（`settingLibraryTransfer.js:331`）；`wi.js` 全文 0 命中 `use_regex`——ST 只按键名 `/…/flags` 自动识别（`wi.js:339` `parseRegexFromString(needle)`）。标准 ST 世界书里没有这个键，这一支只在卡形态文件上生效'),
  mapped('case_sensitive', 'entry.keywordIgnoreCase', {
    alignment: 'deviates',
    deviation: '只读**蛇形** `item.case_sensitive`（`settingLibraryTransfer.js:332`），**不读** ST 落盘写的驼峰 `caseSensitive`（`wi.js:4082-4125` / `2102-2130`）⇒ 标准 ST 世界书里该值被忽略，恒落"忽略大小写"',
    stReference: 'wi.js:4113, 5652',
    note: '夹具两种拼写都放了：驼峰 `caseSensitive: true`（被忽略）与蛇形 `case_sensitive: true`（读到）；`extensions.case_sensitive` 同样被读'
  }),
  mapped('match_whole_words', 'entry.keywordWholeWord', {
    alignment: 'deviates',
    deviation: '只读**蛇形** `item.match_whole_words`（`settingLibraryTransfer.js:333`），**不读**驼峰 `matchWholeWords` ⇒ 标准 ST 世界书里该值被忽略，恒落"不整词匹配"',
    stReference: 'wi.js:4114, 5653',
    note: '与 `case_sensitive` 同一类：ST 落盘的拼写与导入器读的拼写不一致；`extensions.match_whole_words` 同样被读'
  }),
  mapped('extensions', 'entry.keywordCondition', {
    alignment: 'deviates',
    deviation: '只从袋子里读**一个**键 `extensions.selectiveLogic`（`:313`）与两个蛇形别名 `extensions.case_sensitive` / `extensions.match_whole_words`（`:332-333`）；ST 会读的其余 ~25 个 `extensions.*` 键（probability / depth / role / group…）一概不读。而且 ST 落盘写的 `selectiveLogic` 在**顶层**，见下面 `selectiveLogic` 行',
    stReference: 'wi.js:5617-5673, 4082-4125',
    note: '整行按"袋子被部分读取"记 mapped+deviates；袋子里的其余键不逐条声明（否则测量面会变成"列出 ST 的所有扩展"）。这是**聚合**，与卡清单用 `valueMap` 处理书级扩展袋同一个取舍'
  }),

  // ── 没被读的：ST 会读，但电子爱读的是**别的拼写**或压根不读 ────────────────
  dropped('selectiveLogic', 'ST 落盘写在**顶层**（`wi.js:4082-4125`）；导入器只读 `item.extensions.selectiveLogic`（`:313`）⇒ 标准 ST 世界书里副键逻辑被忽略，恒落 any。**这是与卡路径同一个字段的相反表现**：卡清单里 `extensions.selectiveLogic` 是 deviates（读到了但落错），世界书路径是顶层那个拼写根本没出现', {
    viaCardRow: `${CARD}extensions.selectiveLogic`,
    stReference: 'wi.js:4939, 4924-4930, 4090'
  }),
  dropped('caseSensitive', 'ST 落盘写的驼峰拼写；导入器读的是蛇形 `case_sensitive`', {
    viaCardRow: `${CARD}extensions.case_sensitive`,
    stReference: 'wi.js:4113'
  }),
  dropped('matchWholeWords', '同上：ST 落盘写驼峰，导入器读蛇形', {
    viaCardRow: `${CARD}extensions.match_whole_words`,
    stReference: 'wi.js:4114'
  }),
  dropped('selective', '导入器**一次都没读** `selective`（`grep selective settingLibraryTransfer.js` 只命中 `:313` 的 `extensions?.selectiveLogic`）；`keywordCondition` 只由 `constant || !secondary.length` 决定 ⇒ 只要有条目级副键就落 any，与卡里的 `selective` 无关。卡清单里同一个字段是 P0-3 缺口', {
    viaCardRow: `${CARD}selective`,
    stReference: 'wi.js:4089, 4924-4930'
  }),
  dropped('uid', '导入器不读它：条目 id 由 `createId("tavern-world-entry")` 新生成（`:316`），不复用文件里的 uid。与卡清单 `entries[].id` 同一条判定（P1-8）', {
    viaCardRow: `${CARD}id`,
    stReference: 'wi.js:5622-5628'
  }),
  dropped('order', '导入器不读它：`order` 硬编码为 `index + 1`（`:340`）。ST 的 `insertion_order` 在世界书文件里叫 order（`wi.js:5635`）', {
    viaCardRow: `${CARD}insertion_order`,
    stReference: 'wi.js:5635'
  }),
  dropped('position', '导入器不读它：硬编码 `insert_point_1`（`:337`）。文件里是数字枚举（`wi.js:855-863`）', {
    viaCardRow: `${CARD}extensions.position`,
    stReference: 'wi.js:5636, 855-863'
  }),
  dropped('depth', '导入器不读它：硬编码 `keywordScanDepth: 1`（`:328`）', {
    viaCardRow: `${CARD}extensions.depth`,
    stReference: 'wi.js:5645'
  }),
  dropped('role', '导入器不读它：硬编码 `insertRole: "user"`（`:339`）', {
    viaCardRow: `${CARD}extensions.role`,
    stReference: 'wi.js:5656'
  }),
  dropped('displayIndex', '导入器不读它：硬编码 `viewOrder: index + 1`（`:341`）', {
    viaCardRow: `${CARD}extensions.display_index`,
    stReference: 'wi.js:5642'
  }),

  // ── 触发调度（两条路都不读）─────────────────────────────────────────────
  dropped('probability', 'ST 会读（wi.js:5643）；两条路都不读', { viaCardRow: `${CARD}extensions.probability`, stReference: 'wi.js:5643' }),
  dropped('useProbability', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.useProbability` }),
  dropped('group', 'ST 会读（wi.js:5648）；两条路都不读', { viaCardRow: `${CARD}extensions.group`, stReference: 'wi.js:5648' }),
  dropped('groupOverride', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.group_override` }),
  dropped('groupWeight', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.group_weight` }),
  dropped('sticky', 'ST 会读（wi.js:5658）；两条路都不读', { viaCardRow: `${CARD}extensions.sticky`, stReference: 'wi.js:5658' }),
  dropped('cooldown', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.cooldown` }),
  dropped('delay', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.delay` }),
  dropped('scanDepth', 'ST 会读（wi.js:5651）；两条路都不读', { viaCardRow: `${CARD}extensions.scan_depth`, stReference: 'wi.js:5651' }),
  dropped('useGroupScoring', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.use_group_scoring` }),
  dropped('automationId', 'ST 会读；两条路都不读（设计如此：消费方是 Quick Reply 扩展）', { viaCardRow: `${CARD}extensions.automation_id` }),
  dropped('vectorized', 'ST 会读；两条路都不读（设计如此：消费方是 ST 向量扩展）', { viaCardRow: `${CARD}extensions.vectorized` }),
  dropped('triggers', 'ST 会读（wi.js:5668）；两条路都不读', { viaCardRow: `${CARD}extensions.triggers`, stReference: 'wi.js:5668' }),
  dropped('ignoreBudget', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.ignore_budget` }),
  dropped('excludeRecursion', 'ST 会读（wi.js:5637）；两条路都不读', { viaCardRow: `${CARD}extensions.exclude_recursion`, stReference: 'wi.js:5637' }),
  dropped('preventRecursion', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.prevent_recursion` }),
  dropped('delayUntilRecursion', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.delay_until_recursion` }),
  dropped('outletName', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.outlet_name` }),
  dropped('matchPersonaDescription', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.match_persona_description` }),
  dropped('matchCharacterDescription', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.match_character_description` }),
  dropped('matchCharacterPersonality', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.match_character_personality` }),
  dropped('matchCharacterDepthPrompt', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.match_character_depth_prompt` }),
  dropped('matchScenario', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.match_scenario` }),
  dropped('matchCreatorNotes', 'ST 会读；两条路都不读', { viaCardRow: `${CARD}extensions.match_creator_notes` }),

  // ── 编辑器专用（ST 运行时也不读）──────────────────────────────────────────
  dropped('addMemo', 'ST 运行时也不读（编辑器备注）。**没有 `viaCardRow`**：卡清单没有这一行（它是世界书导出的产物，不是卡字段）'),
  dropped('priority', 'ST 运行时也不读（只有编辑器排序 UI 用）', { viaCardRow: `${CARD}priority` }),
  dropped('id', 'ST 运行时也不读（编辑器列表用）', { viaCardRow: `${CARD}id` })
]

/** 参考覆盖数：mapped / 全部声明行。**世界书导入路径自己的分母**，不并入卡清单的 133。 */
export function worldCoverage(): { mapped: number; total: number; percent: number } {
  const mapped = worldFields.filter((field) => field.status === 'mapped').length
  const total = worldFields.length
  return { mapped, total, percent: Math.round((mapped / total) * 1000) / 10 }
}

/** 有 alignment: deviates 的 mapped 行：读了键，但不按文件里的值走 */
export function worldDeviations(): WorldFieldExpectation[] {
  return worldFields.filter((field) => field.alignment === 'deviates')
}
