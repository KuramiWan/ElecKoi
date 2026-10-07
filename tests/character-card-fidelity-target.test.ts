import { describe, expect, it } from 'vitest'
import { decodeCharacterCard } from '../packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats'
import type { DecodedCharacterCard } from '../packages/dsh-product-data/src/domain/characterTransfer/characterTransferTypes'
import { tavernCardFields } from './helpers/tavernCardFieldManifest'
import {
  decodeFixture,
  fixtureNames,
  loadFixture,
  sentinelsAt
} from './helpers/tavernCardFixtures'
import { blankWitnesses, nonGapWitnesses } from './helpers/tavernCardBlankWitnesses'
import { SEMANTIC_EVIDENCE, SEMANTIC_TEST_COUNT, refLines, wiJsFullLines, wiJsLines } from './helpers/tavernStEvidence'
import { stLineCount } from './helpers/stUpstream'
import {
  BLANK_TOTAL,
  CARD_TARGETS,
  COMPANION_TARGETS,
  GAP_ASSERTED,
  GAP_BLANK,
  GAP_BY_DESIGN,
  GAP_TOTAL,
  GREEN_TOTAL,
  NON_GAP_TOTAL,
  RED_TOTAL
} from './helpers/tavernRedLedger'
import { tavernTargetEnabled } from './helpers/tavernTargetGate'
import { WORLD_TARGET_COUNT } from './helpers/tavernWorldFileTargetEvidence'

/**
 * 【R2 目标套件】判据是**酒馆的行为**，不是电子爱现在的行为。
 *
 * 默认不跑（`pnpm test` 与上游 CI 都不会碰到它）。要跑：
 *
 *   ELECKOI_TAVERN_COMPAT_TARGET=1 npx vitest run tests/character-card-fidelity-target.test.ts
 *
 * 今天它是红的。红一条 = 还差一条。
 * **「全绿」的判据（2026-10-01 收紧）**：目标断言 0 红 **且** 归零闸转绿（每条空白都必须先被实现、
 * 再转成目标断言）**且**第 5 层的空白证据全部变红/被迁走。
 * 只等于「在清单已列出的、今天能表达的范围内与酒馆一致」，不等于「与酒馆完全兼容」：
 * 行为层里没有运行时入口的面、以及判据本身需要外部来源（真实卡语料、第二个人对照 wi.js）的部分都在此列。
 * 与 `character-card-fidelity.test.ts` 的关系：那套是**回归网**（断言清单与实现一致，今天绿），
 * 这套是**目标**（断言与酒馆一致，今天红）；同一批哨兵，两个方向——修好一条，回归网会红着提醒你
 * 改清单，目标套件会绿。
 *
 * 落点不由本套件规定：字段层只要求"酒馆会带进来的值，导入后还在"（落点由实现决定）。
 */

const enabled = tavernTargetEnabled()

/**
 * "值存活"只对**内容型**字段成立：文本/元信息被搬进设定库，值本身就该在。
 * 不适合本口径的三类（列进第 4 层的"形状待定"清单，而不是伪造一条断言）：
 *   P0-1 信封 —— spec/spec_version 是格式标记，酒馆可能只用于分支解析，不必保留值
 *   P0-4 位序 / P0-5 调度 / issue-3 扫描深度 —— 这些是**行为参数**（排序、注入位置、概率、递归），
 *        正确判据是行为等价，不是"数字还在"
 */
const SURVIVAL_EXEMPT = new Set(['P0-1', 'P0-4', 'P0-5', 'issue-3'])

/** 第 1 层会为这些（夹具 × 字段）生成"值存活"用例 */
function survivalTargets(): { fixture: string; path: string; tracking: string | undefined; sentinels: string[]; serialized: string }[] {
  const targets = []
  for (const fixture of fixtureNames()) {
    const { json } = loadFixture(fixture)
    const { decoded } = decodeFixture(fixture)
    if (!decoded) continue
    const serialized = JSON.stringify(decoded)
    for (const field of tavernCardFields) {
      if (field.status !== 'dropped' || field.stIgnores) continue
      if (field.droppedReason !== 'known-gap' || field.path.startsWith('$root')) continue
      if (SURVIVAL_EXEMPT.has(field.tracking ?? '')) continue
      const sentinels = sentinelsAt(json, field.path)
      if (!sentinels.length) continue
      targets.push({ fixture, path: field.path, tracking: field.tracking, sentinels, serialized })
    }
  }
  return targets
}

