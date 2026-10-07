/**
 * 酒馆角色卡字段清单：本夹具套件的唯一真相。
 *
 * 判定标准（见 docs：spec-character-card-fidelity.md 的「判定标准」）：
 *   mapped  = 主进程导入路径读取了该字段，且结果里有可观察落点
 *   dropped = 没被读取（不含"读了但值被忽略"——那种取值差异用 deviates 表达）
 *
 * 路径语法：以 ST 侧原始 JSON 路径为准。根为 `data`；数组用 `[]`；纯 V1 扁平卡用 `$root`。
 *   - 条目内字段：data.character_book.entries[].keys
 *   - 数组元素为标量时不再加 `[]`：data.tags、data.alternate_greetings
 *
 * 证据边界（重要）：`stReference` 覆盖**两个** ST 侧证据面——
 *   ① **卡内嵌世界书的导入面**：SillyTavern `world-info.js`，工作区文件 `wi.js`；
 *   ② **卡级字段的"卡 → 提示词"面**（2026-10-05 起）：SillyTavern `script.js` /
 *      `scripts/openai.js` / `scripts/PromptManager.js` / `src/endpoints/characters.js`，
 *      工作区副本在 `.st-upstream/`（**不进仓库**，仓库外只在 `/tmp` 是临时目录）。
 * 两条引用都写上游**版本**（`ST v1.19.0`）与 `文件:行号`，并配一行摘录兜底：行号会随上游漂移，
 * 摘录用于回定位（`wi.js` 侧的既有约定不变）。
 * 参考版本：SillyTavern v1.19.0 @ `06bde939fb1e9c4c8d8641d810f0a916b5bce127`（2026-09-14）。
 * 仍是**未核实**的（不写 `stReference`，只留审计编号）：`creator_notes` / `creator` /
 * `character_version` / `tags` / `nickname` / `assets` / `depth_prompt` 等非 P0-2 卡级字段。
 *
 * `stIgnores: true` = ST 自己也不读该字段。这种 dropped **不是兼容缺口**，只是双方都不使用。
 *
 * 证据边界（补充，2026-09-30 独立审计后订正）：
 * - **书级字段**（`character_book.description/scan_depth/token_budget/recursive_scanning/extensions`）
 *   按 `wi.js` 判定：ST 的卡导入只读书级 `name`（`wi.js:5698/5744/5753` 是 `character_book` 的全部命中）。
 *   若把 ST 前端（卡片编辑界面）也算进"ST 会读"，这五行需要重新判定。
 * - **MVU 面**（`data.extensions.tavern_helper.*`）按 TavernHelper 扩展生态判定，不按 ST 核心：
 *   该键在 `wi.js` 全文 0 命中，所以这里**不用** `st-unread` 标它。
 * - **卡内正则面**的 ST 侧证据不在 `wi.js`（在 ST 的 regex 扩展里），只依据 ElecKoi 侧读取判定。
 *   ElecKoi 自己的导出键 `scope` 刻意不声明：它不是 ST 卡内正则的字段。
 *
 * 落点语法补充：谓词支持内容锚点，例如 `[content=PROBE notall 正文]`；锚点值里**不能含 `.`**
 * （落点按 `.` 切段）。优先用内容锚点而不是标题锚点：标题会被去重后缀改写（`重名条目 (2)`）。
 */

export type TavernFieldStatus = 'mapped' | 'dropped'

/** 仅对 mapped 有意义 */
export type TavernFieldAlignment =
  /** 读到了，且与 ST 语义一致 */
  | 'aligned'
  /** 读到了，但与 ST 语义不一致 */
  | 'deviates'
  /** 读到了，但 ST 本身不读这个字段 */
  | 'st-unread'

/** 仅对 dropped 有意义 */
export type TavernDroppedReason =
  /** ST 会读，ElecKoi 不读：待修的缺口（没有公开依据时一律归此类） */
  | 'known-gap'
  /** 有公开依据的取舍（README 定位声明或维护者公开表态） */
  | 'by-design'
  /** 字段所属的载体整体不被接受 */
  | 'unsupported-carrier'

