import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSettingLibraryFile } from '../src/renderer/src/modules/settingLibraries/model/settingLibraryTransfer.js'
import { setWorldInfo, WORLD_TARGET_COUNT } from './helpers/tavernWorldFileTargetEvidence'
import { refLines, wiJsFullLines, wiJsLines } from './helpers/tavernStEvidence'
import { tavernTargetEnabled } from './helpers/tavernTargetGate'

/**
 * 【R2 目标套件 · 第二条导入面】世界书导入路径的**红目标**。
 *
 * 与 `tavern-world-file.test.js` 的分工（同一批事实，两个方向）：
 *   - `tavern-world-file.test.js` 是**回归网**（默认跑、今天绿）：把两条路的 **4+1 处差异**钉成
 *     "现状就是这样"，**修好会红**；
 *   - 本文件是**目标套件**（`ELECKOI_TAVERN_COMPAT_TARGET=1` 才跑、今天**红**）：把同一批差异
 *     写成"酒馆会怎么做"，**实现落地会绿**。
 *
 * 为什么要分开：本轮明确**不做产品修复、只做测试度量**。回归网记录现状，目标套件记录差距——
 * 后者进账目（红数），所以"还差多少"是一个可打印、可回归的数字，而不是文档里的一句散文。
 *
 * 判据绑定：每条断言的依据必须申报在 `tests/helpers/tavernWorldFileTargetEvidence.ts`
 * （`wi.js` 引用 + 就地命中的摘录），并有 `WORLD_TARGET_COUNT` 绝对条数闸——不许悄悄删一条。
 * 那条闸**不受开关门控**（在下面独立的 describe 里），所以默认模式也会核"依据没被抽走"。
 *
 * ⚠️ 开关口径：`tavernTargetEnabled()`（只认 1/true）。第一版写的是
 * `Boolean(process.env.ELECKOI_TAVERN_COMPAT_TARGET?.trim())`，于是 `=0` / `=false` 会把红套件**打开**。
 *
 * ⚠️ 多条断言的用例一律用 `expect.soft`：第一版把两条断言写在同一个 `it` 里而**前面的先失败**，
 * 后面那条（`[mvu_update]`、`keywordWholeWord`）从来没被执行过（独立评审 1.1）。
 */

const enabled = tavernTargetEnabled()

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixtures', 'tavern-worlds', 'world-full.json')
const thisFile = fileURLToPath(import.meta.url)

function loadWorld() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'))
}

function importWorld(world) {
  return parseSettingLibraryFile(JSON.stringify(world), 'sillytavern')
}

function entryByTitle(title, world = loadWorld()) {
  const entry = importWorld(world).entries.find((item) => item.title === title)
  expect(entry, `世界书导入结果里应有条目「${title}」`).toBeTruthy()
  return entry
}

/** 每条目标断言的标题里写的 `wi.js:NNNN` 必须与申报表一致（照抄卡面套件的手法） */
const citedTitles = []
function worldTarget(title, body) {
  const declared = setWorldInfo.find((item) => item.title === title)
  if (!declared) throw new Error(`世界书目标断言「${title}」没有申报依据`)
  citedTitles.push(title)
  it(title, body)
}

