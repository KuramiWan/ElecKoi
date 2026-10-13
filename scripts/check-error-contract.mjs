/**
 * 错误契约闸 `check:error-contract`——ADR 0002 决定 6 的首批三条规则 + 只减不增的豁免账本。
 *
 * 判据来源：ADR 0002 决定 6（新建本闸、独立成册、每条规则配一次突变演练）、决定 11（豁免账本
 * `rule / file / line / reason / tracking`、断言「实际命中集合 == 账本集合」、`MAX_EXEMPTIONS` 冻结）；
 * spec-error-handling-interface.md 决定 11 与「判据纪律」；票 EH-9。
 *
 * ## 三条规则的判据（逐条写死在这里，突变演练见 notes/error-handling-gate-mutation.md）
 *
 * 规则 1「禁止丢码」：一行里出现 `new Error(`，且它的实参里通过 `.error` 取 `.message`
 * （含可选链 `?.`）——即从失败信封里只留 message、重新包成裸 `Error`。
 * 正则：`/new\s+Error\s*\([^)]*\.error\??\.message/`
 *
 * **接收者是通配的，不写死变量名。** 这条规则存在的理由就是：`result?.error?.message` 之外的变量名
 * （`accepted?.error?.message`、`status.error.message`、`event.data.reason.error?.message`）是同一个
 * 丢码形态，写死变量名的正则会漏掉它们。`new Error(` 前面有没有 `throw` 也不作为条件：
 * `finish(new Error(<…>.error.message))` 一样把码压成了字符串。
 * **不查的形状**：`if (!x.ok) throw new Error('…')`（抛出时不读 `.error.message`）——它与普通抛出在
 * 文本上不可分，而按守卫配对的写法会把 `fetch` 的 `if (!response.ok)` 也抓进来
 * （`apps/web/src/ui/ui/AvatarSlotsEditor.jsx:62`、`packages/dsh-product-api/src/tavily.ts:39` 两处是
 * HTTP `Response.ok`，不是产品 RemoteResult）。这是**已知的漏报面**，如实记在这里。
 *
 * 规则 2「契约违例必须给 `eleckoi/contract/invalid-*` 并把 `issues` 放进详情」：逐个 `code:` 位置看。
 * 契约违例码只认契约声明的两条（`ELECKOI_FAILURE_CODES.contractInvalidRequest` /
 * `contractInvalidResponse`，或它们的字面量）；命中这两条的产出点必须满足：
 * ① 产出它的**对象字面量**里有 `issues`；② 同一文件里有**非空**的 `issues` 数组，
 * 且它的元素带 `path` 与 `message` 两个字段。
 * 契约自己的声明目录（`packages/product-shared/src/contracts/errors/`）是判据来源、不是产出点，
 * 不参与规则 2 的扫描（例外写在 `CONTRACT_DECLARATION_DIRECTORY`）。
 *
 * 规则 3「空 catch 必须有豁免声明」：两种形状都算命中——
 * `.catch(() => {})`（空箭头体）与空/仅注释的 `try{}catch{}` 体。
 * 正则：`/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/` 与
 * `/catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*|\/\*[^\n]*?\*\/\s*)*\}/`
 *
 * ## 账本语义（决定 11）
 *
 * 账本是纯数据文件 `scripts/error-contract-exemptions.json`，每条含 `rule / file / line / reason /
 * tracking`。闸断言**实际命中集合 == 账本集合**：命中没登记 → 红；登记了但没有命中
 * （豁免已失效）→ 红。`MAX_EXEMPTIONS` 是冻结上限（写在下面的常量里），账本超过它就红；
 * 改这个数字必须在 diff 里显式可见。
 *
 * `tracking` 必须给出**失效条件**的落点：`docs/open-problems/<文件>.md` 加该文件的状态行指针，
 * 或 `docs/adr/<文件>.md 决定 <n>`。闸会核对落点文件存在、且确实有那条状态行 / 那个决定条目——
 * 「没有失效条件的豁免不许存在」是机器判据，不是口头约定。
 * 指针必须是**具体的族名**（如 `族 B`）：裸写的 `状态行` 不算——它不指向任何一条失效条件，
 * 任何豁免都能靠它过（EH-11 的 J 项收紧，突变演练见 `logs/eh11-mutation-drill.sh`）。
 *
 * ## 扫描范围
 *
 * `apps/` 与 `packages/`（边界闭集 ①–⑥ 的产品源码），文件发现照
 * `scripts/check-architecture.mjs:9-19` 的自写递归 readdir，排除 `node_modules` / `dist` / `lib` / `out`，
 * 扩展名取同一份白名单（`.ts .tsx .js .jsx .mjs`）。`tests/` 与 `scripts/` 不在范围内：
 * 用例里的 `.catch(() => {})` 是桩，仓库工具不是产品边界。
 *
 * ## 已知的限制（如实记下）
 *
 * - 判据是**逐行文本 + 花括号配对**，不是语法树。**注释行不算命中**（行首是 `//`、`/*` 或 `*` 的行）：
 *   找不到失败可吞的注释不是违例，而仓库里确实有解释性注释在引用旧写法
 *   （`apps/web/src/app/windows/CharacterEditorWindow.jsx:125` 等三处）。
 *   行尾注释不单独剥离——剥离会把 URL 字符串后面的真命中一起吃掉，那是**漏报**，
 *   比把注释算进来更危险（实测现在没有这种行）。
 *   仓库现有的三个闸都是这个流派（`check-architecture.mjs` / `check-docs.mjs` 全是正则与文本扫描）。
 * - 命中集合按 `file` + `line` 冻结：任何命中行**上方**的改动都会让账本失配、闸变红。
 *   这是决定 11「多一条少一条都红」的直接后果——失效时必须显式删掉那一条。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')

/**
 * 豁免上限，冻结（ADR 0002 决定 11）。改动必须在 diff 里显式可见，并配一次突变演练。
 * 只减不增：删掉豁免时要把它一起下调；加一条豁免必须在这里显式加数字。
 */