export interface TavernFieldExpectation {
  /** ST 侧原始 JSON 路径 */
  path: string
  status: TavernFieldStatus
  /** mapped：ElecKoi 落点路径，语法见 tavernCardFixtures.ts 的 resolveLanding */
  landing?: string
  alignment?: TavernFieldAlignment
  /**
   * deviates 专用：把"分歧"也钉住（修好后会红，提示改回 aligned）。
   * observed 是**子串**语义：它必须出现在落点值的 JSON 序列化结果里。
   */
  deviation?: { observed: string; expected: string }
  droppedReason?: TavernDroppedReason
  /** dropped：对齐工作区兼容性审计的分级编号 */
  tracking?: string
  /** ST 侧源码位置（仅世界书面） */
  stReference?: string
  /** ST 侧一行摘录（≤80 字符），行号漂移后用于检索回定位 */
  stSnippet?: string
  /** ST 自己也不读该字段 */
  stIgnores?: true
  /**
   * 该路径是「用户数据字典」：键名是数据不是结构（世界书书级 extensions、MVU 变量表）。
   * harness 记下这条路径后不再下钻，因此夹具可以放任意键；值级哨兵扫描按整棵子树做。
   */
  valueMap?: true
  note?: string
}

type Extra = Partial<TavernFieldExpectation>

function mapped(path: string, landing: string, extra: Extra = {}): TavernFieldExpectation {
  return { path, status: 'mapped', landing, alignment: 'aligned', ...extra }
}

/**
 * `deviation` 是**子串**语义的钉子，只适合能被某个字符串/数字表达的取值差异。
 * 差异只体现在"缺省值不同"时（例如 enabled 缺省），用 `mapped(..., { alignment: 'deviates' })`
 * 在清单里记口径，并在定性用例里钉住行为——不要编一个假钉子的 `observed`。
 */
function deviates(path: string, landing: string, observed: string, expected: string, extra: Extra = {}): TavernFieldExpectation {
  return { path, status: 'mapped', landing, alignment: 'deviates', deviation: { observed, expected }, ...extra }
}

function stUnread(path: string, landing: string, note: string, extra: Extra = {}): TavernFieldExpectation {
  return { path, status: 'mapped', landing, alignment: 'st-unread', note, ...extra }
}

function dropped(path: string, tracking: string, extra: Extra = {}): TavernFieldExpectation {
  return { path, status: 'dropped', droppedReason: 'known-gap', tracking, ...extra }
}

/** ST 也不读：不是缺口 */
function unused(path: string, note: string, extra: Extra = {}): TavernFieldExpectation {
  return { path, status: 'dropped', stIgnores: true, note, ...extra }
}

function unsupported(path: string, tracking: string, note: string): TavernFieldExpectation {
  return { path, status: 'dropped', droppedReason: 'unsupported-carrier', tracking, note }
}

const BOOK = 'data.character_book.entries[]'
const TAVERN_HELPER = 'data.extensions.tavern_helper'

