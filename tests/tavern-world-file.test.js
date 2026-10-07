import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSettingLibraryFile } from '../src/renderer/src/modules/settingLibraries/model/settingLibraryTransfer.js'
import { decodeCharacterCard } from '../packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats'
import { worldCoverage, worldDeviations, worldFields } from './helpers/tavernWorldFieldManifest'
import { ST_CITATIONS } from './helpers/tavernWiAnchors'
import { wiJsFullLines, wiJsLines } from './helpers/tavernStEvidence'

/**
 * 线 2：**世界书导入路径**（渲染层第二条导入面）的测量。
 *
 * 为什么单开一个文件：这是**另一个导入器**，输入是世界书导出通道（ST 自己的
 * `worlds/*.json` 形态），不是角色卡。`CONTEXT.md` 的「单列分母」要求它的字段数
 * **不并入**卡清单的 133 项。
 *
 * 为什么是 `.js`：本文件要 import 渲染层的 `.js` 模块，从 `.ts` 里 import 无类型声明的
 * `.js` 会被 `tsc -p tsconfig.node.json` 判为 TS7016。渲染层既有用例同样是 `.js`。
 *
 * ⚠️ 二轮订正（`.redgreen/58`）：第一版按"键名被读到、值被丢弃"把 7 行记成 `mapped`，
 * 实测那 7 个键在导入器里**一次都没出现**，已改判 `dropped`（分母 18/46 → 11/46）。
 * 本文件的 mapped 判据相应改成**逐键消融**：把一个键从夹具里删掉，导入结果必须变化——
 * 这样"声明为 mapped 但其实没读"会当场失败，而不是靠一句可观察性断言蒙过去。
 */

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixtures', 'tavern-worlds', 'world-full.json')

function loadWorld() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'))
}

function importWorld(world) {
  return parseSettingLibraryFile(JSON.stringify(world), 'sillytavern')
}

function importedEntries(world = loadWorld()) {
  return importWorld(world).entries
}

/**
 * 稳定投影：导入时**新生成**的字段（id / groupId / createdAt / updatedAt）每次都不一样，
 * 直接比 JSON 会把它们误当成"输出变了"。消融判据只关心**映射结果**，所以把它们剔掉。
 */
const VOLATILE = ['id', 'groupId', 'createdAt', 'updatedAt']
function projection(world) {
  return JSON.stringify(importedEntries(world).map((entry) => {
    const copy = { ...entry }
    for (const key of VOLATILE) delete copy[key]
    return copy
  }))
}

function entryByTitle(title, world = loadWorld()) {
  const entry = importedEntries(world).find((item) => item.title === title)
  expect(entry, `世界书导入结果里应有条目「${title}」`).toBeTruthy()
  return entry
}

function worldEntries() {
  return loadWorld().entries ?? []
}

/**
 * 夹具条目里出现过的**顶层键**（合并所有条目；不含顶层 name/entries）。
 * `extensions` 是一整行声明（见清单里那条 `$worlds.extensions`）：**不下钻**——
 * 里面的键名是 ST 侧的扩展袋，逐个声明会把测量面撑成"列出 ST 的所有扩展"。
 */
function presentWorldKeys() {
  const keys = new Set()
  for (const entry of worldEntries()) for (const key of Object.keys(entry)) keys.add(key)
  return [...keys].sort()
}