describe.skipIf(!enabled)('【R2 目标 · 世界书导入面】与酒馆一致：今天应当红', () => {
  worldTarget('世界书条目的键写成 /…/flags 时应被当作正则（酒馆 wi.js:339 `parseRegexFromString(needle)` 按键名自动识别）', () => {
    const world = {
      name: 'PROBE 正则键世界书',
      entries: [{ uid: 0, comment: '正则条目', content: 'PROBE-REGEX-T', key: ['/^PROBE-REGEX-\\d+$/i'], extensions: {} }]
    }
    const entry = entryByTitle('正则条目', world)
    // 判据必须**两半一起**（第一版只有前半句，能被"没有行为改进"的改动买绿——独立评审 1.2）：
    //   ① 原样保留 `/…/flags`：剥定界符与合并 flags 是匹配器 `compileTavernKeywordRegex`
    //      （`resources/dsh/setting-library-tools.mjs:470`）的活，导入侧先剥会把 `i` 丢掉；
    //   ② 同时置 `keywordUseRegex: true`：否则匹配器按**字面量**比 `^PROBE-REGEX-\d+$`，比今天更糟。
    // 「剥掉斜杠但 keywordUseRegex 仍是 false」这种改动过不了①，也不会因为①过而蒙过②。
    expect.soft(entry.keywords, '酒馆按键名识别正则；电子爱今天把它当字面量原文存着').toEqual(['/^PROBE-REGEX-\\d+$/i'])
    expect.soft(entry.keywordUseRegex, '键被识别成正则后必须打开 keywordUseRegex，否则匹配器按字面量比').toBe(true)
  })

  worldTarget('世界书导入路径应像卡导入路径一样过滤 MVU 基础设施条目（酒馆 wi.js:2104 `addMissingWorldInfoFields` 只补字段、不改变"哪条该进设定库"）', () => {
    const world = {
      name: 'PROBE MVU 世界书',
      entries: [
        { uid: 0, comment: '[initvar]', content: '<% var x %>', key: ['INITVAR'], constant: true, extensions: {} },
        { uid: 1, comment: '[mvu_update] 更新规则', content: 'PROBE-MVU-RULE', key: ['MVU-UPDATE'], constant: true, extensions: {} },
        { uid: 2, comment: '普通条目', content: 'PROBE-MVU-PLAIN', key: ['PLAIN'], extensions: {} }
      ]
    }
    const titles = importWorld(world).entries.map((entry) => entry.title)
    expect.soft(titles, 'MVU 基础设施条目不该变成设定库条目（两条路应当一致）').not.toContain('[initvar]')
    expect.soft(titles).not.toContain('[mvu_update] 更新规则')
    // 正向控制（独立评审 1.3）：没有它，"把世界书条目全部过滤掉"也能让上面两条通过。
    expect.soft(titles, '普通条目必须还在，否则"全过滤掉"也能让上面两条过').toContain('普通条目')
  })

  worldTarget('世界书条目的顶层 selectiveLogic 应被读取（酒馆 wi.js:4090 定义在顶层、wi.js:4939 `entry.selectiveLogic ?? 0` 是世界书读取侧；wi.js:4930 只在有副键时才走到）', () => {
    const world = {
      name: 'PROBE 顶层逻辑世界书',
      entries: [{ uid: 0, comment: '顶层逻辑条目', content: 'PROBE-TOP-LOGIC', key: ['PROBE-TL'], keysecondary: ['PROBE-TL2'], selective: true, selectiveLogic: 2, extensions: {} }]
    }
    // 顶层 selectiveLogic: 2 = NOT_ANY（wi.js:33-38）。今天被忽略，落 any。
    // ⚠️ 二轮订正：原来这里引 `wi.js:5646`——那行在 `convertCharacterBook` 里（卡内嵌形状 → 运行时形状），
    // 正是本套件表头自己声明"不是世界书文件读取侧"的那一段；世界书读顶层的地方是 4939。
    expect(entryByTitle('顶层逻辑条目', world).keywordCondition, '顶层 selectiveLogic 应落 not_any').toBe('not_any')
  })

  worldTarget('世界书条目的驼峰 caseSensitive / matchWholeWords 应被读取（酒馆 wi.js:4113-4114 定义这两个顶层名、wi.js:2104 按同名回填）', () => {
    const world = {
      name: 'PROBE 驼峰世界书',
      entries: [{
        uid: 0, comment: '驼峰条目', content: 'PROBE-CAMEL', key: ['PROBE-CM'],
        caseSensitive: true, matchWholeWords: true, extensions: {}
      }]
    }
    const entry = entryByTitle('驼峰条目', world)
    expect.soft(entry.keywordIgnoreCase, '驼峰 caseSensitive 应被读取 ⇒ 忽略大小写关闭').toBe(false)
    expect.soft(entry.keywordWholeWord, '驼峰 matchWholeWords 应被读取 ⇒ 整词匹配打开').toBe(true)
  })
})

