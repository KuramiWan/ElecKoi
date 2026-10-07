/**
 * 【对外兼容文档的事实模型】`docs/tavern-compatibility.md` / `.en.md` 里出现的**每一个数字与每一处
 * 源码引用**都从这里来；两份文档由 `pnpm generate:tavern-docs` 渲染（模板在
 * `tests/fixtures/tavern-docs/tavern-compatibility.{zh,en}.md`）。
 *
 * 为什么要有这个文件（长期维护立场）：这份文档原先是一份手写 Markdown，同一个事实要在
 * "清单 / 中文文档 / 英文文档 / 工作区计划 / 留档"里各写一遍——已经实测漂移过：
 *   - `characters.js:510-548`（zh）vs `src/endpoints/characters.js:504-551`（en）：同一件事两个行区间；
 *     对照上游真值（`readFromV2` 起于 `:504`、`char[charField] = v2Value` 在 `:551`）**中文那份是错的**；
 *   - `characters.js:630-641`（zh 摘要）vs `characters.js:628-644`（正文三处 + en 四处）：同一件事两个区间
 *     （上游真值：`if (data.world) {` 起于 `:628`、块止于 `:644`）；
 *   - "33 条空白证据"（实际 34）、"每一行都记了 wi.js 行号"（实际 28/133）。
 * 这些不是"散文写得好不好"，是**同一个事实有多份副本**。所以事实在这里算一次、由渲染器写进两份文档，
 * 闸（`tests/tavern-docs-generated.test.ts`）用**渲染结果 == 已提交文档**做等式核对：手改产物一个字都会红。
 *
 * ⚠️ 本文件是**纯函数 + import-free**，这是被两个加载器逼出来的约束：
 *   - 生成器 `scripts/generate-tavern-compat-docs.mjs` 走 Node（ESM 要求显式扩展名，原生类型剥离只处理
 *     单文件），所以它 `import('…/docTokens.ts')` 并把清单**当参数喂进来**；
 *   - 闸走 vitest / tsc，`tests/` 下的 TS 文件在 `tsconfig.node.json` 的 include 里，**不允许**在 import 里写
 *     `.ts` 扩展名（`allowImportingTsExtensions` 只开在 web 那份）。
 *   同时满足两个加载器的唯一形状：本文件不 import 任何东西——清单数据由调用方传入，
 *   类型用下面这两个结构类型声明（与清单里的 `TavernFieldExpectation` / `WorldFieldExpectation` 结构相容）。
 */
export interface CardFieldLike {
  path: string
  status: 'mapped' | 'dropped'
  alignment?: 'aligned' | 'deviates' | 'st-unread'
  droppedReason?: 'known-gap' | 'by-design' | 'unsupported-carrier'
  stIgnores?: boolean
  tracking?: string
  stReference?: string
}

export interface WorldFieldLike {
  path: string
  status: 'mapped' | 'dropped'
  alignment?: 'aligned' | 'deviates' | 'st-unread'
}

/**
 * 仓库里算不出来的字面量（外部输入或历史记录）。每一个都在闸里被断言：
 * 能重算的重算（清单、世界书清单、夹具、台账），不能重算的在这里声明一次并说明来源。
 */
export const DECLARED = {
  /** 夹具份数（= `fixtureNames().length`，闸会核） */
  fixtures: 11,
  /** 真实卡语料第一轮：15 份 / 13 份可导入 / 13 份都带 P0-2 五项（外部输入，仓库里没有那批卡，无法重算） */
  corpusFiles: 15,
  corpusImportable: 13,
  corpusP02Hits: 13,
  /** 同上：13 张里有 12~13 张写了 `extensions.world`（首轮报告给的是区间） */
  corpusWorldRefLow: 12,
  corpusWorldRefHigh: 13,
  /** 接触加权（夹具口径，按出现次数加权）：闸会用 `coverageFor()` 重算 94 / 184 并比对 */
  contactWeightedMapped: 94,
  contactWeightedTotal: 184,
  /** 「两条路实测有 N 处不一致」：世界书面那张表的行数（每行由 `tavern-world-file.test.js` 钉住） */
  worldDivergences: 5,
  /** 那 5 处里：卡路径同样存在的成因数（#4）；"ST 拼写与导入器拼写对不上"的数（#1/#2/#3）；#4 里没被读的键数 */
  divergenceSameCause: 1,
  divergenceSpelling: 3,
  divergenceHardcodedKeys: 5,
  /** 首轮独立复核订正掉的取值与证据问题条数（历史记录） */
  auditCorrections: 13,
  /** 世界书分母的订正史（文档里的留痕，不是当前口径） */
  worldFixRounds: 2,
  worldV1Mapped: 18,
  worldV1Total: 46,
  worldV1Percent: '39.1',
  worldV1Misjudged: 7,
}