export const MAX_EXEMPTIONS = 65

/** 账本路径（相对仓库根）。 */
export const LEDGER_PATH = 'scripts/error-contract-exemptions.json'

/** 契约的规范声明目录：它是规则 2 的判据来源，不是产出点。 */
const CONTRACT_DECLARATION_DIRECTORY = 'packages/product-shared/src/contracts/errors'

const SOURCE_ROOTS = ['apps', 'packages']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'lib', 'out'])

/** 规则 1：`new Error(<…>.error.message …)`（接收者与前面的 `throw` 都不作为条件）。 */
const CODE_DROP = /new\s+Error\s*\([^)]*\.error\??\.message/

/** 规则 3a：`.catch(() => {})`。 */
const EMPTY_PROMISE_CATCH = /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/

/** 规则 3b：空或仅注释的 `catch {}` / `catch (error) {}` 体。 */
const EMPTY_CATCH_BLOCK = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*|\/\*[^\n]*?\*\/\s*)*\}/

/** 规则 2：`code:` 位置上的契约符号或字面量。 */
const CODE_POSITION = /\bcode\s*:\s*(?:ELECKOI_FAILURE_CODES\.([A-Za-z_$][\w$]*)|(['"])([^'"]+)\2)/g

/** 契约声明的两条违例码的符号名（ADR 0002 决定 14）。 */
const DECLARED_CONTRACT_INVALID_SYMBOLS = new Set(['contractInvalidRequest', 'contractInvalidResponse'])

/** 同样两条的字面量。 */
const DECLARED_CONTRACT_INVALID_LITERALS = new Set([
  'eleckoi/contract/invalid-request',
  'eleckoi/contract/invalid-response'
])

/** 只是「像」契约违例码的前缀：用来抓打错的名字（未登记的违例码）。 */
const CONTRACT_INVALID_PREFIX = 'eleckoi/contract/invalid'

/** 规则 2 的形状判据：非空的 `issues` 数组 + 元素带 `path` 与 `message`。 */
const ISSUES_ARRAY = /issues\s*:\s*\[[^\]]*[^\]\s][^\]]*\]/
const ISSUE_ITEM = /\{\s*path\b[^}]*\bmessage\s*:|\{\s*message\s*:[^}]*\bpath\b/

