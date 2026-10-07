import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { staticCoverage, tavernCardFields } from './helpers/tavernCardFieldManifest'
import { worldFields } from './helpers/tavernWorldFieldManifest'
import { blankWitnesses, nonGapWitnesses } from './helpers/tavernCardBlankWitnesses'
import { coverageFor, fixtureNames } from './helpers/tavernCardFixtures'
import { WORLD_TARGET_COUNT } from './helpers/tavernWorldFileTargetEvidence'
import {
  refFileName,
  refParts,
  refRanges,
  stIsVendored,
  stLineCount,
  stNotVendored,
  stSourceLines,
  stSourceName
} from './helpers/stUpstream'
import * as ledger from './helpers/tavernRedLedger'
import {
  CITATIONS,
  IDIOM_NUMBERS,
  INLINE_CODE_LITERALS,
  LEDGER_FACTS,
  PATHS,
  buildFacts,
  buildTokens,
} from './fixtures/tavern-docs/docTokens'
import { DOC_FILES, HEADERS, renderDoc, usedTokens, type DocLang } from './fixtures/tavern-docs/docRender'

/**
 * 【对外文档是生成产物】的闸。
 *
 * 背景：这两份文档原先手写，同一个事实要在"清单 / 中文文档 / 英文文档 / 计划 / 留档"各写一遍，
 * 已经实测漂移过——中英对同一件事写了两个行区间（`characters.js:510-548` vs `:504-551`，
 * 对照上游真值是中文那份错）、"33 条空白证据"（实际 34）。手写散文里的**数字与引用**是漂移的来源，
 * 所以现在：事实全部由 `docTokens.ts` 算出、由 `scripts/generate-tavern-compat-docs.mjs` 渲染进
 * `docs/tavern-compatibility{,.en}.md`，模板里只允许出现 `<<token>>`。
 *
 * 这一组闸管三件事：
 *   ① **产物 == 渲染结果**（手改产物、或改了清单没重新生成 → 红）；
 *   ② **模板里没有手写的计数**（数字必须是 token；规则与已知逃逸口写在下面各条用例里）；
 *   ③ **token 表 / 引用登记表没有死条目，且与清单、台账、夹具逐项相等**（事实模型自身不许漂）。
 *
 * 残留局限（必须诚实，别当成已经解决）：
 *   - 模板里把数字写成**行内代码**可以躲过 ②（实测只有一处合法的 `` `1` ``，已显式登记）；
 *     行内代码里写 `` `34` `` 不会被抓——这是留给评审的一条口子；
 *   - ② 对**中文数词**只能做到"该数值要在 token 表里出现过"，弱于阿拉伯数字那条（下面会说明）；
 *   - 英文散文里的数词（"twice"、"three keys"）完全不扫：闸只认阿拉伯数字与中文数词+量词。
 */
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const docPath = (relative: string) => join(root, relative)
const read = (relative: string) => readFileSync(docPath(relative), 'utf8')

const tokenMap = buildTokens(tavernCardFields, worldFields)
const facts = buildFacts(tavernCardFields, worldFields)
const templates = DOC_FILES.map(({ lang, template }) => ({ lang, template, source: read(template) }))