/** 每个 mapped 行"真的被读了"的判据：**消融**——删掉该键，导入结果必须变 */
const mappedAblation = {
  '$worlds.comment': (world) => strip(world, 'comment'),
  '$worlds.content': (world) => strip(world, 'content'),
  '$worlds.key': (world) => strip(world, 'key'),
  '$worlds.keysecondary': (world) => strip(world, 'keysecondary'),
  '$worlds.keys': (world) => strip(world, 'keys'),
  '$worlds.secondary_keys': (world) => strip(world, 'secondary_keys'),
  '$worlds.constant': (world) => flipConstant(world),
  // `disable` 是**条件**读取：`Object.hasOwn(item,'enabled') ? ... : !bool(item.disable)`。
  // 夹具里没有条目写 enabled，所以删掉 disable 会落回同一个 true；要证明它被读，
  // 消融必须把 disable 设成 true（此时缺 enabled 的条目应落停用）。
  '$worlds.disable': (world) => setAll(world, 'disable', true),
  '$worlds.case_sensitive': (world) => strip(world, 'case_sensitive'),
  '$worlds.match_whole_words': (world) => strip(world, 'match_whole_words'),
  '$worlds.extensions': (world) => stripExtensionKey(world, 'selectiveLogic'),
  // 三轮补的三行（`.redgreen/60`：独立评审 2.1 发现清单漏了它们）
  '$worlds.name': (world) => strip(world, 'name'),
  '$worlds.enabled': (world) => setAll(world, 'enabled', false),
  '$worlds.use_regex': (world) => strip(world, 'use_regex')
}

/**
 * ElecKoi 侧引用的登记表：行号 → 该行必须包含的原文。
 *
 * 为什么需要：`wi.js` 侧一直有"引用必须就地命中摘录"的闸，**电子爱侧没有**——清单里 6 个行号
 * 静默漂移过（独立评审 2.3：`:317→316`、`:330→328`、`:338→339`、`:340→336`、`:342→340`、`:343→341`）。
 * 下面那条用例做两件事：① 表里的每一行**真的**是那段原文（源码改了这里就红）；
 * ② 清单 note 里出现的每个 `settingLibraryTransfer.js:NNN` 都在这张表里（引用不能指向未登记的行）。
 */
const IMPORTER = 'src/renderer/src/modules/settingLibraries/model/settingLibraryTransfer.js'
const IMPORTER_CITATIONS = {
  307: 'const imported = rawEntries.map((item, index) => {',
  311: 'text(item.name) || text(item.comment) || keys[0]',
  313: 'integer(item?.extensions?.selectiveLogic)',
  316: 'createId("tavern-world-entry")',
  328: 'keywordScanDepth: 1',
  331: 'keywordUseRegex: !constant && bool(item.use_regex)',
  332: 'keywordIgnoreCase: !bool(item.case_sensitive',
  333: 'keywordWholeWord: bool(item.match_whole_words',
  336: 'Object.hasOwn(item, "enabled")',
  337: 'position: "insert_point_1"',
  339: 'insertRole: "user"',
  340: 'order: index + 1',
  341: 'viewOrder: index + 1',
  346: '} };'
}

/** 从每个条目删掉一个顶层键 */
function strip(world, key) {
  const copy = structuredClone(world)
  for (const entry of copy.entries) delete entry[key]
  return copy
}

/** 把某个键在所有条目上设成同一个值（值型/条件型键不能靠"删掉"消融） */
function setAll(world, key, value) {
  const copy = structuredClone(world)
  for (const entry of copy.entries) entry[key] = value
  return copy
}

/** 把 constant 全部反过来（值型键不能靠"删掉"消融，缺省会补回来） */
function flipConstant(world) {
  const copy = structuredClone(world)
  for (const entry of copy.entries) entry.constant = !entry.constant
  return copy
}

/** 从 extensions 袋子里删掉一个键 */
function stripExtensionKey(world, key) {
  const copy = structuredClone(world)
  for (const entry of copy.entries) if (entry.extensions) delete entry.extensions[key]
  return copy
}

/** 夹具里所有能当哨兵的值（数字 ≥10 万 / 字符串 ≥12 字符），记下它属于哪个顶层键 */
function fixtureSentinels() {
  const found = []
  const walk = (value, key) => {
    if (typeof value === 'number' && Math.abs(value) >= 100000) found.push({ key, value: String(value) })
    if (typeof value === 'string' && value.length >= 12) found.push({ key, value })
    if (Array.isArray(value)) value.forEach((item) => walk(item, key))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, item]) => walk(item, `${key}.${k}`))
  }
  for (const entry of worldEntries()) {
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'extensions') continue
      walk(value, key)
    }
  }
  return found
}

