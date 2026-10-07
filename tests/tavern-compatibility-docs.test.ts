import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tavernCardFields } from './helpers/tavernCardFieldManifest'
import { worldCoverage } from './helpers/tavernWorldFieldManifest'
import { WORLD_TARGET_COUNT } from './helpers/tavernWorldFileTargetEvidence'
import { CARD_TARGETS, COMPANION_TARGETS, GREEN_TOTAL, RED_TOTAL, TARGET_CASE_TOTAL } from './helpers/tavernRedLedger'
import { tavernTargetEnabled } from './helpers/tavernTargetGate'
import { blankWitnesses, nonGapWitnesses } from './helpers/tavernCardBlankWitnesses'

/**
 * D-6 的闸：**对外文档的字段表必须与清单一致。**
 *
 * 背景（`review-objective-round2.md` 的 D-6）：文档里的表是用工作区外的
 * `.docgen/` 生成器（`dump.mjs` → `gen-tables.mjs`）从清单导出的，再手工贴进
 * `docs/tavern-compatibility.md` 与 `.en.md`。生成器不在仓库里、只出中文表、
 * 两个百分数在正文手写、EN 手抄——清单改完忘记重跑就**静默漂移**（已擦边一次）。
 *
 * 这条用例不重跑那个生成器（它在仓库外），而是**独立地**从清单直接算出
 * "文档里应该出现哪些行"，再逐行核对两份文档。因此：
 *   - 改清单而不重跑文档管线 → 这里变红；
 *   - 手改文档表格与清单不符 → 这里变红；
 *   - 手改、增删文档里的**散文**（不碰代码路径单元格）→ 不受影响。
 *
 * 措辞是作者自由（中英各自表述），所以只核对**身份**：
 *   - `path`（酒馆卡字段）与 `landing`（电子爱落点）两个单元格必须出现；
 *   - `path` 必须在全文档里出现，不能只活在表格之外。
 * 表格的行序不核对——它由生成器决定，不是语义的一部分。
 */

const here = dirname(fileURLToPath(import.meta.url))
const docsRoot = join(here, '..', 'docs')
const BOOK = 'data.character_book.entries[].'

/** 与 `.docgen/gen-tables.mjs` 的 `short()` 保持一致：文档里的字段名是短名 */
function shortPath(path: string): string {
  if (path.startsWith(BOOK)) return path.slice('data.character_book.'.length)
  if (path.startsWith('data.extensions.')) return path.slice('data.'.length)
  if (path.startsWith('data.')) return path.slice('data.'.length)
  return !path.includes('.') && path !== 'spec' && path !== 'spec_version' ? `$top.${path}` : path
}

type Kind = 'aligned' | 'deviates' | 'st-unread' | 'unused' | 'known-gap' | 'unsupported-carrier'

function kindOf(field: typeof tavernCardFields[number]): Kind {
  if (field.status === 'mapped') {
    return field.alignment === 'deviates' ? 'deviates' : field.alignment === 'st-unread' ? 'st-unread' : 'aligned'
  }
  if (field.stIgnores) return 'unused'
  return field.droppedReason === 'unsupported-carrier' ? 'unsupported-carrier' : 'known-gap'
}

/** 表格第一列里**不是字段名**的那些单元格（分级名 / 分组名 / 表头）：显式白名单 */
const NON_FIELD_FIRST_COLUMNS = new Set([
  '分级', '项数', '字段', '键', '酒馆卡字段', '电子爱落点', 'Severity', 'Count', 'Keys',
  'Tavern card field', 'ElecKoi destination', 'P0-1', 'P0-2', 'P0-3', 'P0-4', 'P0-5', 'P0-6',
  'P1-1', 'P1-3', 'P1-8', 'P2-6', 'issue-3', '双方都不读', '载体不支持',
  'Neither side reads it', 'Unsupported carrier'
])

const fields = [...tavernCardFields]
const ofKind = (kind: Kind) => fields.filter((field) => kindOf(field) === kind)

const isExt = (path: string) => path.startsWith(`${BOOK}extensions.`)
/** 「字段兼容表」各小节：与 `.docgen/gen-tables.mjs` 的 `sections` 一致 */
const compatSections: [title: string, pred: (path: string) => boolean][] = [
  ['卡级字段', (p) => p.startsWith('data.') && !p.startsWith('data.character_book.') && !p.startsWith('data.extensions.')],
  ['卡内世界书 · 书级', (p) => p.startsWith('data.character_book.') && !p.startsWith(BOOK)],
  ['卡内世界书 · 条目字段', (p) => p.startsWith(BOOK) && !isExt(p)],
  ['卡内正则脚本', (p) => p.startsWith('data.extensions.regex_scripts')],
  ['MVU 变量面', (p) => p.startsWith('data.extensions.tavern_helper')],
]