/**
 * 判据绑定闸（**不受开关门控**：默认模式也跑，因为"依据没被抽走"与产品行为无关）。
 *
 * 第一版把这条闸放在 `describe.skipIf(!enabled)` 里，于是 CI 默认模式整块不跑（独立评审 1.5）；
 * 而且它靠"定义期收集标题"（`citedTitles`），一旦主 describe 被跳过就收集不到。现在改成
 * **直接读本文件源码**里的 `worldTarget('…')` 标题，两种模式都一样准。
 */
describe('【判据绑定 · 世界书导入面】依据是数据、不许被悄悄抽走（不受开关门控）', () => {
  const source = readFileSync(thisFile, 'utf8')

  it('申报表里的每条都有对应的目标断言，且没有多写/少写', () => {
    // 只认行首缩进后的调用：本文件注释里也写了 `worldTarget('…')` 这个形状，不加锚会多数一条
    const written = [...source.matchAll(/^\s*worldTarget\('([^']+)'/gm)].map((match) => match[1])
    expect(written.length, '世界书目标断言条数变了：必须同步 WORLD_TARGET_COUNT').toBe(WORLD_TARGET_COUNT)
    expect(setWorldInfo.length, '申报表条数变了').toBe(WORLD_TARGET_COUNT)
    expect([...written].sort(), '用例标题与申报表必须一一对应').toEqual(setWorldInfo.map((item) => item.title).sort())
    // `describe.skipIf` 仍会执行定义体（只是把用例标成 skip），所以 `worldTarget` 在两种模式下都注册过。
    // 这一条把"定义期真的注册了 4 次"与源码解析、申报表三者对上（三者任一变了都红）。
    // ⚠️ 第一版写成 `enabled ? WORLD_TARGET_COUNT : 0`——默认模式下 `describe.skipIf` 照样收集，
    // 定义体照跑，于是断言假红；口径想错了，不是套件坏了。
    expect(citedTitles.length, '定义期注册的目标断言条数').toBe(WORLD_TARGET_COUNT)
  })

  it('标题里写的 wi.js 依据必须在申报表里', () => {
    const problems = []
    for (const item of setWorldInfo) {
      const written = item.title.match(/wi\.js:\d+(?:-\d+)?/g) ?? []
      const undeclared = written.filter((ref) => !item.citations.some((citation) => citation.ref === ref))
      if (undeclared.length) problems.push(`「${item.title}」标题里写了申报表没有的依据 ${undeclared.join('、')}`)
      if (!written.length) problems.push(`「${item.title}」标题里一条 wi.js 依据都没写`)
    }
    expect(problems, '世界书目标断言的依据要被抽走了').toEqual([])
  })

  // 行来自本机整份副本，没有则用**仓库内的摘录**（`tests/fixtures/st-upstream/excerpts.json`）⇒ CI 上也跑。
  // 这一段让 `tavernWorldFileTargetEvidence.ts` 表头那句"对照 wi.js 由卡面套件统一负责"变成真的：
  // 世界书面的 4 条引用**自己也**被逐行核对。
  describe.skipIf(!wiJsLines())('对照 wi.js（本机整份副本优先，没有则用仓库内摘录 ⇒ CI 上也跑）', () => {
    it('每条申报引用都能在 wi.js 对应行上就地命中摘录', () => {
      const lines = wiJsLines()
      const problems = []
      for (const item of setWorldInfo) {
        for (const citation of item.citations) {
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
      expect(problems, '世界书面引用与 wi.js 不符').toEqual([])
    })

    // 全文反证只有**整份副本**能做（摘录里数"出现次数"是假绿）。
    it.skipIf(!wiJsFullLines())('"全文 0 命中"这类反证也要真的成立', () => {
      const text = (wiJsFullLines() ?? []).join('\n')
      const problems = []
      for (const item of setWorldInfo) {
        for (const pattern of item.fullTextAbsent ?? []) {
          const hits = text.split(pattern).length - 1
          if (hits !== 0) problems.push(`${pattern} 在 wi.js 里出现 ${hits} 次，与"0 命中"矛盾（${item.title}）`)
        }
      }
      expect(problems).toEqual([])
    })
  })
})