/**
 * 台账数字（`tests/helpers/tavernRedLedger.ts`）。声明在这里是因为 Node 加载不了那个模块
 * （它 import 了 `tavernWorldFileTargetEvidence`，跨模块 import 在 ESM 下没有扩展名解析），
 * 而文档要能离线渲染。闸会把每一个数与台账逐项比对——所以这**不是**第二份真相，是一次被核对的转抄。
 */
export const LEDGER_FACTS = {
  cardTargets: 42,
  companionTargets: 3,
  worldTargets: 4,
  redTotal: 49,
  greenTotal: 57,
  caseTotal: 106,
  cardGreen: 50,
  companionGreen: 3,
  worldGreen: 4,
  gapTotal: 59,
  gapAsserted: 27,
  gapBlank: 29,
  gapByDesign: 3,
  blankTotal: 34,
  nonGapTotal: 5,
  /** `42 - 1`：字段/语义/载体层的红数（另 1 条是投影面归零闸） */
  redFieldLevel: 41,
  /** 注入模型 1 条、注入顺序行为层 1 条、空白账归零闸 2 条 */
  redInjectionModel: 1,
  redInjectionOrder: 1,
  redZeroGates: 2,
  /** 39 = 34 条空白证据 + 5 条非缺口证据（都不受开关门控） */
  ungatedEvidence: 39,
}

/**
 * 源码引用登记表。**两份文档共用同一批 token**，所以中英不可能各写一个区间——这正是
 * `characters.js:510-548` vs `:504-551` 那类毛病的根治办法。
 *
 * `ref` = 渲染进文档的字符串；`upstream` = 本地 ST 上游副本的文件名（工作区 `../.st-upstream/`，
 * 仓库里没有 ⇒ 没有副本时闸跳过核对，与 `wi.js` 同一个约定）；`snippet` = 该区间里必须出现的原文，
 * 行号漂移时靠它回定位；`wi: true` = 出处是 `wi.js`（用 `ELECKOI_WI_JS` 那套解析）。
 */
export const CITATIONS: Record<string, { ref: string; upstream?: string; wi?: boolean; snippet?: string | string[] }> = {
  'characters.mirror': { ref: 'src/endpoints/characters.js:504-551', upstream: 'characters.js', snippet: 'char[charField] = v2Value' },
  'characters.mirrorAssign': { ref: ':551', upstream: 'characters.js', snippet: 'char[charField] = v2Value' },
  'characters.worldBook': { ref: 'characters.js:628-644', upstream: 'characters.js', snippet: 'convertWorldInfoToCharacterBook(data.world, file.entries)' },
  // 一条引用挂**三行**（personality / scenario / mes_example 三个顶层读取点），所以摘录也要三条：
  // 写第二条时才查出第一版的 `snippet` 只登记了 `character.personality`，而闸当时因为只取引用里**最后一个**
  // 数字（3451）而整条跳过——2026-10-07 的闸改成"并集 + 逐条摘录"后当场红。
  'script.topLevelRead': {
    ref: 'public/script.js:3440/3445/3451',
    upstream: 'script.js',
    snippet: ['character.personality', 'character.scenario', 'character.mes_example']
  },
  'script.exampleSplit': { ref: 'script.js:3501-3515', upstream: 'script.js', snippet: '<START>' },
  'openai.personalityFormat': { ref: 'openai.js:1369', upstream: 'openai.js', snippet: 'personality_format' },
  'openai.scenarioFormat': { ref: 'openai.js:1368', upstream: 'openai.js', snippet: 'scenario_format' },
  'openai.charPersonalityPosition': { ref: 'openai.js:1379', upstream: 'openai.js', snippet: 'charPersonality' },
  'openai.scenarioPosition': { ref: 'openai.js:1380', upstream: 'openai.js', snippet: 'scenario' },
  'openai.dialogueExamples': { ref: 'openai.js:1101-1134', upstream: 'openai.js', snippet: 'dialogueExamples' },
  'openai.systemPrompt': { ref: 'openai.js:1495-1503', upstream: 'openai.js', snippet: 'systemPrompt.content = systemPromptOverride' },
  'openai.jailbreak': { ref: 'openai.js:1505-1513', upstream: 'openai.js', snippet: 'jailbreakPrompt.content = jailbreakPromptOverride' },
  'powerUser.preferFlags': { ref: 'power-user.js:203-204', upstream: 'power-user.js', snippet: 'prefer_character_prompt' },
  /** `default/content/settings.json` 不在本地副本里（只取了 7 个 .js），所以只登记、不核对 */
  'settings.preferFlags': { ref: 'default/content/settings.json:146-147' },
  'wi.constantKey': { ref: 'world-info.js:5629', wi: true, snippet: 'key: entry.keys' },
  'wi.selectiveLogic': { ref: 'wi.js:4082-4125', wi: true, snippet: 'selectiveLogic' },
  /** 电子爱自己那条渲染层入口（第二个导入器） */
  'eleckoi.settingLibraryTransfer': { ref: 'settingLibraryTransfer.js:307-345' },
  'eleckoi.cardFormats': { ref: 'packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats.ts:172-201' },
}