/** 文档里"出现过这个值"的判定：代码路径以反引号形式出现即可 */
function mentionsCell(doc: string, value: string): boolean {
  return doc.includes(`\`${value}\``)
}

/** 一行"路径 + 落点"是否在文档里成对出现（允许同一行后面接散文） */
function mentionsRow(doc: string, path: string, landing: string | undefined): boolean {
  const short = shortPath(path)
  const cell = `| \`${short}\` |`
  return doc.split('\n').some((line) => line.startsWith(cell) && (!landing || line.includes(`\`${landing}\``)))
}


/**
 * 取某个二级小节到下一个二级小节之间的正文。
 *
 * 为什么要按小节取：整篇文档里同一个字段名会出现多次（缺口表、精读表、散文、行内代码），
 * 用"全文出现过"做判据时，把某一行从**该表**里删掉、名字却还留在别处，就查不出来。
 * 小节标题中英不同，所以按**表头**或**小节序号**定位：这里用"表头行"作为锚。
 */
function sectionOf(doc: string, anchor: string): string {
  const start = doc.indexOf(anchor)
  if (start < 0) return ''
  const rest = doc.slice(start + anchor.length)
  const next = rest.search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next)
}

/** 已知缺口小节（中英标题不同，用各自表头锚定） */
function gapSection(doc: string): string {
  for (const anchor of ['| 分级 | 项数 | 字段 |', '| Severity | Count | Fields |']) {
    const found = sectionOf(doc, anchor)
    if (found) return found
  }
  return ''
}
/** 语义不同小节：中英都用同一张两列表，锚定它的小节标题 */
function notedSection(doc: string): string {
  const anchors = ['## 行为上可能不同的字段', '## Fields That May Behave Differently']
  for (const anchor of anchors) {
    const found = sectionOf(doc, anchor)
    if (found) return found
  }
  return ''
}

/**
 * 红绿/口径那一段的小节（中英标题不同）。
 * ⚠️ 三轮收紧（独立评审 E7）：这些数原来是在**全文**里搜的，把数字从原句挪到文末注释里也照样绿——
 * 现在只在这两段小节里搜。
 */
function ledgerSection(doc: string): string {
  for (const anchor of ['## 缺口修到什么程度了', '## How Far']) {
    const found = sectionOf(doc, anchor)
    if (found) return found
  }
  return ''
}

function readDoc(name: string): string {
  return readFileSync(join(docsRoot, name), 'utf8')
}

const zh = readDoc('tavern-compatibility.md')
const en = readDoc('tavern-compatibility.en.md')