/** 三条规则。`matches` 收到的是仓库相对路径（posix）与文件全文。 */
export const RULES = [
  {
    id: 'no-code-drop',
    ordinal: 1,
    title: '禁止丢码',
    criterion: "new Error(<…>.error.message …)：接收者通配，只留 message 的抛出",
    pattern: CODE_DROP,
    matches(file, text) {
      return lineHits(text, CODE_DROP)
    }
  },
  {
    id: 'contract-invalid-details',
    ordinal: 2,
    title: '契约违例必须给 eleckoi/contract/invalid-* 并把 issues 放进详情',
    criterion: 'code: 位置上的 contractInvalid{Request,Response}（或字面量）必须带结构完整的 issues',
    pattern: CODE_POSITION,
    skipDirectory: CONTRACT_DECLARATION_DIRECTORY,
    matches(file, text) {
      const found = []
      const hasIssuesArray = ISSUES_ARRAY.test(text)
      const hasIssueItem = ISSUE_ITEM.test(text)
      for (const match of text.matchAll(CODE_POSITION)) {
        const symbol = match[1]
        const literal = match[3]
        if (isCommentOnlyAt(text, match.index)) continue
        const line = lineAt(text, match.index)
        if (symbol !== undefined) {
          if (!symbol.startsWith('contractInvalid')) continue
          if (!DECLARED_CONTRACT_INVALID_SYMBOLS.has(symbol)) {
            found.push({ line, detail: `未登记的契约违例码 ELECKOI_FAILURE_CODES.${symbol}` })
            continue
          }
        } else {
          if (!literal.startsWith(CONTRACT_INVALID_PREFIX)) continue
          if (!DECLARED_CONTRACT_INVALID_LITERALS.has(literal)) {
            found.push({ line, detail: `未登记的契约违例码 '${literal}'` })
            continue
          }
        }
        const block = enclosingBraces(text, match.index)
        if (block === undefined) {
          found.push({ line, detail: '契约违例的 code: 不在任何对象字面量里，无法确认详情形状' })
          continue
        }
        if (!/\bissues\b/.test(text.slice(block.start, block.end + 1))) {
          found.push({ line, detail: '产出契约违例的对象字面量里没有 issues 详情' })
          continue
        }
        if (!hasIssuesArray || !hasIssueItem) {
          found.push({ line, detail: 'issues 必须是带 path 与 message 的非空数组（见 contracts/errors/details.ts）' })
        }
      }
      return found
    }
  },
  {
    id: 'empty-catch',
    ordinal: 3,
    title: '空 catch 必须有豁免声明',
    criterion: '.catch(() => {}) 与空/仅注释的 try{}catch{} 体',
    pattern: [EMPTY_PROMISE_CATCH, EMPTY_CATCH_BLOCK],
    matches(file, text) {
      const lines = new Map()
      for (const hit of lineHits(text, EMPTY_PROMISE_CATCH)) lines.set(hit.line, hit)
      for (const hit of lineHits(text, EMPTY_CATCH_BLOCK)) if (!lines.has(hit.line)) lines.set(hit.line, hit)
      return [...lines.values()].sort((left, right) => left.line - right.line)
    }
  }
]

/**
 * 逐行匹配一条正则以给出稳定行号。注释行不算命中（见文件头的已知限制）。
 * @param text - 文件全文。
 * @param pattern - 单行正则。
 * @returns 命中行（1 起算）与该行去掉首尾空白的原文。
 */
function lineHits(text, pattern) {
  const found = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (isCommentOnly(line)) continue
    if (pattern.test(line)) found.push({ line: index + 1, detail: line.trim() })
  }
  return found
}

/** @param line - 一行原文。 @returns 这一行是不是纯注释行。 */
function isCommentOnly(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
}

/**
 * 字符偏移处的整行是不是纯注释行。
 * @param text - 文件全文。
 * @param index - 匹配起点偏移。
 * @returns 是不是纯注释行。
 */
function isCommentOnlyAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  return isCommentOnly(text.slice(start, end < 0 ? text.length : end))
}

/**
 * 字符偏移 → 行号（1 起算）。规则 2 用的是带 `g` 标志的全局正则，只能自己算。
 * @param text - 文件全文。
 * @param index - 匹配起点偏移。
 * @returns 行号。
 */
function lineAt(text, index) {
  let line = 1
  for (let offset = 0; offset < index; offset += 1) if (text[offset] === '\n') line += 1
  return line
}

/**
 * 从偏移处向外找把它包住的最近一对花括号（文本配对，不解析字符串与注释——见文件头的已知限制）。
 * @param text - 文件全文。
 * @param index - 花括号内的某个偏移。
 * @returns 起始与结束偏移（含括号），或 undefined。
 */
function enclosingBraces(text, index) {
  let depth = 0
  let start = -1
  for (let offset = index; offset >= 0; offset -= 1) {
    if (text[offset] === '}') depth += 1
    else if (text[offset] === '{') {
      if (depth === 0) {
        start = offset
        break
      }
      depth -= 1
    }
  }
  if (start < 0) return undefined
  depth = 0
  for (let offset = start; offset < text.length; offset += 1) {
    if (text[offset] === '{') depth += 1
    else if (text[offset] === '}') {
      depth -= 1
      if (depth === 0) return { start, end: offset }
    }
  }
  return undefined
}

/**
 * 递归收集扫描范围里的源文件（照 `scripts/check-architecture.mjs:9-19`）。
 * @param scanRoot - 仓库根。
 * @returns 绝对路径数组（已排序）。
 */