/**
 * 把一个 dropped 键在所有条目上改成**明显不同**的值。
 * 布尔/短值做不了"值级哨兵"（值本身太常见，出现等于没出现），但**消融**照样成立：
 * 改了它、导入结果不动 ⇒ 证明这个键没被读。这是三轮补的（独立评审 2.4）——
 * 第一版对 23 行只写了"只有布尔/短值，无法扫描"就放过了。
 */
function mutateDropped(world, key) {
  const copy = structuredClone(world)
  let mutated = 0
  for (const entry of copy.entries) {
    if (!Object.hasOwn(entry, key)) continue
    const value = entry[key]
    if (typeof value === 'boolean') entry[key] = !value
    else if (typeof value === 'number') entry[key] = value + 1
    else if (typeof value === 'string') entry[key] = `${value}!!`
    else if (Array.isArray(value)) entry[key] = [...value, 'PROBE-MUTATED']
    else if (value && typeof value === 'object') entry[key] = { ...value, probeMutated: true }
    mutated += 1
  }
  return { world: copy, mutated }
}

/** dropped 行里有真哨兵（能被值级扫描证明"没被读"）的键 */
function droppedWithSentinels() {
  const droppedKeys = new Set(worldFields.filter((f) => f.status === 'dropped').map((f) => f.path.slice('$worlds.'.length)))
  return new Set(fixtureSentinels().filter(({ key }) => droppedKeys.has(key)).map(({ key }) => key))
}