describe('对外兼容文档与清单一致（D-6 的闸）', () => {
  it('字段兼容表：每个 mapped 行都在中英两份文档里出现（路径 + 落点）', () => {
    const problems: string[] = []
    for (const [title, pred] of compatSections) {
      const rows = ofKind('aligned').filter((field) => pred(field.path))
      if (!rows.length) continue
      for (const field of rows) {
        for (const [label, doc] of [['zh', zh], ['en', en]] as const) {
          if (!mentionsRow(doc, field.path, field.landing)) {
            problems.push(`${label}: 「${title}」缺行 | \`${shortPath(field.path)}\` | \`${field.landing}\` |（清单 ${field.path}）`)
          }
        }
      }
    }
    expect(problems, `字段兼容表与清单不一致（改清单后请重跑 .docgen 管线并贴回文档）：\n${problems.join('\n')}`).toEqual([])
  })

  it('已知缺口表：每个 known-gap / unused / 载体不支持 行都在两份文档里出现', () => {
    const problems: string[] = []
    const groups: [Kind, string][] = [['known-gap', '缺口'], ['unused', '双方都不读'], ['unsupported-carrier', '载体不支持']]
    for (const [kind, label] of groups) {
      for (const field of ofKind(kind)) {
        for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
          if (!mentionsCell(gapSection(doc), shortPath(field.path))) {
            problems.push(`${lang}: 「${label}」表缺 \`${shortPath(field.path)}\`（清单 ${field.path}）`)
          }
        }
      }
    }
    expect(problems, `已知缺口表与清单不一致：\n${problems.join('\n')}`).toEqual([])
  })

  it('语义不同表：每个 deviates / st-unread 行都在两份文档里出现', () => {
    const problems: string[] = []
    for (const kind of ['deviates', 'st-unread'] as const) {
      for (const field of ofKind(kind)) {
        for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
          const section = notedSection(doc)
          if (!mentionsCell(section, shortPath(field.path))) {
            problems.push(`${lang}: 「${kind}」表缺 \`${shortPath(field.path)}\`（清单 ${field.path}）`)
          }
          // 文档表里的落点用**基础路径**（生成器把夹具专用的谓词 `[content=…]` 去掉），
          // 所以比对时也去掉谓词，只核到字段名那一层。
          const baseLanding = field.landing?.split('[')[0]
          if (baseLanding && !section.includes(`\`${baseLanding}`)) {
            problems.push(`${lang}: 「${kind}」表里 \`${shortPath(field.path)}\` 的落点不是 \`${baseLanding}\``)
          }
        }
      }
    }
    expect(problems, `语义不同表与清单不一致：\n${problems.join('\n')}`).toEqual([])
  })

  it('分级小节的计数与清单一致（缺口分组、extensions 未读键、双方都不读、载体不支持）', () => {
    const problems: string[] = []
    const count = (pred: (f: typeof fields[number]) => boolean) => fields.filter(pred).length

    /** 中英文档里同一分组的行首标签不同（EN 是译名），显式列出以免闸被翻译改名绕过 */
    const labels: Record<string, { zh: string; en: string }> = {
      'P0-1': { zh: 'P0-1', en: 'P0-1' },
      'P0-2': { zh: 'P0-2', en: 'P0-2' },
      'P0-3': { zh: 'P0-3', en: 'P0-3' },
      'P0-4': { zh: 'P0-4', en: 'P0-4' },
      'P0-5': { zh: 'P0-5', en: 'P0-5' },
      'P0-6': { zh: 'P0-6', en: 'P0-6' },
      'P1-1': { zh: 'P1-1', en: 'P1-1' },
      'P1-3': { zh: 'P1-3', en: 'P1-3' },
      'P1-8': { zh: 'P1-8', en: 'P1-8' },
      'P2-6': { zh: 'P2-6', en: 'P2-6' },
      'issue-3': { zh: 'issue-3', en: 'issue-3' },
      unused: { zh: '双方都不读', en: 'Neither side reads it' },
      unsupported: { zh: '载体不支持', en: 'Unsupported carrier' },
    }

    const expectRow = (doc: string, label: string, n: number, where: string) => {
      const row = new RegExp(`^\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| ${n} \\|`, 'm')
      if (!row.test(doc)) problems.push(`${where}: 分级行「${label}」的项数不是 ${n}`)
    }

    // 已知缺口：按 tracking 分组
    const gapGroups = new Map<string, number>()
    for (const field of ofKind('known-gap')) {
      const key = field.tracking ?? '—'
      gapGroups.set(key, (gapGroups.get(key) ?? 0) + 1)
    }
    for (const [track, n] of gapGroups) {
      const label = labels[track]
      if (!label) { problems.push(`测试缺标签映射：${track}`); continue }
      expectRow(zh, label.zh, n, 'zh')
      expectRow(en, label.en, n, 'en')
    }
    for (const [key, kind] of [['unused', 'unused'], ['unsupported', 'unsupported-carrier']] as const) {
      const label = labels[key]
      if (!label) { problems.push(`测试缺标签映射：${key}`); continue }
      expectRow(zh, label.zh, count((f) => kindOf(f) === kind), 'zh')
      expectRow(en, label.en, count((f) => kindOf(f) === kind), 'en')
    }

    // extensions 未读键：按 tracking 分组
    const extDropped = [...ofKind('known-gap'), ...ofKind('unused')].filter((field) => isExt(field.path))
    const extGroups = new Map<string, number>()
    for (const field of extDropped) {
      const key = field.tracking ?? 'unused'
      extGroups.set(key, (extGroups.get(key) ?? 0) + 1)
    }
    for (const [track, n] of extGroups) {
      const label = labels[track]
      if (!label) { problems.push(`测试缺标签映射（extensions）：${track}`); continue }
      expectRow(zh, label.zh, n, 'zh/extensions')
      expectRow(en, label.en, n, 'en/extensions')
    }

    expect(problems, `分级计数与清单不一致：\n${problems.join('\n')}`).toEqual([])
  })

  it('mapped 总数在文档摘要里被写对（参考数分母 = 清单条数，且必须与百分数同句）', () => {
    const total = tavernCardFields.length
    const mapped = ofKind('aligned').length + ofKind('deviates').length + ofKind('st-unread').length
    const percent = Math.round((mapped / total) * 1000) / 10
    const problems: string[] = []
    for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
      // ⚠️ 三轮收紧（独立评审 E13 那一类）：原来是在**全文**里找"两个数同段"，把数字改掉之后
      // 文档别处仍可能有这两个数（或同一个数），照样绿。现在要求**同一行**里同时出现
      // 分母、分子与百分数——那一行就是"摘要"那一句，改任何一个都当场红。
      const line = doc.split('\n').find((candidate) =>
        new RegExp(`(?<![\\d.])${total}(?![\\d.])`).test(candidate)
        && new RegExp(`(?<![\\d.])${mapped}(?![\\d.])`).test(candidate)
        && candidate.includes(String(percent)))
      if (!line) problems.push(`${lang}: 摘要那一句里找不到「${mapped} / ${total} = ${percent}%」这一组数`)
    }
    expect(problems, `摘要数字与清单不一致：\n${problems.join('\n')}`).toEqual([])
  })

  it('“有 N 行带酒馆侧引用”这句话必须与清单实际相符（D-2 的订正不许回退）', () => {
    // 清单里真的带 stReference 的行数；世界书面（wi.js）单独一个数
    const withRef = tavernCardFields.filter((field) => field.stReference)
    const worldRef = withRef.filter((field) => field.stReference?.startsWith('wi.js:'))
    const cardRef = withRef.length - worldRef.length
    const problems: string[] = []
    // ⚠️ 三轮收紧（独立评审 E10/E11）：原来是 `\bN\b[^\n]{0,30}(行|rows)` 在**全文**里搜，
    // 会被无关句子满足——把"**6 行**是卡级字段"改成"六行"后，文档第 166 行"前 6 行是真正需要留意的"
    // 照样让它绿。现在两步走：① 先定位**那一句**（三个数 + 105 必须同句，唯一）；
    // ② 在那句里要求每个数**紧跟**单位（允许中间的 `**` 与空格），且数字是独立 token。
    const cited = (n: number) => new RegExp(`(?<![\\d.])${n}\\s*\\*{0,2}\\s*(行|rows)`)
    for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
      const lone = (n: number) => new RegExp(`(?<![\\d.])${n}(?![\\d.])`)
      const sentences = doc.split('\n').filter((line) =>
        [withRef.length, worldRef.length, cardRef, tavernCardFields.length - withRef.length]
          .every((n) => lone(n).test(line)))
      if (sentences.length !== 1) {
        problems.push(`${lang}: 应当恰好有一句同时写着 ${withRef.length} / ${worldRef.length} / ${cardRef} / ${tavernCardFields.length - withRef.length}，实际 ${sentences.length} 句`)
        continue
      }
      const sentence = sentences[0] as string
      if (!cited(withRef.length).test(sentence)) problems.push(`${lang}: 那一句里没说"${withRef.length} 行带酒馆侧引用"（实测 stReference=${withRef.length}）`)
      if (!cited(worldRef.length).test(sentence)) problems.push(`${lang}: 那一句里没说世界书面是 ${worldRef.length} 行（实测 ${worldRef.length}）`)
      // 卡级面也要单独核：否则一句"28 行 = 22 + 5"（漏掉 extensions.world）也能过
      if (!cited(cardRef).test(sentence)) problems.push(`${lang}: 那一句里没说卡级面是 ${cardRef} 行（实测 ${cardRef}）`)
    }
    expect(problems, `酒馆侧引用行数与清单不一致（D-2 的回退会被这里拦住）：\n${problems.join('\n')}`).toEqual([])
  })

  it('接触加权那两个数（散文写的）被钉住：套件重算结果变了就必须来改这里与两份文档', () => {
    // 成因：这两个数由 character-card-fidelity.test.ts 的覆盖率报告算出（mapped / 夹具出现过的字段数，
    // 按出现次数加权）。加了正则键夹具之后它从 50.0% 变成 51.1%，而**没有任何闸拦得住**（独立审查 F8）。
    // 这里把它钉成显式常量：套件重算结果一变，本用例就红，逼着同时改代码与两份文档。
    const CONTACT_WEIGHTED = { mapped: 94, total: 184, percent: 51.1 }
    const problems: string[] = []
    for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
      // 同一行里必须三个数齐全（分子 / 分母 / 百分数）——改掉任何一个都当场红。
      const line = doc.split('\n').find((candidate) =>
        new RegExp(`(?<![\\d.])${CONTACT_WEIGHTED.mapped}(?![\\d.])`).test(candidate)
        && new RegExp(`(?<![\\d.])${CONTACT_WEIGHTED.total}(?![\\d.])`).test(candidate)
        && candidate.includes(String(CONTACT_WEIGHTED.percent)))
      if (!line) problems.push(`${lang}: 接触加权那一句里找不到「${CONTACT_WEIGHTED.mapped} / ${CONTACT_WEIGHTED.total} = ${CONTACT_WEIGHTED.percent}%」这一组数`)
    }
    expect(problems, `接触加权数字与钉住的常量不一致（跑 tests/character-card-fidelity.test.ts 看报告里的"主数"）：\n${problems.join('\n')}`).toEqual([])
  })

  it('红/绿数与小节里的分解都被台账钉住（三个目标文件各多少、合计多少）', () => {
    // 三轮改造（独立评审 P1-1 / E5 / E7）：
    //   ① 数**不再写在本文件里**，而是从 `tests/helpers/tavernRedLedger.ts` 取——台账的另一半
    //      由三个目标套件在**运行期**自查（各文件断言自己登记的目标条数 == 台账对应项）；
    //   ② 只在「缺口修到什么程度了 / How Far」那一段里搜，数字挪到文末注释里不再算数（E7）。
    //   残留局限（写在台账里、这里也说一次）：把某条红断言的**期望值**改成恒真而**不增删用例**
    //   （E5），进程内谁也看不见——那只能靠"跑一遍目标套件看红数"。
    const problems: string[] = []
    for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
      const section = ledgerSection(doc)
      if (!section) { problems.push(`${lang}: 找不到「缺口修到什么程度了 / How Far」这一节`); continue }
      if (!new RegExp(`\\b${RED_TOTAL}\\b[^\\n]{0,10}(条)?\\s*(红|red)`).test(section)) problems.push(`${lang}: 该节里找不到"${RED_TOTAL} 条红"`)
      if (!new RegExp(`\\b${GREEN_TOTAL}\\b[^\\n]{0,10}(条)?\\s*(绿|green)`).test(section)) problems.push(`${lang}: 该节里找不到"${GREEN_TOTAL} 条绿"`)
      // 三个文件的分账（本文件 / 伴生 / 世界书面）与用例总数都必须写在这一节里
      for (const [label, n] of [['本文件', CARD_TARGETS], ['伴生', COMPANION_TARGETS], ['世界书面', WORLD_TARGET_COUNT]] as const) {
        if (!new RegExp(`\\b${n}\\b[^\\n]{0,30}(世界书|world|红|red|条)`).test(section)) {
          problems.push(`${lang}: 该节里没有「${label} ${n}」的分账`)
        }
      }
      if (!new RegExp(`\\b${TARGET_CASE_TOTAL}\\b`).test(section)) problems.push(`${lang}: 该节里没有用例总数 ${TARGET_CASE_TOTAL}`)
      // 空白证据的条数也要钉（独立验证 F2：文档写"33 条"而套件是 34 条，且这个数当时没有任何闸）。
      const blank = new RegExp(`\\b${blankWitnesses.length}\\b[^\\n]{0,20}(条)?\\s*(空白证据|blank witness)`)
      if (!blank.test(section)) problems.push(`${lang}: 该节里没有"${blankWitnesses.length} 条空白证据"（套件实测 ${blankWitnesses.length} 条）`)
      const nonGap = new RegExp(`\\b${nonGapWitnesses.length}\\b[^\\n]{0,20}(条)?\\s*(非缺口|non-gap)`)
      if (!nonGap.test(section)) problems.push(`${lang}: 该节里没有"${nonGapWitnesses.length} 条非缺口"（套件实测 ${nonGapWitnesses.length} 条）`)
    }
    expect(problems, `红/绿数与台账不一致（跑 ELECKOI_TAVERN_COMPAT_TARGET=1 数一遍）：\n${problems.join('\n')}`).toEqual([])
  })

  it('世界书导入面的分母与计数也要与清单一致（第二条分母不许悄悄漂移）', () => {
    const problems: string[] = []
    const coverage = worldCoverage()
    for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
      // 三轮收紧：锁定**引用了世界书清单的那一行**（两处文档都在这句里给分母），
      // 而不是全文找"两个数同段"——否则把 14 改成 15、别处还有 14 就查不出来（E13 那一类）。
      const line = doc.split('\n').find((candidate) =>
        candidate.includes('tavernWorldFieldManifest')
        && new RegExp(`(?<![\\d.])${coverage.mapped}(?![\\d.])`).test(candidate)
        && new RegExp(`(?<![\\d.])${coverage.total}(?![\\d.])`).test(candidate)
        && candidate.includes(String(coverage.percent)))
      if (!line) problems.push(`${lang}: 世界书面那一句里找不到「${coverage.mapped} / ${coverage.total} = ${coverage.percent}%」这一组数`)
      // 分母纪律：世界书面的分母必须与卡面的 133 并列出现，不能合并成一个数
      if (!doc.includes(String(tavernCardFields.length))) problems.push(`${lang}: 正文丢了卡面分母 ${tavernCardFields.length}`)
      // 世界书面的分母必须**显式**不等于卡面的（合并分母是这里唯一要防的事）
      if (coverage.total === tavernCardFields.length) problems.push('世界书面清单的项数与卡清单相同——分母被合并了')
    }
    expect(problems, `世界书导入面数字与清单不一致：\n${problems.join('\n')}`).toEqual([])
  })

  it('文档没有未声明的字段名（反向：表格里出现的反引号路径必须在清单里）', () => {
    // 只扫表格行的第一列，避免把落点路径与散文字符串误判成字段名
    const declared = new Set(fields.map((field) => shortPath(field.path)))
    const problems: string[] = []
    for (const [lang, doc] of [['zh', zh], ['en', en]] as const) {
      for (const line of doc.split('\n')) {
        const match = /^\| `([^`]+)` \| `[^`]*` \|/.exec(line)
        if (!match?.[1]) continue
        const cell = match[1]
        // 表格第一列有两种形态：字段名（必须声明过），或「分级 | 项数」表里的分组名。
        // 分组名的白名单**显式列出**——原来用 `!/[.[\]]/.test(cell)` 当逃逸口，
        // 会把任何没有点/方括号的编造字段名（例如 `personaltiy`）静默放过。
        if (NON_FIELD_FIRST_COLUMNS.has(cell)) continue
        if (!declared.has(cell)) problems.push(`${lang}: 表格里的 \`${cell}\` 不在清单里（清单 ${fields.length} 项）`)
      }
    }
    expect(problems, `文档表格声明了清单里没有的字段：\n${problems.join('\n')}`).toEqual([])
  })
})