export function collectSourceFiles(scanRoot) {
  const files = []
  for (const sourceRoot of SOURCE_ROOTS) collectInto(files, scanRoot, sourceRoot)
  return files.sort()
}

function collectInto(files, scanRoot, path) {
  const absolute = join(scanRoot, path)
  if (!existsSync(absolute)) return
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name)
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) collectInto(files, scanRoot, relative(scanRoot, child))
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(child)
  }
}

/**
 * 一个文件的命中（规则 1/2/3 一起算）。用例直接喂构造出来的样本，不必落盘。
 * @param file - 仓库相对路径（posix）。
 * @param text - 文件全文。
 * @returns `[{ rule, file, line, detail }]`。
 */
export function hitsForFile(file, text) {
  const hits = []
  for (const rule of RULES) {
    if (rule.skipDirectory && file.startsWith(rule.skipDirectory + '/')) continue
    for (const hit of rule.matches(file, text)) {
      hits.push({ rule: rule.id, file, line: hit.line, detail: hit.detail })
    }
  }
  return hits.sort(compareHits)
}

/**
 * 算出实际命中集合。
 * @param files - 绝对路径数组。
 * @param scanRoot - 仓库根（用来算相对路径）。
 * @returns `[{ rule, file, line, detail }]`。
 */
export function collectHits(files, scanRoot) {
  const hits = []
  for (const absolute of files) {
    const file = toPosix(relative(scanRoot, absolute))
    hits.push(...hitsForFile(file, readFileSync(absolute, 'utf8')))
  }
  return hits.sort(compareHits)
}

/** 账本与命中集合共用的排序：规则、文件、行。 */
function compareHits(left, right) {
  if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1
  if (left.file !== right.file) return left.file < right.file ? -1 : 1
  return left.line - right.line
}

function toPosix(value) {
  return value.split('\\').join('/')
}

/** 账本条目的键：规则 + 文件 + 行。 */
function hitKey(entry) {
  return `${entry.rule}|${entry.file}|${entry.line}`
}

/**
 * 读并校验账本。字段缺失、`rule` 不认识、`tracking` 指不到失效条件都算失败。
 * @param scanRoot - 仓库根。
 * @returns `{ exemptions, failures }`。
 */
export function loadLedger(scanRoot) {
  const failures = []
  const absolute = join(scanRoot, LEDGER_PATH)
  if (!existsSync(absolute)) {
    return { exemptions: [], failures: [`豁免账本不存在：${LEDGER_PATH}`] }
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    return { exemptions: [], failures: [`豁免账本不是合法 JSON：${LEDGER_PATH}（${error.message}）`] }
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.exemptions)) {
    return { exemptions: [], failures: [`豁免账本缺少 exemptions 数组：${LEDGER_PATH}`] }
  }
  const ruleIds = new Set(RULES.map((rule) => rule.id))
  const exemptions = []
  for (const [index, entry] of parsed.exemptions.entries()) {
    const where = `${LEDGER_PATH} 第 ${index + 1} 条`
    if (entry === null || typeof entry !== 'object') {
      failures.push(`${where} 不是对象`)
      continue
    }
    if (!ruleIds.has(entry.rule)) {
      failures.push(`${where} 的 rule 不是三条规则之一：${String(entry.rule)}`)
      continue
    }
    if (typeof entry.file !== 'string' || entry.file.length === 0 || entry.file.startsWith('/') || entry.file.includes('..')) {
      failures.push(`${where} 的 file 必须是仓库内相对路径：${String(entry.file)}`)
      continue
    }
    if (!Number.isInteger(entry.line) || entry.line < 1) {
      failures.push(`${where} 的 line 必须是正整数：${String(entry.line)}`)
      continue
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      failures.push(`${where} 缺少 reason：没有理由的豁免不许存在`)
      continue
    }
    const trackingFailure = validateTracking(scanRoot, entry.tracking)
    if (trackingFailure !== undefined) {
      failures.push(`${where} 的 tracking 不成立（${trackingFailure}）：${String(entry.tracking)}`)
      continue
    }
    exemptions.push({ rule: entry.rule, file: entry.file, line: entry.line, reason: entry.reason, tracking: entry.tracking })
  }
  const seen = new Set()
  for (const [index, entry] of exemptions.entries()) {
    const key = hitKey(entry)
    if (seen.has(key)) failures.push(`${LEDGER_PATH} 第 ${index + 1} 条重复登记：${key}`)
    seen.add(key)
  }
  return { exemptions, failures }
}

/**
 * `tracking` 必须指向 `docs/open-problems/` 的状态行或 ADR 的决定条目（ADR 0002 决定 11）。
 * @param scanRoot - 仓库根。
 * @param tracking - 账本里的失效条件落点。
 * @returns 失败原因，或 undefined 表示成立。
 */