type Entry = NonNullable<DecodedCharacterCard['settingLibrary']>['entries'][number]

function decodeCard(card: unknown): DecodedCharacterCard {
  return decodeCharacterCard(new TextEncoder().encode(JSON.stringify(card)), 'sillytavern')
}

function worldEntries(decoded: DecodedCharacterCard): Entry[] {
  return decoded.settingLibrary?.entries.filter((entry) => entry.id.startsWith('tavern-world-entry-')) ?? []
}

function entryByTitle(decoded: DecodedCharacterCard, title: string): Entry | undefined {
  return worldEntries(decoded).find((entry) => entry.title === title)
}

/**
 * 枚举型字段的判据：它自己的值是规范规定的短枚举（例如 assets[].type = "icon"），做不了哨兵。
 * 判据改成**同现**——兄弟字段的哨兵出现时，附近必须同时出现这个枚举值，即"素材是成对活下来的"。
 */
function coOccurs(serialized: string, sentinel: string, value: string, windowSize = 240): boolean {
  let index = serialized.indexOf(sentinel)
  while (index >= 0) {
    const slice = serialized.slice(Math.max(0, index - windowSize), index + sentinel.length + windowSize)
    if (slice.includes(value)) return true
    index = serialized.indexOf(sentinel, index + 1)
  }
  return false
}

/** 手工写死判据的目标（不进自动生成的字段存活层）：载体 1 条 + 素材同现 1 条 */
const HAND_WRITTEN = 2
/**
 * 已经落成目标断言的"字段层之外"的那几条（第 2/3 层手工写的），第 5 层的账目要用它们闭合。
 * 其余的非断言行都必须在 `tavernCardBlankWitnesses.ts` 里有**可执行的空白证据**。
 */
const ASSERTED_ELSEWHERE = [
  'data.character_book.entries[].selective',
  'data.assets[].type',
  'data.character_book.entries[].insertion_order',
  'data.character_book.entries[].extensions.scan_depth',
  'data.character_book.entries[].extensions.role'
]

/**
 * 第 3 层的登记表：每条语义断言**必须**在 `tavernStEvidence.ts` 里申报酒馆依据。
 * 标题与申报表必须各说同一件事——题目标题里写的 `wi.js:NNNN` 缺一个都不行。
 */
const citedSemanticTitles: string[] = []
/** 标题与申报表不一致之类的问题**不当场抛**（抛在收集期会让整个文件跑不出来），记下来由闸门断言报 */
const citationProblems: string[] = []

function semanticIt(title: string, body: () => void): void {
  const evidence = SEMANTIC_EVIDENCE.find((item) => item.title === title)
  if (!evidence) {
    citationProblems.push(`第 3 层用例「${title}」没有在 tavernStEvidence.ts 里申报依据：语义断言不许无依据`)
  } else {
    const written = title.match(/wi\.js:\d+(?:-\d+)?/g) ?? []
    const declared = evidence.basis.kind === 'st' ? evidence.basis.citations.map((citation) => citation.ref) : []
    // 方向是"标题里写的每一条都必须在申报表里"：标题不许点一个申报表没有的依据。
    // 反过来不要求（申报表可以多列辅助依据，例如运行时那一行），那些也一样会被拿去和 wi.js 对照。
    const undeclared = written.filter((ref) => !declared.includes(ref))
    if (undeclared.length) citationProblems.push(`「${title}」的标题里写了申报表没有的依据 ${undeclared.join('、')}`)
  }
  citedSemanticTitles.push(title)
  it(title, body)
}

function cardWith(entries: Record<string, unknown>[], name = 'PROBE 目标卡'): unknown {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name, first_mes: '目标套件开场', character_book: { name: '目标世界书', entries } }
  }
}