/**
 * 目标套件开关的自检。**不属于文档一致性**，但和"账目能不能被信"是同一件事：
 * 第一版用 `Boolean(process.env.X?.trim())`，于是 `=0` / `=false` 都会把 49 条红断言**打开**
 * （独立评审实测 `=0` 时 4 failed）。CI 里若有人用 `0` 表示"关"，就会炸出一整套红。
 */
describe('目标套件开关：只认显式的 1/true（=0 / =false 不许把红套件打开）', () => {
  it('tavernTargetEnabled() 的真值表', () => {
    const saved = process.env.ELECKOI_TAVERN_COMPAT_TARGET
    const check = (value: string | undefined) => {
      if (value === undefined) delete process.env.ELECKOI_TAVERN_COMPAT_TARGET
      else process.env.ELECKOI_TAVERN_COMPAT_TARGET = value
      return tavernTargetEnabled()
    }
    try {
      for (const value of ['1', ' true ', 'TRUE']) {
        expect(check(value), `${JSON.stringify(value)} 应当算"开"`).toBe(true)
      }
      for (const value of [undefined, '', '  ', '0', 'false', 'FALSE', 'no', 'off']) {
        expect(check(value), `${JSON.stringify(value)} 应当算"关"`).toBe(false)
      }
    } finally {
      if (saved === undefined) delete process.env.ELECKOI_TAVERN_COMPAT_TARGET
      else process.env.ELECKOI_TAVERN_COMPAT_TARGET = saved
    }
  })
})