export const tavernCardFields: readonly TavernFieldExpectation[] = [
  // ── 卡片信封 ───────────────────────────────────────────────────────────────
  dropped('spec', 'P0-1', { note: '解码不区分 V2/V3 版本标记，只要求 data 存在' }),
  dropped('spec_version', 'P0-1', { note: '同上；V1 扁平卡因缺少 data 整体被拒收' }),

  // ── 卡级字段（data.*）────────────────────────────────────────────────────
  mapped('data.name', 'packageData.character.name'),
  mapped('data.description', 'settingLibrary.entries[title=角色描述].content'),
  mapped('data.first_mes', 'settingLibrary.entries[title=AI角色开场白].openingMessages[].content'),
  mapped('data.alternate_greetings', 'settingLibrary.entries[title=AI角色开场白].openingMessages[]', {
    note: '导入时按内容去重'
  }),
  mapped('data.character_book', 'settingLibrary.entries[groupId=tavern-world-book]'),
  mapped('data.extensions.regex_scripts', 'regexRules'),
  mapped('data.extensions.tavern_helper', 'variableConfig'),

  dropped('data.personality', 'P0-2', {
    stReference: 'ST v1.19.0 script.js:3440, 3341-3351; characters.js:504-551; openai.js:1379',
    stSnippet: 'return baseChatReplace(character.personality?.trim())',
    note: '独立核实（2026-10-05）：ST 运行时读**顶层** character.personality——characters.js:504 的 readFromV2（V2/V3 都走它，spec 无关）把 data.personality 镜像到顶层（characters.js:525-551，:551 的 char[charField] = v2Value 是落点），**只在 v2 值有定义时**才镜像（缺键时 :545 直接 return）。script.js:3440 取顶层值 → 3341-3351 的 baseChatReplace（trim + 宏替换 + 去 \\r）→ 5288 传给 OpenAI 路径 → openai.js:1369 套 personality_format（缺省 "{{personality}}"）→ openai.js:1379 作为 system 消息，identifier=charPersonality。**无 chat_metadata 覆盖**（全树没有 chat_metadata.personality）'
  }),
  dropped('data.scenario', 'P0-2', {
    stReference: 'ST v1.19.0 script.js:3445, 3341-3351; openai.js:1368, 1380',
    stSnippet: "const scenarioText = chat_metadata.scenario || character.scenario || ''",
    note: '独立核实（2026-10-05）：顶层 character.scenario（同上镜像，只在已定义时），**chat_metadata.scenario 优先**（组卡路径同理：group-chats.js:561 的 scenarioOverride）；3341-3351 baseChatReplace → openai.js:1368 套 scenario_format（缺省 "{{scenario}}"）→ openai.js:1380 system 消息，identifier=scenario'
  }),
  dropped('data.mes_example', 'P0-2', {
    stReference: 'ST v1.19.0 script.js:3451, 3501-3515, 4616; openai.js:1101-1134',
    stSnippet: "const exampleDialog = chat_metadata.mes_example || character.mes_example || ''",
    note: '独立核实（2026-10-05）：顶层 character.mes_example（同上镜像），**chat_metadata.mes_example 优先**；script.js:3501-3515 parseMesExamples 按 <START> 切块（缺 <START> 时补一个）→ script.js:4616 → openai.js:1101-1134 populateDialogueExamples，落到 dialogueExamples 位置（**受 token 预算裁剪**，预算不够就整块不放）'
  }),
  dropped('data.system_prompt', 'P0-2', {
    stReference: 'ST v1.19.0 script.js:3413-3417; openai.js:1492-1498; power-user.js:203; default/content/settings.json:146',
    stSnippet: 'return power_user.prefer_character_prompt ? baseChatReplace(systemPrompt.trim()) : \'\'',
    note: '独立核实（2026-10-05）：ST **条件读取**——chat_metadata.system_prompt 优先，其次 character.data.system_prompt（**无顶层镜像**：readFromV2 的 fieldMappings 不含它），且只有 power_user.prefer_character_prompt 为真才非空（缺省 true：power-user.js:203 与 default/content/settings.json:146 两处都是 true，无迁移代码）。**注意这个覆盖在闸门之内**：prefer 为 false 时连 chat 级覆盖也一起被忽略。非空时在 openai.js:1492-1498 整段**替换** main 的内容（forbid_overrides 或该角色禁用 main 时不替换）；文本补全路径另有 power_user.sysprompt.enabled 闸门（script.js:4688）'
  }),
  dropped('data.post_history_instructions', 'P0-2', {
    stReference: 'ST v1.19.0 script.js:3418-3421; openai.js:1500-1508; power-user.js:204; default/content/settings.json:147',
    stSnippet: "return power_user.prefer_character_jailbreak ? baseChatReplace(character.data?.post_history_instructions?.trim()) : ''",
    note: '独立核实（2026-10-05）：ST **条件读取**——只读 character.data.post_history_instructions（**无顶层镜像**、**无 chat_metadata 覆盖**；`script.js:3420` 是唯一**喂给 jailbreak** 的读取点——全树另有 slash-commands.js:5548 与若干编辑器 UI 读取，都不进提示词），且只有 power_user.prefer_character_jailbreak 为真才非空（缺省 true，两处一致）。非空时在 openai.js:1500-1508 整段**替换** jailbreak（历史后指令）的内容'
  }),
  dropped('data.creator_notes', 'P2-6'),
  dropped('data.creator', 'P2-6'),
  dropped('data.character_version', 'P2-6'),
  dropped('data.tags', 'P2-6'),
  dropped('data.nickname', 'P1-8'),
  dropped('data.group_only_greetings', 'P1-8'),
  dropped('data.assets[].type', 'P1-8', { note: 'V3 素材（sourceImage 只在 PNG 载体路径保留）' }),
  dropped('data.assets[].uri', 'P1-8'),
  dropped('data.extensions.depth_prompt.depth', 'P2-6', { note: '作者注释（depth prompt）' }),
  dropped('data.extensions.depth_prompt.prompt', 'P2-6'),
  dropped('data.extensions.depth_prompt.role', 'P2-6', { note: '真卡语料发现（12/13 张）：作者注释的注入角色；与 .depth/.prompt 同属 depth_prompt 信封' }),
  dropped('data.extensions.talkativeness', 'P2-6'),
  dropped('data.extensions.fav', 'P2-6'),
  dropped('data.extensions.world', 'P1-1', {
    stReference: 'ST v1.19.0 world-info.js:4481-4483; 1127-1128',
    stSnippet: 'const baseWorldName = character?.data?.extensions?.world;',
    note: '独立核实（2026-10-05 二轮订正，从 P2-6 提级）：不是元信息——它指向一本**独立世界书**（ST 自己 worlds/*.json 的文件名）。ST 在**激活时**按它决定加载哪本（getCharacterLore 把书名收进 worldsToSearch，`wi.js:4481-4483`；slash 命令 /getcharbook 走 `wi.js:1127-1128`），"角色卡 + 独立世界书"在酒馆里是一体的。真卡语料 13 张里 12~13 张写了它。**订正说明**：第一版引的是 `characters.js:628-644`（charaFormatData 里的世界书挂载），实测那只在 /create 与 /edit 两个**表单端点**上跑到（`characters.js:1030/1114`），V2/V3 卡导入走的是 readFromV2（`:504-553`），根本不碰世界书文件——所以那条引用指向的不是卡导入路径'
  }),

  // ── V2/V3 卡片的**顶层镜像字段**（真卡语料发现：11/13 张带）────────────────
  // 路径约定：`canonicalPaths` 对带 `data` 的卡不加前缀，所以这些行没有 `data.` 前缀；
  // 它们与 `data.*` 并存，权威副本在 `data`，两边都不读顶层 —— 记 stIgnores，不是缺口。
  unused('name', 'V2/V3 顶层镜像：权威副本是 data.name（wi.js 的卡导入走 data.*）'),
  unused('description', 'V2/V3 顶层镜像：权威副本是 data.description'),
  unused('personality', 'V2/V3 顶层镜像：权威副本是 data.personality'),
  unused('scenario', 'V2/V3 顶层镜像：权威副本是 data.scenario'),
  unused('first_mes', 'V2/V3 顶层镜像：权威副本是 data.first_mes'),
  unused('mes_example', 'V2/V3 顶层镜像：权威副本是 data.mes_example'),
  unused('tags', 'V2/V3 顶层镜像：权威副本是 data.tags'),
  unused('avatar', 'V2/V3 顶层镜像：头像文件名，卡导入不读（图片另走 sourceImage）'),
  unused('data.avatar', '有的卡把头像文件名也放进 data（顶层另有一份）；卡导入不读'),
  unused('creatorcomment', 'V2/V3 顶层镜像（旧字段名）：权威副本是 data.creator_notes'),
  unused('create_date', 'V2/V3 顶层镜像：创建时间，卡导入不读'),
  unused('talkativeness', 'V2/V3 顶层镜像：权威副本是 data.extensions.talkativeness'),
  unused('fav', 'V2/V3 顶层镜像：权威副本是 data.extensions.fav'),

  // ── MVU / TavernHelper 的**脚本信封**（真卡语料发现：10–11/13 张带）──────────
  // 这些键的消费方是 TavernHelper 前端扩展，不是 ST 的卡导入路径（wi.js 不读）；
  // 前端扩展运行环境按 README 定位声明不在兼容目标内 → stIgnores。
  unused(`${TAVERN_HELPER}.scripts[].id`, 'TavernHelper 脚本信封：扩展内部编号，卡导入不读'),
  unused(`${TAVERN_HELPER}.scripts[].info`, 'TavernHelper 脚本信封：脚本说明，卡导入不读'),
  unused(`${TAVERN_HELPER}.scripts[].type`, 'TavernHelper 脚本信封：脚本类型（扩展用来分派），卡导入不读'),
  unused(`${TAVERN_HELPER}.scripts[].button.buttons`, 'TavernHelper 脚本信封：按钮容器（空数组/对象形态；前端扩展消费）'),
  unused(`${TAVERN_HELPER}.scripts[].button.enabled`, 'TavernHelper 脚本信封：按钮开关（前端扩展消费）'),
  unused(`${TAVERN_HELPER}.scripts[].button.buttons[].name`, 'TavernHelper 脚本信封：按钮名（前端扩展消费）'),
  unused(`${TAVERN_HELPER}.scripts[].button.buttons[].visible`, 'TavernHelper 脚本信封：按钮可见性（前端扩展消费）'),
  unused(`${TAVERN_HELPER}.scripts[].export_with.button`, 'TavernHelper 脚本信封：导出用的按钮配置（前端扩展消费）'),
  unused(`${TAVERN_HELPER}.scripts[].export_with.data`, 'TavernHelper 脚本信封：导出附带数据（前端扩展消费）'),

  // ── 卡内嵌世界书容器 ─────────────────────────────────────────────────────
  mapped('data.character_book.name', 'settingLibrary.name', {
    stReference: 'wi.js:5744',
    stSnippet: "const bookName = characters[chid]?.data?.character_book?.name || ..."
  }),
  // 书级这五个字段 ST 的卡导入都不读：记成 stIgnores，不是兼容缺口
  unused('data.character_book.description', 'ST 的卡导入不读书级 description；wi.js 里 character_book 只出现 5 次，唯一被读的书级字段是 name'),
  unused('data.character_book.scan_depth', 'ST 读的是**条目级** extensions.scan_depth（见那一行）；书级这个键在 wi.js 全文 0 命中'),
  unused('data.character_book.token_budget', 'ST 的预算是全局设置与运行时局部状态（token_budget_overflowed），不是卡字段'),
  unused('data.character_book.recursive_scanning', 'wi.js 全文 0 命中；递归由全局 world_info_recursive 控制'),
  unused('data.character_book.extensions', '书级扩展 ST 不读（它读的是条目级 extensions）。下面挂的是任意用户数据', { valueMap: true }),

  // ── 世界书条目：卡规范字段 ────────────────────────────────────────────────
  dropped(`${BOOK}.id`, 'P1-8', {
    stReference: 'wi.js:5622-5628',
    stSnippet: 'entry.id ?? index',
    note: '条目身份由导入时新生成 UUID，原始 id 未保留（重导入无法对齐同一份世界书）'
  }),
  mapped(`${BOOK}.keys`, 'settingLibrary.entries[].keywords', {
    alignment: 'deviates',
    stReference: 'wi.js:337-341, 5629',
    stSnippet: 'const keyRegex = parseRegexFromString(needle); if (keyRegex) { return keyRegex.test(haystack); }',
    note: 'ST 按键名自动识别正则：键写成 /…/flags 就当正则跑（wi.js:337-341 的 matchKeys → parseRegexFromString），不需要任何开关；ElecKoi 只在条目显式带 use_regex 时才当正则（characterCardFormats.ts:196 取 item.use_regex），而 ST 自己导出的卡与卡规范形态**没有**这个键 ⇒ 该关键词按**字面量**比对，永不命中：导入不报错、关键词静默失效。夹具 v3-worldbook-regex-key.json 钉住这一形态。**另外三类情况会丢掉 keywords 与副键**：①常驻条目（constant 为真 ⇒ keywords/conditionKeywords 置空、keywordCondition 置 none；酒馆不丢，wi.js:5629 无条件存 key）；②EJS 控制器条目（正文含 <%）；③EJS 引用条目——被 getwi 字面量指向的条目，或控制器用了非字面量 getwi 时的**全部非控制器条目**（characterCardFormats.ts:166-168）。②③是静默改写。**②③都没有被夹具钉住**：给夹具加一条"显式 enabled: false 的 EJS 引用条目"会让本行的落点变空（该条目的 keywords 被清空），需要同时改本行的判定，见文档「导入时会被改写的条目」'
  }),
  mapped(`${BOOK}.key`, 'settingLibrary.entries[].keywords', {
    note: 'ST 自己世界书载体里的主键名；只在**数组**形态被接受（字符串形态会被忽略）'
  }),
  mapped(`${BOOK}.keysecondary`, 'settingLibrary.entries[].conditionKeywords', {
    note: '同上，副键的 ST 载体名；卡规范用 secondary_keys'
  }),
  deviates(`${BOOK}.secondary_keys`, 'settingLibrary.entries[].conditionKeywords', 'PROBE-SUB-sel-false', 'ST 的卡导入里 selective 缺省是 false（wi.js:5634 覆盖了模板的 true），所以未写 selective 的条目 ST 一律忽略副键；ElecKoi 不读 selective，副键始终生效', {
    stReference: 'wi.js:5630, 4924-4928',
    stSnippet: 'keysecondary: entry.secondary_keys || []'
  }),
  mapped(`${BOOK}.comment`, 'settingLibrary.entries[].title', {
    stReference: 'wi.js:5631',
    stSnippet: "comment: entry.comment || ''",
    note: '逐字段看没有偏差，但组合语义有：ElecKoi 用 name || comment || keys[0] 生成标题（name 优先），ST 只认 comment。卡里同时有 name 和 comment 时，ElecKoi 的标题是 name、ST 的 memo 是 comment'
  }),
  stUnread(`${BOOK}.name`, 'settingLibrary.entries[].title', 'ST 用 comment/key 生成标题，不读 name'),
  mapped(`${BOOK}.content`, 'settingLibrary.entries[].content', {
    stReference: 'wi.js:5632',
    stSnippet: 'content: entry.content'
  }),
  mapped(`${BOOK}.constant`, 'settingLibrary.entries[].agentReadStrategy', {
    stReference: 'wi.js:5633',
    stSnippet: 'constant: entry.constant'
  }),
  mapped(`${BOOK}.enabled`, 'settingLibrary.entries[].enabled', {
    alignment: 'deviates',
    stReference: 'wi.js:5640, 4801',
    stSnippet: 'disable: !entry.enabled',
    note: '缺省值相反：ElecKoi 缺 enabled ⇒ 启用，ST 缺 enabled ⇒ 停用（wi.js:5640 的 !undefined）。另有静默改写：**EJS 引用条目**被强制启用，显式 enabled: false 被覆盖（characterCardFormats.ts:184）；EJS 控制器本身仍尊重卡里的值（:178，由一次性探针确认，**未纳入夹具**）。缺省值那一条由夹具「缺省 enabled 条目」+ 定性用例钉住；EJS 引用强制启用这一条目前只有探针证据'
  }),
  stUnread(`${BOOK}.disable`, 'settingLibrary.entries[].enabled', 'ElecKoi 只在缺少 enabled 时读它（characterCardFormats.ts:371）；ST 的卡导入只读 enabled（wi.js:5640），不读 disable'),
  stUnread(`${BOOK}.use_regex`, 'settingLibrary.entries[].keywordUseRegex', 'wi.js 全文 0 命中 use_regex；ST 只按键名 /…/flags 自动识别。卡里显式 use_regex: true 时 ElecKoi 会把纯文本键当正则，ST 不会'),
  stUnread(`${BOOK}.case_sensitive`, 'settingLibrary.entries[].keywordIgnoreCase', 'ST 只读 extensions.case_sensitive（且为三态）'),
  stUnread(`${BOOK}.match_whole_words`, 'settingLibrary.entries[].keywordWholeWord', 'ST 只读 extensions.match_whole_words（且为三态）'),

  dropped(`${BOOK}.selective`, 'P0-3', {
    stReference: 'wi.js:5634, 4924-4928',
    stSnippet: 'selective: entry.selective || false',
    note: 'ST 的卡导入缺省是 false（5634 覆盖了模板 wi.js:4089 的 true）⇒ **所有未写 selective 的条目**都分歧，不是只有显式 false 的。按"只有显式 false 才分歧"去修会引入回归'
  }),
  dropped(`${BOOK}.insertion_order`, 'P0-4', {
    stReference: 'wi.js:5635',
    stSnippet: 'order: entry.insertion_order'
  }),
  dropped(`${BOOK}.position`, 'P0-4', {
    stReference: 'wi.js:5636',
    stSnippet: "extensions.position ?? (position === 'before_char' ? 0 : 1)"
  }),
  unused(`${BOOK}.priority`, '在 wi.js 内未找到被读取的证据（只有排序 UI 用到 priority 这个词）'),
  unused(`${BOOK}.character_filter`, 'ST 的卡导入不读（wi.js:5620-5674）；它只在编辑器里被写回运行时 characterFilter（wi.js:1414/3157/3657）'),
  unused(`${BOOK}.character_filter.isExclude`, '同上：双方在导入路径都不读'),
  unused(`${BOOK}.character_filter.names`, '同上：双方在导入路径都不读'),
  unused(`${BOOK}.character_filter.tags`, '同上：双方在导入路径都不读'),

  // ── 世界书条目：extensions.* 扩展面（ST 会读、我们不读）──────────────────
  deviates(`${BOOK}.extensions.selectiveLogic`, 'settingLibrary.entries[content=PROBE notall 正文].keywordCondition', '"any"', 'ST 四值：0=任一命中 1=任一未命中 2=全不命中 3=全命中', {
    stReference: 'wi.js:33-38, 4955-4972',
    stSnippet: 'NOT_ALL: 1',
    note: '取值 1(NOT_ALL) 被落成 any；keywordCondition 枚举本身没有 not_all 这个值'
  }),
  deviates(`${BOOK}.extensions.case_sensitive`, 'settingLibrary.entries[content=PROBE 扩展面正文].keywordIgnoreCase', 'true', 'ST 为三态（null = 跟随全局）', {
    stReference: 'wi.js:4113, 5652',
    stSnippet: 'extensions.case_sensitive ?? null'
  }),
  deviates(`${BOOK}.extensions.match_whole_words`, 'settingLibrary.entries[content=PROBE 扩展面正文].keywordWholeWord', 'true', 'ST 为三态（null = 跟随全局）', {
    stReference: 'wi.js:4114, 5653',
    stSnippet: 'extensions.match_whole_words ?? null'
  }),
  dropped(`${BOOK}.extensions.probability`, 'P0-5', { stReference: 'wi.js:5643', stSnippet: 'extensions.probability ?? 100' }),
  dropped(`${BOOK}.extensions.useProbability`, 'P0-5'),
  dropped(`${BOOK}.extensions.depth`, 'P0-4', { stReference: 'wi.js:5645', stSnippet: 'extensions.depth' }),
  dropped(`${BOOK}.extensions.position`, 'P0-4'),
  dropped(`${BOOK}.extensions.role`, 'P0-4'),
  dropped(`${BOOK}.extensions.group`, 'P0-5', { stReference: 'wi.js:5648', stSnippet: 'extensions.group' }),
  dropped(`${BOOK}.extensions.group_override`, 'P0-5'),
  dropped(`${BOOK}.extensions.group_weight`, 'P0-5'),
  dropped(`${BOOK}.extensions.sticky`, 'P0-5', { stReference: 'wi.js:5658', stSnippet: 'extensions.sticky ?? null' }),
  dropped(`${BOOK}.extensions.cooldown`, 'P0-5'),
  dropped(`${BOOK}.extensions.delay`, 'P0-5'),
  dropped(`${BOOK}.extensions.scan_depth`, 'issue-3', { stReference: 'wi.js:5651', stSnippet: 'extensions.scan_depth ?? null' }),
  dropped(`${BOOK}.extensions.use_group_scoring`, 'P0-5'),
  dropped(`${BOOK}.extensions.display_index`, 'P0-4', { stReference: 'wi.js:5642', stSnippet: 'extensions.display_index ?? index' }),
  dropped(`${BOOK}.extensions.automation_id`, 'P0-5'),
  dropped(`${BOOK}.extensions.vectorized`, 'P0-5'),
  dropped(`${BOOK}.extensions.outlet_name`, 'P0-4'),
  dropped(`${BOOK}.extensions.triggers`, 'P0-5', { stReference: 'wi.js:5668', stSnippet: 'extensions.triggers || []' }),
  dropped(`${BOOK}.extensions.ignore_budget`, 'P0-5'),
  dropped(`${BOOK}.extensions.exclude_recursion`, 'P0-5', { stReference: 'wi.js:5637', stSnippet: 'extensions.exclude_recursion' }),
  dropped(`${BOOK}.extensions.prevent_recursion`, 'P0-5'),
  dropped(`${BOOK}.extensions.delay_until_recursion`, 'P0-5'),
  dropped(`${BOOK}.extensions.match_persona_description`, 'P0-5'),
  dropped(`${BOOK}.extensions.match_character_description`, 'P0-5'),
  dropped(`${BOOK}.extensions.match_character_personality`, 'P0-5'),
  dropped(`${BOOK}.extensions.match_character_depth_prompt`, 'P0-5'),
  dropped(`${BOOK}.extensions.match_scenario`, 'P0-5'),
  dropped(`${BOOK}.extensions.match_creator_notes`, 'P0-5'),

  // ── 卡内正则脚本（data.extensions.regex_scripts[]）────────────────────────
  mapped('data.extensions.regex_scripts[].scriptName', 'regexRules[].name'),
  mapped('data.extensions.regex_scripts[].findRegex', 'regexRules[].pattern'),
  mapped('data.extensions.regex_scripts[].replaceString', 'regexRules[].replacement'),
  mapped('data.extensions.regex_scripts[].placement', 'regexRules[].targets', { note: '1→用户输入 2|缺省→AI 输出 3→斜杠命令 5→设定内容 6→推理' }),
  mapped('data.extensions.regex_scripts[].disabled', 'regexRules[].enabled', { note: '取反' }),
  mapped('data.extensions.regex_scripts[].markdownOnly', 'regexRules[].displayOnly'),
  mapped('data.extensions.regex_scripts[].promptOnly', 'regexRules[].promptOnly'),
  mapped('data.extensions.regex_scripts[].runOnEdit', 'regexRules[].runOnEdit'),
  dropped('data.extensions.regex_scripts[].minDepth', 'P1-3', { note: '深度正则被忽略，规则作用于全部消息' }),
  dropped('data.extensions.regex_scripts[].maxDepth', 'P1-3'),
  dropped('data.extensions.regex_scripts[].id', 'P1-3', { note: 'ElecKoi 导入时新生成规则 id（RegexRuleProcessor 侧），不复用卡里的 id' }),
  dropped('data.extensions.regex_scripts[].trimStrings', 'P1-3', { note: 'ST 侧读取证据在 ST 的 regex 扩展，不在 wi.js；ElecKoi 未读' }),
  dropped('data.extensions.regex_scripts[].substituteRegex', 'P1-3', { note: '同上' }),

  // ── MVU 变量面 ───────────────────────────────────────────────────────────
  mapped('data.extensions.tavern_helper.variables', 'variableConfig.initialStateJson', {
    valueMap: true,
    note: '显式变量状态；键名是角色自定义数据，不是结构'
  }),
  mapped('data.extensions.tavern_helper.scripts', 'variableConfig.variables', {
    note: '只取 Zod schema 结构；脚本运行时不执行（_.set / 文本式更新无通路，P0-6）'
  }),
  dropped('data.extensions.tavern_helper.scripts[].name', 'P0-6', { note: '脚本名只用于 MVU 自己的面板，导入侧不读' }),
  mapped('data.extensions.tavern_helper.scripts[].content', 'variableConfig.schemaCode', {
    note: '从中推导变量结构；无法解析成 Zod schema 的脚本不产生结构'
  }),
  mapped('data.extensions.tavern_helper.scripts[].enabled', 'variableConfig.variables', {
    note: '仅 enabled 为真（缺省为真）的脚本参与结构推导'
  }),

  // ── V1 扁平卡（无 data）──────────────────────────────────────────────────
  unsupported('$root.name', 'P0-1', '纯 V1 扁平卡整体被拒收（缺少 data）'),
  unsupported('$root.description', 'P0-1', '同上'),
  unsupported('$root.personality', 'P0-1', '同上'),
  unsupported('$root.scenario', 'P0-1', '同上'),
  unsupported('$root.first_mes', 'P0-1', '同上'),
  unsupported('$root.mes_example', 'P0-1', '同上')
]

/** 清单里的 mapped 条数 ÷ 总条数：静态参考数，只报不断言 */
export function staticCoverage(): { mapped: number; total: number } {
  return {
    mapped: tavernCardFields.filter((field) => field.status === 'mapped').length,
    total: tavernCardFields.length
  }
}