/** 文档里引用的**不带行号**的路径（也要 token 化：路径会随上游重构移动） */
export const PATHS = {
  'eleckoi.settingLibraryTransfer': 'src/renderer/src/modules/settingLibraries/model/settingLibraryTransfer.js',
  'wi.sourceFile': 'public/scripts/world-info.js',
}

/**
 * 中文数词（"两条路"/"五项"）转成数值用。**只有 1 与 2 是习语/序数**（"一条纪律"、"第一版"、
 * "两张卡"），其余数词必须能在 token 表里找到对应值——见 `tavern-docs-generated.test.ts` 的说明与
 * 它明确写出的局限（这条规则弱于阿拉伯数字那条）。
 */
export const IDIOM_NUMBERS = new Set([1, 2])

/**
 * 模板里允许出现的"纯数字行内代码"。实测只有一处：世界书面差异 #4 的落点是硬编码值
 * （`` `insert_point_1` / `1` / `user` / 数组序号 ``），那个 `1` 说的是**实现里的常量**，不是文档口径数字。
 */
export const INLINE_CODE_LITERALS = new Set(['1'])

/** 与 `.docgen/gen-tables.mjs` / 文档闸一致的短名规则 */
const BOOK = 'data.character_book.entries[].'
const ENTRY_EXT = `${BOOK}extensions.`

export function shortPath(path: string): string {
  if (path.startsWith(BOOK)) return path.slice('data.character_book.'.length)
  if (path.startsWith('data.extensions.')) return path.slice('data.'.length)
  if (path.startsWith('data.')) return path.slice('data.'.length)
  return !path.includes('.') && path !== 'spec' && path !== 'spec_version' ? `$top.${path}` : path
}

export type Kind = 'aligned' | 'deviates' | 'st-unread' | 'unused' | 'known-gap' | 'unsupported-carrier'

export function kindOf(field: CardFieldLike): Kind {
  if (field.status === 'mapped') {
    return field.alignment === 'deviates' ? 'deviates' : field.alignment === 'st-unread' ? 'st-unread' : 'aligned'
  }
  if (field.stIgnores) return 'unused'
  return field.droppedReason === 'unsupported-carrier' ? 'unsupported-carrier' : 'known-gap'
}

const percent = (part: number, whole: number) => ((part / whole) * 100).toFixed(1)