describe.skipIf(!enabled)('【R2 目标套件】与酒馆完全兼容：今天应当红，红一条就是还差一条', () => {
  // ── 第 1 层：字段存活（自动从清单生成）────────────────────────────────────
  // 酒馆会读取这些字段。目标：它们的值在导入结果里必须还找得到。
  // 这些字段在回归套件里的断言是相反的（值不得出现），两边合起来正好是一条待办。
  describe('第 1 层 · 字段存活：酒馆会带进来的值，导入后必须还在', () => {
    for (const target of survivalTargets()) {
      it(`${target.fixture} · ${target.path}（缺口 ${target.tracking}）`, () => {
        const missing = target.sentinels.filter((sentinel) => !target.serialized.includes(sentinel))
        expect(
          missing,
          `${target.path} 的值没进导入结果（缺 ${missing.join('、')}）。`
          + '酒馆会读这个字段；落点由实现决定，本用例只要求值存活。'
        ).toEqual([])
      })
    }
  })

  it('第 1 层（手工判据）· 角色素材应连同类型一起导入（assets[].type 是规范枚举，用同现判定）', () => {
    const { json } = loadFixture('v3-full.json')
    const { decoded } = decodeFixture('v3-full.json')
    expect(decoded).toBeTruthy()
    const serialized = JSON.stringify(decoded)
    const uri = sentinelsAt(json, 'data.assets[].uri')[0]
    expect(uri, '夹具里 assets[].uri 应有哨兵').toBeTruthy()
    expect(
      coOccurs(serialized, uri as string, '"icon"'),
      `素材的 uri（${uri}）活了下来，但附近没有它的 type（"icon"）——酒馆会把素材连同类型保留`
    ).toBe(true)
  })

  // ── 第 2 层：载体（酒馆能导入的卡，电子爱也应能导入）──────────────────────
  it('第 2 层 · 纯 V1 扁平卡应能导入（今天被拒收：「酒馆角色卡缺少角色数据」）', () => {
    const { decoded, error } = decodeFixture('v1-flat.json')
    expect(decoded, `V1 扁平卡仍被拒收：${error ?? ''}`).toBeTruthy()
    expect(decoded?.packageData.character.name).toBe('PROBE 扁平卡')
  })

  // ── 第 3 层：语义（逐条对着酒馆源码写，每条都标了依据）────────────────────
  describe('第 3 层 · 语义等价', () => {
    semanticIt('条目没写 enabled 时应导入成**停用**（酒馆 wi.js:5640 `disable: !entry.enabled`）', () => {
      const decoded = decodeFixture('v3-worldbook-array.json').decoded as DecodedCharacterCard
      const entry = entryByTitle(decoded, '缺省 enabled 条目')
      expect(entry?.enabled, '缺 enabled 的条目在酒馆里是停用的（!undefined === true）').toBe(false)
    })

    semanticIt('条目没写 selective 时副键不应生效（酒馆 wi.js:5634 `selective: entry.selective || false`）', () => {
      const decoded = decodeFixture('v3-worldbook-triggers.json').decoded as DecodedCharacterCard
      const entry = entryByTitle(decoded, 'any 条目')
      expect(entry?.conditionKeywords, 'selective 缺省为 false，酒馆会忽略副键').toEqual([])
    })

    semanticIt('selectiveLogic = 1 应落成"任一未命中"（酒馆 wi.js:33-38 的 NOT_ALL + 4955-4961）', () => {
      const decoded = decodeFixture('v3-worldbook-triggers.json').decoded as DecodedCharacterCard
      const entry = entryByTitle(decoded, 'notall 条目')
      expect(entry?.keywordCondition, '酒馆的 NOT_ALL 目前被落成 any').toBe('not_all')
    })

    semanticIt('extensions.case_sensitive = null 应表示"跟随全局"，不是布尔（酒馆 wi.js:5652 + 4113 是三态）', () => {
      const decoded = decodeCard(cardWith([
        { name: '三态条目', content: 'PROBE-TRI', keys: ['PROBE-KEY-TRI'], extensions: { case_sensitive: null } }
      ]))
      const entry = entryByTitle(decoded, '三态条目') as Entry & { keywordIgnoreCase?: unknown }
      expect(entry?.keywordIgnoreCase, '三态里的 null 表示跟随全局，落成布尔就丢了这个意图').toBeNull()
    })

    semanticIt('条目映射：insertion_order 必须落进排序键 order（酒馆 wi.js:5635 `order: entry.insertion_order`）', () => {
      const decoded = decodeCard(cardWith([
        { name: '后插入', content: 'PROBE-ORD-A', keys: ['PROBE-KEY-ord-1'], insertion_order: 100 },
        { name: '先插入', content: 'PROBE-ORD-B', keys: ['PROBE-KEY-ord-2'], insertion_order: 10 }
      ]))
      // 本用例只钉**映射层**：insertion_order 必须体现在排序键 order 上（今天两条都是数组下标 index + 1）。
      // 它**不能**证明「注入顺序真的变了」——投影对 required 条目是按 treeViewOrder 排、再重新编号 order 的
      // （见 conversation-context.mjs），所以行为层另有一条目标用例（-context.test.js）和一条空白证据盯着。
      const byOrder = [...worldEntries(decoded)]
        .sort((left, right) => left.order - right.order)
        .map((entry) => entry.title)
      expect(byOrder, 'insertion_order 必须落进 order').toEqual(['先插入', '后插入'])
    })

    semanticIt('条目的关键词扫描深度应来自 extensions.scan_depth（酒馆 wi.js:5651 `scanDepth: entry.extensions?.scan_depth ?? null`）', () => {
      const decoded = decodeCard(cardWith([
        { name: '深扫描', content: 'PROBE-SCAN', keys: ['PROBE-KEY-scan'], extensions: { scan_depth: 5 } }
      ]))
      const entry = entryByTitle(decoded, '深扫描') as Entry & { keywordScanDepth?: unknown }
      // 运行时那一半已经实现（setting-library-tools.mjs 用 entry.keywordScanDepth 做扫描窗口），差的只是导入侧把它搬过来
      expect(entry?.keywordScanDepth, '导入后应保留卡里的扫描深度；现在是领域默认值').toBe(5)
    })

    semanticIt('条目没写 extensions.role 时，注入角色应为 system（酒馆 wi.js:5656 `role: entry.extensions?.role ?? extension_prompt_roles.SYSTEM`）', () => {
      const decoded = decodeCard(cardWith([
        { name: '缺省角色', content: 'PROBE-ROLE', keys: ['PROBE-KEY-role'] }
      ]))
      const entry = entryByTitle(decoded, '缺省角色') as Entry & { insertRole?: unknown }
      // 只断言**缺省值**这一条已取证的映射（SYSTEM 这个名字在 wi.js:5656 里可见）；
      // 显式数字（0/1/2）到名字的对应要靠 ST 的 extension_prompt_roles 常量（定义在 script.js，本工作区未取证）。
      expect(entry?.insertRole, '酒馆的缺省注入角色是 SYSTEM；电子爱现在缺省成 user').toBe('system')
    })

    semanticIt('extensions.match_whole_words = null 也应表示"跟随全局"（酒馆 wi.js:5653 + 4114 是三态）', () => {
      const decoded = decodeCard(cardWith([
        { name: '三态整词条目', content: 'PROBE-TRI2', keys: ['PROBE-KEY-TRI2'], extensions: { match_whole_words: null } }
      ]))
      const entry = entryByTitle(decoded, '三态整词条目') as Entry & { keywordWholeWord?: unknown }
      expect(entry?.keywordWholeWord, '三态里的 null 表示跟随全局，落成布尔就丢了这个意图').toBeNull()
    })

    semanticIt('条目同时有 name 与 comment 时标题应取 comment（酒馆 wi.js:5631 只认 comment）', () => {
      const decoded = decodeFixture('v3-worldbook-triggers.json').decoded as DecodedCharacterCard
      const entry = entryByTitle(decoded, 'NAME 优先标题')
      expect(entry, '酒馆生成的是 comment 标题').toBeUndefined()
      expect(entryByTitle(decoded, 'COMMENT 被忽略')).toBeTruthy()
    })

    semanticIt('常驻条目的关键词应保留（酒馆 wi.js:5629 无条件存 `key: entry.keys`）', () => {
      const decoded = decodeFixture('v3-worldbook-array.json').decoded as DecodedCharacterCard
      const entry = entryByTitle(decoded, '常驻条目')
      expect(entry?.keywords, '常驻条目现在会被清空关键词；酒馆保留').toEqual(['PROBE-KEY-arr-4'])
    })

    semanticIt('条目顶层 use_regex 不应改变匹配方式（酒馆全文 0 命中该键，只按 /…/flags 识别正则）', () => {
      const decoded = decodeCard(cardWith([
        { name: '普通键条目', content: 'PROBE-RE', keys: ['普通关键词'], use_regex: true }
      ]))
      const entry = entryByTitle(decoded, '普通键条目') as Entry & { keywordUseRegex?: unknown }
      expect(entry?.keywordUseRegex, '酒馆不读 use_regex；键名不是 /…/flags 就按字面量处理').toBe(false)
    })

    semanticIt('被 getwi 字面量指向的条目不应被强制启用', () => {
      const decoded = decodeFixture('frontend-card.json').decoded as DecodedCharacterCard
      const entry = entryByTitle(decoded, '前端材料条目')
      expect(entry?.enabled, '卡里显式停用的条目被强制打开了').toBe(false)
    })

    semanticIt('控制器里的 getwi 不是字面量时，不应改写整本书', () => {
      const decoded = decodeCard(cardWith([
        { name: '控制器', content: '<% getwi(x) %>', keys: ['PROBE-KEY-ctrl'] },
        { name: '甲', content: 'PROBE-DYN-甲', keys: ['PROBE-KEY-dyn-1'] },
        { name: '乙', content: 'PROBE-DYN-乙', keys: ['PROBE-KEY-dyn-2'], enabled: false }
      ]))
      const entries = worldEntries(decoded)
      expect(entries.find((entry) => entry.title === '甲')?.keywords, '非字面量 getwi 不该把甲变成 EJS 引用').toEqual(['PROBE-KEY-dyn-1'])
      expect(entries.find((entry) => entry.title === '乙')?.keywords, '非字面量 getwi 不该把乙变成 EJS 引用').toEqual(['PROBE-KEY-dyn-2'])
      expect(entries.find((entry) => entry.title === '乙')?.enabled, '停用状态不该被覆盖').toBe(false)
    })
  })

  // ── 第 4 层：进度与缺口（不是断言，只报告）───────────────────────────────
  it('第 4 层 · 打印目标进度与尚未覆盖的面', () => {
    const lines: string[] = []
    const semanticTargets = citedSemanticTitles.length // 派生，不写死：第 3 层的用例数由登记表数出来（注入模型那条在 .js 伴生文件里）
    const knownGap = tavernCardFields.filter((field) => !field.stIgnores && field.droppedReason === 'known-gap')
    const deviates = tavernCardFields.filter((field) => field.status === 'mapped' && field.alignment === 'deviates')
    const unsupported = tavernCardFields.filter((field) => field.droppedReason === 'unsupported-carrier')
    const survival = survivalTargets()
    const asserted = new Set([...survival.map((target) => target.path), ...ASSERTED_ELSEWHERE])
    const blankRows = blankWitnesses.filter((witness) => !witness.path.startsWith('face:') && !witness.path.startsWith('class:'))
    const nonGapRows = nonGapWitnesses.filter((witness) => !witness.path.startsWith('face:') && !witness.path.startsWith('class:'))
    const writable = blankWitnesses.filter((witness) => witness.group.startsWith('【可写未写】'))
    const accounted = knownGap.filter((field) => asserted.has(field.path) || blankRows.some((w) => w.path === field.path)
      || nonGapRows.some((w) => w.path === field.path)).length

    lines.push('目标套件（R2）：判据是酒馆的行为，不是电子爱现在的行为')
    lines.push('')
    lines.push(`字段层：已知缺口 ${knownGap.length} 条（酒馆读、电子爱不读），账目闭合 ${accounted} / ${knownGap.length}`)
    lines.push(`  · 已断言：${asserted.size} 条（值存活 ${survival.length} 条夹具 × 字段 + 手工/语义 ${ASSERTED_ELSEWHERE.length} 条）`)
    lines.push(`  · 只有空白证据、没有目标判据：${blankRows.length} 行 + 整面 ${blankWitnesses.length - blankRows.length} 条`)
    lines.push(`    （其中可写未写 ${writable.length} 条：落点已清楚，但要改产品代码 → 另一个 PR）`)
    lines.push(`  · 设计如此（允许留存，带依据）：${nonGapRows.length} 行 + 整类 ${nonGapWitnesses.length - nonGapRows.length} 条`)
    lines.push(`语义层：分歧 ${deviates.length} 条 —— 第 3 层各有对应用例`)
    lines.push(`载体层：载体不支持 ${unsupported.length} 条，全部属于纯 V1 卡（第 2 层 1 条用例覆盖"这张卡应能导入"）`)
    lines.push('')
    const inThisFile = survival.length + HAND_WRITTEN + semanticTargets
    // 本文件的目标断言 = 上面这些 + 本文件第 5 层的归零闸（1 条）。
    // 台账（`tavernRedLedger.ts`）把三个文件的数钉在一起，这里在**运行期**核本文件那一份：
    // 加减一条目标断言而不同步台账，这里当场红。
    expect(inThisFile + 1, '本文件目标断言数与 tavernRedLedger.ts 的 CARD_TARGETS 不一致').toBe(CARD_TARGETS)
    lines.push('红数 = 距离：'
      + `本文件 ${CARD_TARGETS} 条目标断言（值存活 ${survival.length} + 手工 ${HAND_WRITTEN} + 语义 ${semanticTargets} + 归零闸 1）`
      + ` + 伴生文件 ${COMPANION_TARGETS} 条（注入模型 1 + 注入顺序行为层 1 + 投影面归零闸 1）`
      + ` + 世界书面 ${WORLD_TARGET_COUNT} 条（第二条导入面；与酒馆一致 3 条 + 两条路彼此一致 1 条）`
      + ` = ${RED_TOTAL} 条。未达成的即为红。`)
    lines.push(`绿数（目标模式下三个文件合计）：${GREEN_TOTAL} 条 —— 其中空白证据 ${blankWitnesses.length + nonGapWitnesses.length} 条不受开关门控。`)
    lines.push(`空白证据（每条的用例今天必须通过；该项落地后必须变红）：${blankWitnesses.length} 条，按缺什么分组：`)
    for (const group of [...new Set(blankWitnesses.map((witness) => witness.group))]) {
      lines.push(`  · ${group}：${blankWitnesses.filter((witness) => witness.group === group).length} 条`)
    }
    for (const witness of blankWitnesses) lines.push(`  - ${witness.path}（缺 ${witness.missing}）`)
    lines.push(`非缺口（允许留存，每条带公开或 ST 侧依据）：`)
    for (const witness of nonGapWitnesses) lines.push(`  - ${witness.path} —— ${witness.basis}`)
    console.log(`\n${lines.join('\n')}\n`)
    expect(enabled).toBe(true)
  })

  // ── 第 5 层闸门：空白账归零 ──────────────────────────────────────────────
  it('第 5 层 · 归零闸：每条空白都必须先被实现、再转成目标断言（空白证据不算完成）', () => {
    const remaining = blankWitnesses.map((witness) => `${witness.path}（缺 ${witness.missing}）`)
    expect(remaining, `仍有 ${remaining.length} 条空白项只有"空白证据"、没有目标判据`).toEqual([])
  })
})