describe('世界书导入路径：字段映射覆盖率（单列分母，不并入卡清单的 133）', () => {
  it('清单声明的每一行都被夹具演练到（清单不会腐烂）', () => {
    const exercised = new Set(presentWorldKeys())
    const unexercised = worldFields
      .filter((field) => !exercised.has(field.path.slice('$worlds.'.length)))
      .map((field) => field.path)
    expect(unexercised, '这些世界书键在夹具里没出现过：要么补夹具，要么删清单行').toEqual([])
  })

  it('夹具里出现的每个键都在清单里声明过（未声明硬失败）', () => {
    const declared = new Set(worldFields.map((field) => field.path.slice('$worlds.'.length)))
    const undeclared = presentWorldKeys().filter((key) => !declared.has(key))
    expect(undeclared, '这些世界书键出现在夹具里但清单未声明，请补上').toEqual([])
  })

  it('每个 mapped 行都**真的被读**（消融：删掉该键，导入结果必须变）', () => {
    const baseline = projection(loadWorld())
    const mappedRows = worldFields.filter((field) => field.status === 'mapped').map((field) => field.path)
    const problems = []
    for (const path of mappedRows) {
      const mutate = mappedAblation[path]
      expect(mutate, `mapped 行 ${path} 没有消融判据：补 mappedAblation，或把它改成 dropped`).toBeTruthy()
      let mutated
      try { mutated = projection(mutate(loadWorld())) } catch (error) { mutated = `THREW ${error.message}` }
      if (mutated === baseline) problems.push(`${path}: 删掉这个键导入结果不变 ⇒ 它其实没被读，应改判 dropped`)
    }
    expect(problems, '以下 mapped 行是"声明了但没读"').toEqual([])
    expect(mappedRows.length, 'mapped 行数与消融判据数不一致').toBe(Object.keys(mappedAblation).length)
  })

  it('dropped 行没有被读取：有哨兵的逐键扫描，没哨兵的显式列出（不静默放水）', () => {
    const serialized = JSON.stringify(importedEntries())
    const droppedRows = worldFields.filter((field) => field.status === 'dropped').map((field) => field.path.slice('$worlds.'.length))
    const withSentinel = droppedWithSentinels()
    const leaks = fixtureSentinels()
      .filter(({ key, value }) => droppedRows.includes(key) && serialized.includes(value))
      .map(({ key, value }) => `${key}=${value}`)
    expect(leaks, '这些 dropped 行的哨兵出现在导入结果里——修复可能已落地').toEqual([])
    // 结构性盲区必须显式报告：卡套件会打印"值级哨兵扫描覆盖 59/90"，这里同样不许沉默
    const blind = droppedRows.filter((key) => !withSentinel.has(key) && !key.startsWith('extensions'))
    console.log(`\ndropped 行值级哨兵覆盖：${withSentinel.size} / ${droppedRows.length}`
      + `（${blind.length} 行只有布尔/短值，做不了哨兵扫描；它们由下一条用例的**消融**覆盖，逐条列在下面）`)
    for (const key of blind) console.log(`  · $worlds.${key}`)
    // 钉成常量：砍到只剩 1 条哨兵也要当场红（第一版是 toBeGreaterThan(0)，形同没闸）
    expect(withSentinel.size, '有哨兵的 dropped 行数变了（要么夹具变了，要么清单分类变了）').toBe(14)
  })

  it('哨兵扫不到的 dropped 行用**消融**证明：改掉它的值，导入结果必须**完全不变**', () => {
    const baseline = projection(loadWorld())
    const present = new Set(presentWorldKeys())
    const topLevel = worldFields
      .filter((field) => field.status === 'dropped' && present.has(field.path.slice('$worlds.'.length)))
    const problems = []
    let checked = 0
    for (const field of topLevel) {
      const key = field.path.slice('$worlds.'.length)
      const { world, mutated } = mutateDropped(loadWorld(), key)
      expect(mutated, `${field.path}: 夹具里应当有这个键，否则这条消融是空的`).toBeGreaterThan(0)
      checked += 1
      if (projection(world) !== baseline) {
        problems.push(`${field.path}: 改了值导入结果就变了 ⇒ 它其实被读了，应改判 mapped`)
      }
    }
    // 反向自检：这条用例必须真的覆盖到"哨兵扫不到的"那一批，不能只扫有哨兵的
    const blind = topLevel.filter((field) => !droppedWithSentinels().has(field.path.slice('$worlds.'.length)))
    expect(blind.length, '应当有一批 dropped 行没有哨兵、只能靠消融').toBeGreaterThan(0)
    expect(checked, '被消融覆盖的 dropped 顶层行数变了').toBe(topLevel.length)
    expect(problems, '这些 dropped 行被读取了').toEqual([])
  })

  it('清单的差异申报与落点口径自洽（deviation 必须配 alignment: deviates）', () => {
    const problems = []
    for (const field of worldFields) {
      if (field.deviation && field.alignment !== 'deviates') problems.push(`${field.path}: 有 deviation 但 alignment 不是 deviates`)
      if (field.alignment === 'deviates' && !field.deviation) problems.push(`${field.path}: alignment 是 deviates 但没有 deviation 说明差在哪`)
      if (field.status === 'dropped' && field.alignment) problems.push(`${field.path}: dropped 行不该有 alignment`)
      if (field.status === 'mapped' && !field.landing) problems.push(`${field.path}: mapped 行没有落点`)
    }
    expect(problems, '世界书清单的差异申报不自洽').toEqual([])
    expect(worldDeviations().length, 'deviates 行数变了：必须同步文档「独立世界书导入面」的差异表').toBe(3)
  })

  it('清单里引用的**电子爱侧**行号是真的（这个方向原来没有任何闸）', () => {
    const source = readFileSync(join(here, '..', IMPORTER), 'utf8').split('\n')
    const problems = []
    for (const [line, snippet] of Object.entries(IMPORTER_CITATIONS)) {
      const actual = source[Number(line) - 1] ?? ''
      if (!actual.includes(snippet)) {
        problems.push(`登记表说 :${line} 是「${snippet}」，实际是「${actual.trim()}」（行号漂移或转写错了）`)
      }
    }
    const manifestSource = readFileSync(join(here, 'helpers', 'tavernWorldFieldManifest.ts'), 'utf8')
    const cited = new Set([...manifestSource.matchAll(/settingLibraryTransfer\.js:(\d+)(?:-(\d+))?/g)]
      .flatMap((match) => [Number(match[1]), Number(match[2] ?? match[1])]))
    const unregistered = [...cited].filter((line) => !(line in IMPORTER_CITATIONS)).sort((a, b) => a - b)
    expect(problems, '电子爱侧引用与源码不符').toEqual([])
    expect(unregistered, '清单引用了登记表没登记的行：要么补表，要么把行号改对').toEqual([])
  })

/**
 * 【wi.js 侧引用的登记表】在 `tests/helpers/tavernWiAnchors.ts`：生成器
 * `scripts/generate-st-excerpts.mjs` 要读同一份表（测试文件不能被它 import），所以数据与用例分开，
 * 避免两边各写一份。表本身（以及"为什么补这张表"）的说明在那个文件里。
 * 下面这个函数负责从清单正文里抽出被引用的锚点行，再与那张表对账。
 */

/** 从一段文字里取出所有 `wi.js:` 引用的锚点行（逗号分段各取第一个数字，范围只取起始行） */
function citedStLines(text) {
  const found = new Set()
  for (const match of text.matchAll(/wi\.js:([^`\n']+)/g)) {
    for (const part of match[1].split(/[,，]/)) {
      const digits = /(\d+)/.exec(part)
      if (digits) found.add(Number(digits[1]))
    }
  }
  return [...found].sort((left, right) => left - right)
}

  // 行来自本机整份副本，没有则用**仓库内的摘录**（`tests/fixtures/st-upstream/excerpts.json`）⇒ CI 上也跑。
  it.skipIf(!wiJsLines())('清单里的每个 wi.js 引用都与原文对得上（wi.js 侧也要有闸，不只是电子爱侧）', () => {
    const manifestSource = readFileSync(join(here, 'helpers', 'tavernWorldFieldManifest.ts'), 'utf8')
    const lines = wiJsLines() ?? []
    const cited = citedStLines(manifestSource)
    const problems = []
    const unregistered = cited.filter((line) => !(line in ST_CITATIONS))
    if (unregistered.length) problems.push(`清单引用了登记表没登记的 wi.js 行：${unregistered.join('、')}`)
    const unread = Object.keys(ST_CITATIONS).map(Number).filter((line) => !cited.includes(line))
    if (unread.length) problems.push(`登记表里有清单不再引用的行（表在腐烂）：${unread.join('、')}`)
    for (const [line, snippet] of Object.entries(ST_CITATIONS)) {
      if (!(lines[Number(line) - 1] ?? '').includes(snippet)) {
        problems.push(`登记表说 wi.js:${line} 是「${snippet}」，实际是「${(lines[Number(line) - 1] ?? '').trim()}」`)
      }
    }
    expect(problems, 'wi.js 侧引用与原文不符').toEqual([])
  })

/**
 * `resources/dsh/setting-library-tools.mjs` 里我用到的两个锚点（行号 → 该行必须包含的原文）。
 * 上游改这个文件时函数会整体下移，所以行号必须被闸看着。
 */
const TOOL_FILE = 'resources/dsh/setting-library-tools.mjs'
const TOOL_CITATIONS = {
  449: 'function containsKeyword(text, rawKeyword, entry) {',
  470: 'function compileTavernKeywordRegex(value, ignoreCase) {'
}

  it('我对 resources/dsh 引用的行号也是真的（上游重构时函数会整体下移）', () => {
    // 三-轮教训：`setting-library-tools.mjs` 在上游 v0.2.7 里被改过，`containsKeyword` 从 385 下移到 449、
    // `compileTavernKeywordRegex` 从 406 下移到 470——我的一堆注释里的行号全成了假的。
    // 这里把用到的锚点登记下来，行号或函数名再变就当场红。
    const lines = readFileSync(join(here, '..', TOOL_FILE), 'utf8').split('\n')
    const problems = []
    for (const [line, snippet] of Object.entries(TOOL_CITATIONS)) {
      const actual = lines[Number(line) - 1] ?? ''
      if (!actual.includes(snippet)) {
        problems.push(`TOOL_CITATIONS 说 :${line} 是「${snippet}」，实际是「${actual.trim()}」`)
      }
    }
    expect(problems, 'resources/dsh 侧的引用锚点与源码不符').toEqual([])
  })

  // 全文反证只有**整份副本**能做（摘录里数"出现次数"是假绿）。
  it.skipIf(!wiJsFullLines())('清单声称的反证也成立：wi.js 全文没有 use_regex（`$worlds.use_regex` 是 st-unread 的判据）', () => {
    const text = (wiJsFullLines() ?? []).join('\n')
    expect(text.split('use_regex').length - 1, 'wi.js 里出现了 use_regex——那条 st-unread 的判据要重写').toBe(0)
  })

  it('打印覆盖率报告（与卡清单分母并列，不合并）', () => {
    const coverage = worldCoverage()
    console.log(`\n世界书导入路径覆盖率：${coverage.mapped} / ${coverage.total} = ${coverage.percent}%`)
    console.log('卡导入路径（另行报数，不合并）：36 / 133 = 27.1%')
    console.log(`有 deviation 的 world 行：${worldDeviations().length} 条\n`)
    expect(coverage.total, '世界书清单的行数不应等于卡清单的 133（那是合并了分母）').not.toBe(133)
    expect(coverage.mapped).toBeGreaterThan(0)
  })
})

describe('世界书导入路径：与卡导入路径的差异（可断言，不是声明）', () => {
  it('差异 1：`[initvar]` / `[mvu_update]` 条目——世界书路径当普通条目导进来，卡路径过滤掉', () => {
    const withMvu = {
      name: 'PROBE MVU 世界书',
      entries: [
        { uid: 0, comment: '[initvar]', content: '<% var x %>', key: ['INITVAR'], constant: true, extensions: {} },
        { uid: 1, comment: '[mvu_update] 更新规则', content: 'PROBE-MVU-RULE', key: ['MVU-UPDATE'], constant: true, extensions: {} },
        { uid: 2, comment: '普通条目', content: 'PROBE-MVU-PLAIN', key: ['PLAIN'], extensions: {} }
      ]
    }
    const titles = importWorld(withMvu).entries.map((entry) => entry.title)
    expect(titles, '世界书路径今天**不过滤** MVU 基础设施条目（已知差异，修好会变红）').toContain('[initvar]')
    expect(titles).toContain('[mvu_update] 更新规则')
    expect(Object.hasOwn(importWorld(withMvu), 'variableConfig'), '世界书路径不产出变量配置').toBe(false)

    // 对照：卡路径会过滤这两条
    const card = {
      spec: 'chara_card_v3', spec_version: '3.0',
      data: {
        name: 'PROBE MVU 卡', first_mes: 'hi',
        character_book: { name: '书', entries: withMvu.entries },
        extensions: { tavern_helper: { variables: { x: 0 }, scripts: [] } }
      }
    }
    const cardTitles = (decodeCharacterCard(new TextEncoder().encode(JSON.stringify(card)), 'sillytavern')
      .settingLibrary?.entries ?? []).map((entry) => entry.title)
    expect(cardTitles, '卡路径今天过滤 [initvar]').not.toContain('[initvar]')
    expect(cardTitles, '卡路径今天过滤 [mvu_update]').not.toContain('[mvu_update] 更新规则')
  })

  it('差异 2：`selectiveLogic` 只读 `extensions.selectiveLogic`，顶层被忽略', () => {
    // 夹具「副键逻辑条目」把 selectiveLogic: 2（NOT_ANY）放在**顶层**，`extensions` 为空
    expect(entryByTitle('驼峰拼写条目').keywordCondition, '顶层 selectiveLogic 今天被忽略 ⇒ 落 any').toBe('any')
    // 夹具「扩展袋形态条目」把 selectiveLogic: 3（AND_ALL）放在 extensions 里 ⇒ 读到
    expect(entryByTitle('扩展袋形态条目').keywordCondition, 'extensions.selectiveLogic 今天读到 ⇒ 落 all').toBe('all')
  })

  it('差异 3：ST 落盘的驼峰拼写（`caseSensitive` / `matchWholeWords`）被忽略，只有蛇形被读', () => {
    // 「驼峰拼写条目」只有驼峰：caseSensitive: true / matchWholeWords: true ⇒ 全部落缺省
    const camel = entryByTitle('驼峰拼写条目')
    expect(camel.keywordIgnoreCase, '驼峰 caseSensitive 被忽略 ⇒ 缺省忽略大小写').toBe(true)
    expect(camel.keywordWholeWord, '驼峰 matchWholeWords 被忽略 ⇒ 缺省不整词').toBe(false)
    // 「蛇形拼写条目」有蛇形 `case_sensitive` / `match_whole_words` ⇒ 读到
    const snake = entryByTitle('蛇形拼写条目')
    expect(snake.keywordIgnoreCase, '蛇形 case_sensitive 被读 ⇒ false').toBe(false)
    expect(snake.keywordWholeWord, '蛇形 match_whole_words 被读 ⇒ true').toBe(true)
    // 「扩展袋形态条目」的 extensions.* 别名同样被读
    const bag = entryByTitle('扩展袋形态条目')
    expect(bag.keywordIgnoreCase, 'extensions.case_sensitive 被读 ⇒ false').toBe(false)
    expect(bag.keywordWholeWord, 'extensions.match_whole_words 被读 ⇒ true').toBe(true)
  })

  it('差异 4：`position` / `depth` / `role` / `displayIndex` / `order` 全部不被读（硬编码）', () => {
    const flat = entryByTitle('扩展袋形态条目')
    expect(flat.position, 'position 硬编码 insert_point_1（文件里是数字枚举）').toBe('insert_point_1')
    expect(flat.keywordScanDepth, 'depth 硬编码 1').toBe(1)
    expect(flat.insertRole, 'role 硬编码 user').toBe('user')
    expect(flat.viewOrder, 'displayIndex 不被读，落数组序号').toBe(7)
    expect(flat.order, 'order 不被读，落数组序号').toBe(7)
    // 消融证明：把这些键整批删掉，输出完全不变
    const stripped = strip(strip(strip(strip(strip(loadWorld(), 'position'), 'depth'), 'role'), 'displayIndex'), 'order')
    expect(projection(stripped), '删掉这 5 个键导入结果应当完全不变（证明它们确实没被读）').toBe(projection(loadWorld()))
  })

  it('差异 5：缺 `enabled` 的条目两条路一致（都落启用）', () => {
    expect(entryByTitle('缺 enabled 条目').enabled, '世界书路径：缺 enabled 落启用').toBe(true)
  })

  it('两条路对同一份**双方都读的**条目给出相同映射（蛇形键）', () => {
    // ⚠️ 用两个导入器**都认**的拼写（蛇形 case_sensitive + extensions.*），
    // 否则这条只会证明"两条路忽略同一批驼峰键"——那是差异，不是一致。
    const entries = [{
      comment: '一致性对照', content: 'PROBE-BOTH-正文',
      keys: ['PROBE-BOTH'], secondary_keys: ['PROBE-BOTH2'],
      constant: false, disable: true,
      case_sensitive: true, match_whole_words: true,
      extensions: { selectiveLogic: 2 }
    }]
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'PROBE 对照卡', first_mes: 'hi', character_book: { name: 'PROBE 对照书', entries } } }
    const byCard = decodeCharacterCard(new TextEncoder().encode(JSON.stringify(card)), 'sillytavern')
      .settingLibrary?.entries.find((entry) => entry.title === '一致性对照')
    const byWorld = importWorld({ name: '书', entries }).entries.find((entry) => entry.title === '一致性对照')
    expect(byCard, '卡路径应导入该条目').toBeTruthy()
    const shared = ['content', 'keywords', 'conditionKeywords', 'keywordCondition', 'keywordUseRegex', 'keywordIgnoreCase', 'keywordWholeWord', 'agentReadStrategy', 'enabled']
    for (const key of shared) {
      expect(byWorld[key], `两条路的 ${key} 应一致（用双方都认的拼写时）`).toEqual(byCard[key])
    }
  })
})