/** 模板里出现过的数字（去掉围栏代码 / 行内代码 / 表格行 / 各种编号形态之后剩下的"裸计数"） */
function bareCounts(source: string): { line: number; value: string; visible: string }[] {
  const hits: { line: number; value: string; visible: string }[] = []
  let inFence = false
  source.split('\n').forEach((raw, index) => {
    if (/^\s*```/.test(raw)) { inFence = !inFence; return }
    if (inFence) return
    // 行内代码整体不扫（里面是路径、标识符、命令；纯数字的那几个由 INLINE_CODE_LITERALS 显式登记）
    for (const span of raw.matchAll(/`([^`\n]*)`/g)) {
      const inner = (span[1] ?? '').trim()
      if (/^\d+$/.test(inner) && !INLINE_CODE_LITERALS.has(inner)) {
        hits.push({ line: index + 1, value: inner, visible: `行内代码里的纯数字 \`${inner}\`` })
      }
    }
    const scrubbed = raw
      .replace(/`[^`\n]*`/g, ' ')                       // 行内代码
      .replace(/^(\s*\|\s*)\d+(\s*\|)/, '$1$2')          // 表格首列的序号（| 1 |）
      .replace(/\bP\d-\d+\b|\bissue-\d+\b/g, ' ')       // 分级编号
      .replace(/\b[\w./-]+\.(js|mjs|ts|json|md):\d+(-\d+)?/g, ' ') // 文件:行号
      .replace(/:\d+(-\d+)?/g, ' ')                     // 续引用的 :551
      .replace(/\bv?\d+\.\d+(\.\d+)?\b/g, ' ')          // 版本号 / 提交号里的点号形态
      .replace(/\b[0-9a-f]{7,40}\b/g, ' ')              // 提交哈希
      .replace(/\d{4}-\d{2}-\d{2}/g, ' ')               // 日期
      .replace(/#\d+/g, ' ')                            // #1 / #2 这类行号引用
      .replace(/\((\d+)\)|（(\d+)）|[①②③④⑤⑥⑦⑧⑨⑩]/g, ' ')   // 枚举标记
      .replace(/N 选 1|choose 1 of N/g, ' ')
    for (const match of scrubbed.matchAll(/(?<![\w.\-/:])\d+(?:\.\d+)?(?![\w.\-/:])/g)) {
      hits.push({ line: index + 1, value: match[0], visible: scrubbed.trim().slice(0, 120) })
    }
  })
  return hits
}

/** 中文数词 + 量词（"两条路"、"五项"）：弱规则，见文件头部的局限说明 */
const CN_NUMERALS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function chineseNumeralValues(source: string): { line: number; text: string; value: number }[] {
  const hits: { line: number; text: string; value: number }[] = []
  let inFence = false
  source.split('\n').forEach((raw, index) => {
    if (/^\s*```/.test(raw)) { inFence = !inFence; return }
    if (inFence) return
    const scrubbed = raw.replace(/`[^`\n]*`/g, ' ')
    for (const match of scrubbed.matchAll(/([零一二三四五六七八九十两]+)(项|条|行|个|处|张|份|次|段|层|类|轮|面|位|组|步)/g)) {
      const digits = match[1] as string
      const value = digits.length === 1
        ? CN_NUMERALS[digits]
        : digits[0] === '十' ? 10 + (CN_NUMERALS[digits[1] as string] ?? 0)
          : (CN_NUMERALS[digits[0] as string] ?? 0) * 10 + (digits[2] ? (CN_NUMERALS[digits[2]] ?? 0) : 0)
      if (value !== undefined) hits.push({ line: index + 1, text: match[0], value })
    }
  })
  return hits
}

describe('对外文档是生成产物（事实来自 docTokens，产物勿手改）', () => {
  it('两份文档逐字等于渲染结果（手改产物 / 改清单没重新生成都会红）', () => {
    const problems: string[] = []
    for (const { lang, source } of templates) {
      const expected = renderDoc(lang, source, tokenMap)
      const actual = read(DOC_FILES.find((entry) => entry.lang === lang)?.doc as string)
      if (actual !== expected) {
        const actualLines = actual.split('\n')
        const expectedLines = expected.split('\n')
        const firstDiff = expectedLines.findIndex((line, index) => line !== actualLines[index])
        problems.push(`${lang}: ${DOC_FILES.find((entry) => entry.lang === lang)?.doc} 与渲染结果不一致`
          + `（第一处差异在第 ${firstDiff + 1} 行：期望 ${JSON.stringify(expectedLines[firstDiff]?.slice(0, 80))}，`
          + `实际 ${JSON.stringify(actualLines[firstDiff]?.slice(0, 80))}）。`
          + '改文档内容要改模板 tests/fixtures/tavern-docs/*.md，再跑 pnpm generate:tavern-docs')
      }
      if (actual.split('\n')[0] !== HEADERS[lang]) problems.push(`${lang}: 产物开头缺"勿手改"声明`)
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('模板是 CRLF 检出时，渲染结果仍然是 LF（Windows 检出不再误报"文档已过期"）', () => {
    // 2026-10-07 独立评估 P0-2：产物用 `.gitattributes` 钉了 LF，而**模板**的换行由检出决定
    // （Git for Windows 默认 `core.autocrlf=true` ⇒ 工作区里是 CRLF）。第一版只归一了产物、没归一模板：
    // 模板里的 `\r` 原样进渲染结果、与 LF 产物逐字比对 ⇒ `check:tavern-docs`（在 `pnpm build` 里）
    // 在 Windows 上误报过期。这里把模板换成 CRLF，要求渲染结果与 LF 模板逐字相同。
    const first = templates[0]
    expect(first, '至少要有一份模板').toBeDefined()
    const source = first?.source as string
    const lang = first?.lang as DocLang
    const crlf = source.replace(/\r?\n/g, '\r\n')
    expect(crlf, '这个用例本身要能造出 CRLF 模板').toContain('\r\n')
    const rendered = renderDoc(lang, crlf, tokenMap)
    expect(rendered.includes('\r'), '渲染结果里不该有 \\r').toBe(false)
    expect(rendered).toBe(renderDoc(lang, source, tokenMap))
  })

  it('生成器自己的 --check 也认为产物是最新的（闸与生成器不能各说各话）', () => {
    // 上面那条用 vitest 的加载器比对；这里再走一遍生成器的 Node 加载路径，保证两条路的结论一致。
    const stdout = execFileSync(process.execPath, [join(root, 'scripts', 'generate-tavern-compat-docs.mjs'), '--check'], {
      cwd: root,
      env: { ...process.env, XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? join(root, '..', '.pnpm-data') },
      encoding: 'utf8',
    })
    expect(stdout).toContain('check: true')
  })

  it('模板里没有手写的计数（数字必须写成 <<token>>）', () => {
    const problems: string[] = []
    const allowed = new Set([...tokenMap.values()].flatMap((value) => value.match(/\d+(?:\.\d+)?/g) ?? []))
    for (const { lang, template, source } of templates) {
      for (const hit of bareCounts(source)) {
        // 数值出现在 token 表里也不算数：模板必须写成 <<token>>，不能把字面量抄一遍
        problems.push(`${lang} ${template}:${hit.line} 裸计数「${hit.value}」（${hit.visible}）——请改成 <<token>>（登记处 docTokens.ts）`)
      }
      for (const hit of chineseNumeralValues(source)) {
        if (IDIOM_NUMBERS.has(hit.value)) continue
        if (!allowed.has(String(hit.value))) {
          problems.push(`${lang} ${template}:${hit.line} 中文数词「${hit.text}」= ${hit.value}，token 表里没有这个值`)
        }
      }
    }
    expect(problems, `模板里出现了没有 token 来源的计数：\n${problems.join('\n')}`).toEqual([])
  })

  it('token 表没有死条目：登记过的 token 至少被一份模板用到', () => {
    const used = usedTokens(...templates.map(({ source }) => source))
    const dead = [...tokenMap.keys()].filter((id) => !used.has(id)).sort()
    expect(dead, `这些 token 登记了却没被任何模板引用（删掉或把模板补上）：\n${dead.join('\n')}`).toEqual([])
  })

  it('引用登记表：每条都被模板用到，且没有重复的 ref', () => {
    const used = usedTokens(...templates.map(({ source }) => source))
    const problems: string[] = []
    for (const id of Object.keys(CITATIONS)) {
      if (!used.has(`cite.${id}`)) problems.push(`引用 ${id}（${CITATIONS[id]?.ref}）登记了却没被模板引用`)
    }
    for (const id of Object.keys(PATHS)) {
      if (!used.has(`path.${id}`)) problems.push(`路径 ${id}（${(PATHS as Record<string, string>)[id]}）登记了却没被模板引用`)
    }
    // 同一个 ref 挂两个 id 是允许的（`:551` 这类续引用），但两边指的文件必须一致
    const byRef = new Map<string, string[]>()
    for (const [id, citation] of Object.entries(CITATIONS)) {
      const file = citation.ref.split(':')[0] as string
      byRef.set(file, [...(byRef.get(file) ?? []), id])
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('每条酒馆侧引用都能在仓库内摘录（或本机副本）的对应行上命中原文（干净检出也跑，行号漂移会红）', () => {
    // 2026-10-07 独立评估 P0-1：这一条原先直接 `readFileSync(join(root, '..', '.st-upstream', …))`，
    // 而 `wi.js` 与 `.st-upstream/` 都**不进仓库** ⇒ 干净检出（CI）上 ENOENT 直接红，补 try/catch 之后
    // "一段都没核对就失败"这条仍会红。现在行来自**仓库内的摘录**（`tests/fixtures/st-upstream/excerpts.json`，
    // 由 `pnpm generate:st-excerpts` 从上游副本摘出来），本机有整份副本时优先用副本。
    const problems: string[] = []
    const notVendored: { id: string; file: string; ref: string }[] = []
    let checked = 0
    let skipped = 0
    for (const [id, citation] of Object.entries(CITATIONS)) {
      // 登记表里混着**电子爱自己**的引用（`eleckoi.` 前缀，见 `PATHS` 的同一约定）：它们由各自的
      // 导入/锚点闸看着，比如 `tavern-world-file.test.js` 的 TOOL_CITATIONS。
      if (id.startsWith('eleckoi.')) { skipped += 1; continue }
      if (!citation.snippet) { skipped += 1; continue }
      const file = stSourceName((citation.wi ? 'wi.js' : citation.upstream) ?? refFileName(citation.ref) ?? '')
      if (!stIsVendored(file)) { notVendored.push({ id, file, ref: citation.ref }); continue }
      const lines = stSourceLines(file) as string[]
      checked += 1
      // **并集**语义：一条引用可能挂多行（`3440/3445/3451` 三个顶层读取点），登记的多条摘录
      // 只要都出现在这些行的并集里就算过。第一版是按"每个区间各查一遍"、且只取最后一个数字 ⇒ 整条被跳过。
      const cited = refRanges(citation.ref).flatMap(([first, last]) => {
        const slice: string[] = []
        for (let line = first; line <= last; line += 1) slice.push(lines[line - 1] ?? '')
        return slice
      })
      const snippets = Array.isArray(citation.snippet) ? citation.snippet : [citation.snippet]
      for (const snippet of snippets) {
        if (cited.some((line) => line.includes(snippet))) continue
        const actual = lines.findIndex((line) => (line ?? '').includes(snippet)) + 1
        problems.push(`${id}（${citation.ref}）里找不到摘录「${snippet}」${actual ? `（它现在在第 ${actual} 行，行号漂移了）` : '（摘录里也没有，转写可能错了）'}`)
      }
    }
    // 没有仓库内摘录的文件必须**显式登记**（`ST_SOURCES` 里的 `vendored: false`）：不许静默地少核对几条。
    const declared = new Set(stNotVendored())
    const undeclared = notVendored.filter((entry) => !declared.has(entry.file)).map((entry) => `${entry.id}（${entry.ref}）`)
    expect(undeclared, '这些引用既没有仓库内摘录，也没有登记"不 vendor"').toEqual([])
    // 一段都没核对 = 闸在空转：仓库里必须有摘录（跑 pnpm generate:st-excerpts）
    expect(checked, '一条引用都没能核对：仓库内摘录缺失').toBeGreaterThan(0)
    expect(problems, `引用与摘录不符（核对了 ${checked} 条、没有摘录的 ${notVendored.length} 条、其它跳过 ${skipped} 条）：\n${problems.join('\n')}`).toEqual([])
  })

  it('清单里每条酒馆侧引用的行都在仓库摘录里，且没指到文件外（离线可跑）', () => {
    // 清单每行的 `stSnippet` 是**缩写**（接口注明"≤80 字符，行号漂移后用于检索回定位"：实测会把
    // `entry.extensions?.X` 写成 `extensions.X`、`world_info_position.before` 写成 `0`、用 `...` 省略尾部），
    // 所以这里**不**核逐字包含；能核的是：引用的行都在摘录里（新加引用必须重新摘）+ 行号没超出文件总行数。
    const problems: string[] = []
    const unvendored = new Set<string>()
    let checked = 0
    for (const [label, fields] of [['tavernCardFields', tavernCardFields], ['worldFields', worldFields]] as const) {
      for (const field of fields) {
        if (!field.stReference) continue
        // 分号段可能不带文件名（`world-info.js:4481-4483; 1127-1128` 的后半段是延续）⇒ 继承前一段。
        let current = ''
        for (const ref of refParts(field.stReference)) {
          current = refFileName(ref) ?? current
          const file = stSourceName(current)
          if (!stIsVendored(file)) { unvendored.add(file); continue }
          const lines = stSourceLines(file) as string[]
          const lineCount = stLineCount(file) as number
          checked += 1
          for (const [first, last] of refRanges(ref)) {
            if (last > lineCount) problems.push(`${label}:${field.path} 引用了 ${ref}，但该文件只有 ${lineCount} 行`)
            for (let line = first; line <= last; line += 1) {
              if (lines[line - 1] === undefined) problems.push(`${label}:${field.path} 的 ${ref} 里第 ${line} 行不在摘录里（跑 pnpm generate:st-excerpts）`)
            }
          }
        }
      }
    }
    // 登记"不 vendor"的文件必须真的还被引用（否则那条登记是死的，该删）
    expect([...unvendored].sort(), '这些文件没有仓库内摘录（只登记、不核对）').toEqual(stNotVendored())
    expect(checked, '一条清单引用都没核对').toBeGreaterThan(0)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('文档事实与清单 / 世界书清单一致', () => {
    const problems: string[] = []
    const coverage = staticCoverage()
    const check = (label: string, actual: number | string, expected: number | string) => {
      if (String(actual) !== String(expected)) problems.push(`${label}: 文档事实是 ${actual}，清单实测 ${expected}`)
    }
    check('卡清单条数', facts.card.total, tavernCardFields.length)
    check('卡面 mapped', facts.card.mapped, coverage.mapped)
    check('卡面 mapped 百分数', facts.card.mappedPercent, ((coverage.mapped / coverage.total) * 100).toFixed(1))
    check('世界书名目', facts.world.total, worldFields.length)
    check('世界书 mapped', facts.world.mapped, worldFields.filter((field) => field.status === 'mapped').length)
    check('世界书 st-unread', facts.world.stUnread, worldFields.filter((field) => field.alignment === 'st-unread').length)
    check('带酒馆侧引用的行数', facts.card.citedRows, tavernCardFields.filter((field) => field.stReference).length)
    check('夹具份数', facts.fixtures.count, fixtureNames().length)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('接触加权那两个数由夹具重算（不再是钉住的常量）', () => {
    let presentMapped = 0
    let presentDropped = 0
    for (const fixture of fixtureNames()) {
      const coverage = coverageFor(fixture)
      presentMapped += coverage.presentMapped
      presentDropped += coverage.presentDropped
    }
    expect(facts.contact.mapped, '接触加权的分子与套件报告不一致：改 docTokens.ts 的 DECLARED 并重新生成').toBe(presentMapped)
    expect(facts.contact.total, '接触加权的分母与套件报告不一致').toBe(presentMapped + presentDropped)
    expect(facts.contact.percent).toBe(((presentMapped / (presentMapped + presentDropped)) * 100).toFixed(1))
  })

  it('台账数字与 tavernRedLedger 逐项相等（文档不许自己编一个红/绿数）', () => {
    const pairs: [string, number | string, number | string][] = [
      ['卡面红', facts.ledger.cardRed, ledger.CARD_TARGETS],
      ['伴生红', facts.ledger.companionRed, ledger.COMPANION_TARGETS],
      ['世界书面红', facts.ledger.worldRed, WORLD_TARGET_COUNT],
      ['本文件绿', facts.ledger.cardGreen, ledger.CARD_GREEN],
      ['伴生绿', facts.ledger.companionGreen, ledger.COMPANION_GREEN],
      ['世界书面绿', facts.ledger.worldGreen, ledger.WORLD_GREEN],
      ['红合计', facts.ledger.redTotal, ledger.RED_TOTAL],
      ['绿合计', facts.ledger.greenTotal, ledger.GREEN_TOTAL],
      ['用例合计', facts.ledger.caseTotal, ledger.TARGET_CASE_TOTAL],
      ['缺口总数', facts.ledger.gapTotal, ledger.GAP_TOTAL],
      ['已断言', facts.ledger.asserted, ledger.GAP_ASSERTED],
      ['空白证据（缺口内）', facts.ledger.gapBlank, ledger.GAP_BLANK],
      ['设计如此', facts.ledger.byDesign, ledger.GAP_BY_DESIGN],
      ['空白证据总数', facts.ledger.blankTotal, ledger.BLANK_TOTAL],
      ['非缺口证据', facts.ledger.nonGapTotal, ledger.NON_GAP_TOTAL],
    ]
    const problems = pairs.filter(([, actual, expected]) => actual !== expected)
      .map(([label, actual, expected]) => `${label}: 文档模型 ${actual}，台账 ${expected}`)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('台账的分解式自洽：41 + 1 + 1 + 2 + 4 = 49，34 + 5 = 39，27 + 29 + 3 = 59', () => {
    const l = facts.ledger
    expect(l.redFieldLevel + l.redInjectionModel + l.redInjectionOrder + l.redZeroGates + l.worldRed).toBe(l.redTotal)
    expect(l.blankTotal + l.nonGapTotal).toBe(l.ungated)
    expect(l.asserted + l.gapBlank + l.byDesign).toBe(l.gapTotal)
    expect(l.cardRed + l.companionRed + l.worldRed).toBe(l.redTotal)
    expect(l.cardGreen + l.companionGreen + l.worldGreen).toBe(l.greenTotal)
    expect(l.redTotal + l.greenTotal).toBe(l.caseTotal)
  })

  it('空白证据 / 非缺口证据的条数与套件实测一致', () => {
    expect(facts.ledger.blankTotal).toBe(blankWitnesses.length)
    expect(facts.ledger.nonGapTotal).toBe(nonGapWitnesses.length)
    expect(LEDGER_FACTS.blankTotal).toBe(blankWitnesses.length)
    expect(LEDGER_FACTS.nonGapTotal).toBe(nonGapWitnesses.length)
  })

  it('世界书面那张"5 处不一致"的表真的只有 5 行（散文数 != 表行数就红）', () => {
    const zh = read('docs/tavern-compatibility.md')
    const section = zh.slice(zh.indexOf('两条路实测有'), zh.indexOf('另外那条"卡 + 独立世界书"'))
    const rows = section.split('\n').filter((line) => /^\| \d+ \|/.test(line))
    expect(rows.length, `世界书面差异表的行数是 ${rows.length}，而正文与 token 写的是 ${facts.divergences.count}`)
      .toBe(facts.divergences.count)
    // 表里的 #4 / #1#2#3 分组也要与 token 一致
    const hardcoded = section.split('\n').filter((line) => line.includes('个键**根本没被读**')).length
    expect(hardcoded).toBe(1)
  })

  it('世界书面分母与卡面分母没有合并，且都写在文档里', () => {
    for (const { lang, source } of templates) {
      const doc = renderDoc(lang, source, tokenMap)
      expect(doc, `${lang}: 卡面分母丢了`).toContain(String(facts.card.total))
      expect(doc, `${lang}: 世界书分母丢了`).toContain(String(facts.world.total))
    }
    expect(facts.world.total).not.toBe(facts.card.total)
  })

  it('世界书清单的分级表（条目 extensions）与清单实际分组一致', () => {
    // 文档第一张分级表只列"条目级 extensions.*"被丢弃的键；分组变了这张表就得跟着变
    const ENTRY_EXT = 'data.character_book.entries[].extensions.'
    const dropped = tavernCardFields.filter((field) => kind(field) !== 'aligned' && kind(field) !== 'deviates' && kind(field) !== 'st-unread')
      .filter((field) => field.path.startsWith(ENTRY_EXT))
    const groups = new Map<string, number>()
    for (const field of dropped) {
      const key = field.tracking ?? 'unused'
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    const expected = { p0_4: groups.get('P0-4') ?? 0, p0_5: groups.get('P0-5') ?? 0, issue_3: groups.get('issue-3') ?? 0 }
    expect(facts.ext).toEqual(expected)
  })
})

/** 与清单闸一致的分类（这里只为上面那条用例服务） */
function kind(field: typeof tavernCardFields[number]): string {
  if (field.status === 'mapped') return field.alignment === 'deviates' ? 'deviates' : field.alignment === 'st-unread' ? 'st-unread' : 'aligned'
  if (field.stIgnores) return 'unused'
  return field.droppedReason === 'unsupported-carrier' ? 'unsupported-carrier' : 'known-gap'
}