/**
 * 台账核对（**不受开关门控**）。
 *
 * 为什么单独一条：报告里那句自查挂在"打印报告"用例上——那条用例只要在它前面抛一次
 * （例如 `survivalTargets()` 出错），后面的自查就成了**死代码**。伴生文件真踩了这个坑
 * （独立验证 F1：计数断言接在一条今天必红的断言之后，从未执行 ⇒ 加一条红断言就能让
 * 真实红数与台账脱钩而全绿）。这里独立成 `it`，跑不掉。
 */
describe('【台账】本文件的目标断言条数 == tavernRedLedger.ts（不受开关门控）', () => {
  it('值存活 + 手工 + 语义 + 归零闸 == CARD_TARGETS', () => {
    const inThisFile = survivalTargets().length + HAND_WRITTEN + citedSemanticTitles.length + 1
    expect(inThisFile, '本文件目标断言数与台账 CARD_TARGETS 不一致（加减一条目标断言都要改台账与两份文档）')
      .toBe(CARD_TARGETS)
  })
})

// ── 判据绑定：语义断言的依据不许被悄悄抽走（不受开关门控；对照 wi.js 那一段只在有 wi.js 的机器上跑）
describe('【判据绑定】语义断言的酒馆依据必须是数据、且不许变少', () => {
  it('第 3 层每条语义断言都申报了依据，且条数没有变少', () => {
    expect(citedSemanticTitles.length, '第 3 层的用例数变了：删一条语义断言必须先改 tavernStEvidence.ts').toBe(SEMANTIC_TEST_COUNT)
    expect(SEMANTIC_EVIDENCE.length, '申报表条数变了').toBe(SEMANTIC_TEST_COUNT)
  })

  it('标题与申报表必须一致：不许点一个申报表没有的依据，也不许整条没依据', () => {
    expect(citationProblems, '第 3 层的标题与依据表对不上').toEqual([])
  })

  it('申报表里不许有"没有对应用例"的孤儿条目', () => {
    const orphan = SEMANTIC_EVIDENCE.filter((item) => !citedSemanticTitles.includes(item.title)).map((item) => item.title)
    expect(orphan, '这些申报条目没有对应的第 3 层用例').toEqual([])
  })

  describe.skipIf(!wiJsLines())('对照 wi.js（本机整份副本优先，没有则用仓库内摘录 ⇒ CI 上也跑）', () => {
    it('每条 st 引用都能在 wi.js 对应行上就地命中摘录', () => {
      const lines = wiJsLines() as string[]
      const problems: string[] = []
      for (const evidence of SEMANTIC_EVIDENCE) {
        if (evidence.basis.kind !== 'st') continue
        for (const citation of evidence.basis.citations) {
          const [first, last] = refLines(citation.ref)
          const slice = lines.slice(first - 1, last)
          if (!slice.some((line) => line.includes(citation.snippet))) {
            const actual = lines.findIndex((line) => line.includes(citation.snippet)) + 1
            problems.push(actual
              ? `${citation.ref} 里找不到摘录「${citation.snippet}」（它现在在 wi.js:${actual}，行号漂移了）`
              : `${citation.ref} 里找不到摘录「${citation.snippet}」（全文都没有，转写可能错了）`)
          }
        }
      }
      expect(problems, '引用与 wi.js 不符').toEqual([])
    })

    // 全文反证只有**整份副本**能做：拿稀疏摘录数"全文出现次数"会把没摘的行当成"没有"（假绿）。
    it.skipIf(!wiJsFullLines())('"全文 0 命中"与"只有别名命中"这类反证也要真的成立', () => {
      const text = (wiJsFullLines() as string[]).join('\n')
      const problems: string[] = []
      for (const evidence of SEMANTIC_EVIDENCE) {
        const basis = evidence.basis
        if (basis.kind === 'st') {
          for (const pattern of basis.fullTextAbsent ?? []) {
            const hits = text.split(pattern).length - 1
            if (hits !== 0) problems.push(`${pattern} 在 wi.js 里出现 ${hits} 次，与"0 命中"矛盾（${evidence.title}）`)
          }
        } else {
          const hits = text.split(basis.reverseProof.pattern).length - 1
          if (hits !== basis.reverseProof.occurrences) {
            problems.push(`${basis.reverseProof.pattern} 出现 ${hits} 次，反证要求 ${basis.reverseProof.occurrences} 次（${evidence.title}）`)
          }
        }
      }
      expect(problems).toEqual([])
    })

    it('每条依据都指到了 wi.js 的真实行', () => {
      // 行数来自摘录里记的 `lineCount`（本机有整份副本时以副本为准）⇒ 这一条离线也跑
      const lineCount = stLineCount('wi.js')
      expect(lineCount, '摘录里应记着 wi.js 的总行数').toBeTypeOf('number')
      const outOfRange = SEMANTIC_EVIDENCE
        .flatMap((evidence) => evidence.basis.kind === 'st' ? evidence.basis.citations : [])
        .filter((citation) => refLines(citation.ref)[1] > (lineCount as number))
        .map((citation) => citation.ref)
      expect(outOfRange, '引用了 wi.js 里不存在的行').toEqual([])
    })
  })
})