export function validateTracking(scanRoot, tracking) {
  if (typeof tracking !== 'string') return '不是字符串'
  const openProblem = /^(docs\/open-problems\/[A-Za-z0-9._-]+\.md)\s+(.+)$/.exec(tracking)
  if (openProblem) return validateOpenProblemTracking(scanRoot, openProblem[1], openProblem[2])
  const adr = /^(docs\/adr\/(\d{4})-[A-Za-z0-9._-]+\.md)\s+决定\s+(\d+)$/.exec(tracking)
  if (adr) return validateAdrTracking(scanRoot, adr[1], adr[3])
  return '必须形如「docs/open-problems/<文件>.md <状态行指针>」或「docs/adr/<文件>.md 决定 <n>」'
}

function validateOpenProblemTracking(scanRoot, path, pointer) {
  const absolute = join(scanRoot, path)
  if (!existsSync(absolute)) return `${path} 不存在`
  const text = readFileSync(absolute, 'utf8')
  if (!text.includes('**状态：')) return `${path} 没有「**状态：」行——没有失效条件的豁免不许存在`
  const pointerText = pointer.trim()
  // 裸「状态行」不是指针：它不指向任何一条失效条件，任何豁免都能靠它过（EH-11 的 J 项收紧）。
  // 「失效条件」是机器判据（ADR 决定 11），不许退化成"文档里有个状态行就算数"。
  if (pointerText === '状态行') {
    return '状态行指针不许只写「状态行」：它不指向任何失效条件，任何豁免都能靠它过'
  }
  if (!text.includes(pointerText)) return `${path} 里找不到状态行指针「${pointerText}」`
  return undefined
}

function validateAdrTracking(scanRoot, path, decision) {
  const absolute = join(scanRoot, path)
  if (!existsSync(absolute)) return `${path} 不存在`
  const text = readFileSync(absolute, 'utf8')
  if (!new RegExp('^' + decision + '\\. ', 'm').test(text)) return `${path} 里没有决定 ${decision} 这一条`
  return undefined
}

/**
 * 对账：命中集合、账本集合、冻结上限。用例直接喂构造出来的命中与账本。
 * @param hits - `[{ rule, file, line, detail }]`。
 * @param exemptions - `[{ rule, file, line, reason, tracking }]`。
 * @param maxExemptions - 冻结上限。
 * @returns 失败说明数组（空数组 = 通过）。
 */
export function reconcile(hits, exemptions, maxExemptions) {
  const failures = []
  if (exemptions.length > maxExemptions) {
    failures.push(`豁免账本 ${exemptions.length} 条 > MAX_EXEMPTIONS ${maxExemptions}：账本只减不增，加一条豁免必须同时显式改这个冻结数字`)
  }
  const ledgerKeys = new Set(exemptions.map(hitKey))
  const hitKeys = new Set(hits.map(hitKey))
  for (const hit of hits) {
    if (!ledgerKeys.has(hitKey(hit))) {
      failures.push(`${hit.file}:${hit.line} 命中规则「${ruleTitle(hit.rule)}」但账本里没有登记——${hit.detail}`)
    }
  }
  for (const entry of exemptions) {
    if (!hitKeys.has(hitKey(entry))) {
      failures.push(`账本里的豁免已失效（实际没有命中）：${entry.rule} ${entry.file}:${entry.line}——命中集合变小是好事，但要显式删掉这一条并下调 MAX_EXEMPTIONS`)
    }
  }
  return failures
}

/**
 * 跑一次闸：算命中、读账本、对账。
 * @param scanRoot - 仓库根。
 * @returns `{ failures, hits, exemptions, sourceFiles }`。
 */
export function checkErrorContract(scanRoot = root) {
  const files = collectSourceFiles(scanRoot)
  const hits = collectHits(files, scanRoot)
  const ledger = loadLedger(scanRoot)
  const failures = [...ledger.failures, ...reconcile(hits, ledger.exemptions, MAX_EXEMPTIONS)]
  return { failures, hits, exemptions: ledger.exemptions, sourceFiles: files.length }
}

function ruleTitle(id) {
  const rule = RULES.find((candidate) => candidate.id === id)
  return rule === undefined ? id : rule.title
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkErrorContract(root)
  if (result.failures.length > 0) {
    console.error(result.failures.map((failure) => `- ${failure}`).join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Error contract check passed: ${result.sourceFiles} source files, ${result.hits.length} hits all registered, MAX_EXEMPTIONS=${MAX_EXEMPTIONS}.`)
  }
}