/** 从两份清单算出文档要用的全部事实 */
export function buildFacts(cardFields: readonly CardFieldLike[], worldFields: readonly WorldFieldLike[]) {
  const fields = [...cardFields]
  const ofKind = (kind: Kind) => fields.filter((field) => kindOf(field) === kind)
  const groupSize = (tracking: string) => ofKind('known-gap').filter((field) => field.tracking === tracking).length
  const entryExtDropped = [...ofKind('known-gap'), ...ofKind('unused')].filter((field) => field.path.startsWith(ENTRY_EXT))
  const entryExtGroupSize = (tracking: string) => entryExtDropped.filter((field) => field.tracking === tracking).length

  const total = fields.length
  const mapped = fields.filter((field) => field.status === 'mapped').length
  const deviates = ofKind('deviates').length
  const stUnread = ofKind('st-unread').length
  const neitherSideReads = ofKind('unused').length
  const cited = fields.filter((field) => field.stReference)
  const citedWorldBook = cited.filter((field) => field.stReference?.startsWith('wi.js:'))
  const worldMapped = worldFields.filter((field) => field.status === 'mapped').length

  return {
    card: {
      total,
      mapped,
      mappedPercent: percent(mapped, total),
      stReadable: total - neitherSideReads,
      stReadablePercent: percent(mapped, total - neitherSideReads),
      neitherSideReads,
      deviates,
      stUnread,
      semanticsRows: deviates + stUnread,
      p02Fields: fields.filter((field) => field.tracking === 'P0-2').length,
      citedRows: cited.length,
      citedWorldBook: citedWorldBook.length,
      citedCardLevel: cited.length - citedWorldBook.length,
      uncited: total - cited.length,
      mirrorFields: ofKind('unused').filter((field) => shortPath(field.path).startsWith('$top.')).length,
      scriptEnvelope: ofKind('unused').filter((field) => field.path.startsWith('data.extensions.tavern_helper.scripts[].')).length,
    },
    contact: {
      mapped: DECLARED.contactWeightedMapped,
      total: DECLARED.contactWeightedTotal,
      percent: percent(DECLARED.contactWeightedMapped, DECLARED.contactWeightedTotal),
    },
    world: {
      mapped: worldMapped,
      total: worldFields.length,
      percent: percent(worldMapped, worldFields.length),
      stUnread: worldFields.filter((field) => field.alignment === 'st-unread').length,
    },
    ledger: {
      gapTotal: LEDGER_FACTS.gapTotal,
      asserted: LEDGER_FACTS.gapAsserted,
      gapBlank: LEDGER_FACTS.gapBlank,
      byDesign: LEDGER_FACTS.gapByDesign,
      blankTotal: LEDGER_FACTS.blankTotal,
      nonGapTotal: LEDGER_FACTS.nonGapTotal,
      ungated: LEDGER_FACTS.ungatedEvidence,
      redTotal: LEDGER_FACTS.redTotal,
      greenTotal: LEDGER_FACTS.greenTotal,
      caseTotal: LEDGER_FACTS.caseTotal,
      cardRed: LEDGER_FACTS.cardTargets,
      cardGreen: LEDGER_FACTS.cardGreen,
      companionRed: LEDGER_FACTS.companionTargets,
      companionGreen: LEDGER_FACTS.companionGreen,
      worldRed: LEDGER_FACTS.worldTargets,
      worldGreen: LEDGER_FACTS.worldGreen,
      redFieldLevel: LEDGER_FACTS.redFieldLevel,
      redInjectionModel: LEDGER_FACTS.redInjectionModel,
      redInjectionOrder: LEDGER_FACTS.redInjectionOrder,
      redZeroGates: LEDGER_FACTS.redZeroGates,
    },
    fixtures: { count: DECLARED.fixtures },
    /** 已知缺口表按 tracking 分组的项数（表里的"项数"列由这里渲染） */
    gap: {
      p0_1: groupSize('P0-1'),
      p0_2: groupSize('P0-2'),
      p0_3: groupSize('P0-3'),
      p0_4: groupSize('P0-4'),
      p0_5: groupSize('P0-5'),
      p0_6: groupSize('P0-6'),
      p1_1: groupSize('P1-1'),
      p1_3: groupSize('P1-3'),
      p1_8: groupSize('P1-8'),
      p2_6: groupSize('P2-6'),
      issue_3: groupSize('issue-3'),
      unused: neitherSideReads,
      unsupported: ofKind('unsupported-carrier').length,
    },
    /** 「条目 extensions.*：未被读取的键（按分级）」那张表的分组（只含条目级 extensions） */
    ext: {
      p0_4: entryExtGroupSize('P0-4'),
      p0_5: entryExtGroupSize('P0-5'),
      issue_3: entryExtGroupSize('issue-3'),
    },
    corpus: {
      files: DECLARED.corpusFiles,
      importable: DECLARED.corpusImportable,
      p02Hits: DECLARED.corpusP02Hits,
      worldRefLow: DECLARED.corpusWorldRefLow,
      worldRefHigh: DECLARED.corpusWorldRefHigh,
    },
    divergences: {
      count: DECLARED.worldDivergences,
      sameCause: DECLARED.divergenceSameCause,
      spelling: DECLARED.divergenceSpelling,
      hardcodedKeys: DECLARED.divergenceHardcodedKeys,
    },
    hist: {
      v1Mapped: DECLARED.worldV1Mapped,
      v1Total: DECLARED.worldV1Total,
      v1Percent: DECLARED.worldV1Percent,
      v1Misjudged: DECLARED.worldV1Misjudged,
      worldFixRounds: DECLARED.worldFixRounds,
      auditCorrections: DECLARED.auditCorrections,
    },
  }
}

export type DocFacts = ReturnType<typeof buildFacts>

/** 渲染用的扁平 token 表：模板里写 `<<card.total>>` */
export function buildTokens(cardFields: readonly CardFieldLike[], worldFields: readonly WorldFieldLike[]): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (prefix: string, node: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(node)) {
      const id = prefix ? `${prefix}.${key}` : key
      if (value !== null && typeof value === 'object') walk(id, value as Record<string, unknown>)
      else map.set(id, String(value))
    }
  }
  walk('', buildFacts(cardFields, worldFields) as unknown as Record<string, unknown>)
  for (const [id, citation] of Object.entries(CITATIONS)) map.set(`cite.${id}`, citation.ref)
  for (const [id, path] of Object.entries(PATHS)) map.set(`path.${id}`, path)
  return map
}