// ── 第 5 层：空白证据（**不受开关门控**）────────────────────────────────────
// 没实现、没判据的项不写 `it.todo`（那只是一行账目文字，不观察任何东西）。每条都有一条**可执行证据**：
// 今天通过（证明"该能力/落点/取值不存在"），该项一旦落地就变红（账目被迫更新）。
// 归零闸在开关内（今天红）：`blankWitnesses` 必须清空才可能"全绿"。
describe('【空白证据】没实现、没判据的项：必须有用例证明"今天确实是空白"', () => {
  for (const witness of blankWitnesses) {
    it(`${witness.group} · ${witness.path}（缺：${witness.missing}）`, () => {
      const { decoded } = decodeFixture(witness.fixture)
      expect(decoded, `${witness.fixture} 应能导入：空白证据要在真实解码结果上观察`).toBeTruthy()
      witness.observe(decoded as DecodedCharacterCard)
    })
  }

  for (const witness of nonGapWitnesses) {
    it(`[非缺口] ${witness.group} · ${witness.path}（依据：${witness.basis}）`, () => {
      const { decoded } = decodeFixture(witness.fixture)
      expect(decoded, `${witness.fixture} 应能导入`).toBeTruthy()
      witness.observe(decoded as DecodedCharacterCard)
    })
  }

  it('空白依据必须可核实：设计如此的每一条都要带公开或 ST 侧依据', () => {
    const thin = nonGapWitnesses.filter((witness) => witness.basis.trim().length < 12)
    expect(thin.map((witness) => witness.path), '缺依据的"设计如此"不许留存').toEqual([])
  })

  it('空白账不能腐烂：每条的路径都必须在清单里（`face:` / `class:` 前缀除外）', () => {
    const declared = new Set(tavernCardFields.map((field) => field.path))
    const unknown = [...blankWitnesses, ...nonGapWitnesses]
      .map((witness) => witness.path)
      .filter((path) => !path.startsWith('face:') && !path.startsWith('class:') && !declared.has(path))
    expect(unknown, '空白账里出现了清单没有的行').toEqual([])
  })

  it('账目闭合：known-gap 的每一行都恰好落在 已断言 / 空白证据 / 设计如此 之一', () => {
    const rows = tavernCardFields.filter((field) => !field.stIgnores && field.droppedReason === 'known-gap')
    const asserted = new Set([...survivalTargets().map((target) => target.path), ...ASSERTED_ELSEWHERE])
    const blank = new Set(blankWitnesses.map((witness) => witness.path))
    const nonGap = new Set(nonGapWitnesses.map((witness) => witness.path))
    const unaccounted = rows.map((field) => field.path).filter((path) => !asserted.has(path) && !blank.has(path) && !nonGap.has(path))
    expect(unaccounted, '这些 known-gap 行既没有目标断言、也没有空白证据').toEqual([])
    const counts = {
      断言: rows.filter((field) => asserted.has(field.path)).length,
      空白: rows.filter((field) => blank.has(field.path)).length,
      设计如此: rows.filter((field) => nonGap.has(field.path)).length
    }
    expect(counts.断言 + counts.空白 + counts.设计如此, '三桶必须恰好覆盖 known-gap 的每一行').toBe(rows.length)
    // 绝对条数：防"悄悄把红改小"——把任意一行改判成别的 droppedReason（或删掉一条空白证据）都会先撞上这里。
    // 这不是冗余：闭合性断言对"整行离开 known-gap"是瞎的，只有绝对条数能拦住它。
    // 这些绝对条数**不在本文件里**，而在台账 `tavernRedLedger.ts`：对外文档的红/绿/缺口数从台账渲染
    // （`tests/fixtures/tavern-docs/docTokens.ts` → `docs/tavern-compatibility*.md`），同一事实只留一份。
    // 断言本身没放宽：左边仍是运行期算出来的实测值。
    expect(rows.length, 'known-gap 条数变了：改判分类必须是一个可见的动作，并同步改台账').toBe(GAP_TOTAL)
    expect(asserted.size, '已断言条数变了').toBe(GAP_ASSERTED)
    expect(blankWitnesses.length, '空白证据条数变了：实现一条就把它转成目标断言，不要直接删').toBe(BLANK_TOTAL)
    expect(counts.空白, 'known-gap 行里的空白证据条数变了').toBe(GAP_BLANK)
    expect(counts.设计如此, 'known-gap 行里的"设计如此"条数变了').toBe(GAP_BY_DESIGN)
    expect(nonGapWitnesses.length, '非缺口证据条数变了（每条必须有公开或 ST 侧依据）').toBe(NON_GAP_TOTAL)
    console.log(`\n账目：known-gap ${rows.length} = 已断言 ${counts.断言} + 空白证据 ${counts.空白} + 设计如此 ${counts.设计如此}\n`
      + `（其中"空白证据"${counts.空白} 条只有"今天确实是空白"的证据，没有目标判据——${blankWitnesses.length - counts.空白 + counts.设计如此} 条属于整面/整类）\n`)
  })
})
