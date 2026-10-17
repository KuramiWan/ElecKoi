#!/usr/bin/env node
/**
 * 错误合约闸 `check:error-contract`。
 *
 * 判据来源：错误处理设计 §四「怎么算做对了」第 2、3 条 + §五「所以该改的不是代码，是声明方式」。
 *
 * ## 四条规则
 *
 * 1. **禁止丢码**（绝对值）：`new Error(<…>.error.message …)` —— 宿主已经把带码的失败交出来了，
 *    调用方却把它压成一句话。这是本线要消灭的核心形状。
 * 2. **契约违例必须带 `issues`**（绝对值）：`code: ELECKOI_FAILURE_CODES.contractInvalid*` 的对象字面量
 *    里必须有结构完整的 `issues`（契约规定这两条码的详情形状）。
 * 3. **空 catch 必须写成具名声明**（绝对值）：`.catch(() => {})` 与空的 / 只有注释的 `catch {}` 一律红；
 *    允许的形式是三个具名回调（`failureAlreadyPublished` / `rejectionIsAwaitedElsewhere` / `bestEffort`），
 *    或者任何**非空**的处理体（例如 `.catch(error => reportFailure(...))`）。
 *    见 `packages/shared/src/foundation/swallowedFailure.ts` 的语义表。
 * 4. **不许裸抛**（P5 期间是计数，`--strict` 才判失败）：领域 / 宿主 / 客户端插件层的 `throw new Error(`
 *    必须改成带契约码的形式（`throw new DesktopError(ELECKOI_FAILURE_CODES.…, …)`）。
 *    这条是 P5 的进度尺：数字必须逐批下降，末期归零后去掉 `--strict` 变成绝对值。
 *
 * ## 不扫什么
 *
 * - `**\/assets/**`：随包分发的第三方浏览器库（lodash / pixi / pdf worker …），不是我们的代码；
 * - `**\/tests/**`、`packages/examples/**`、`scripts/**`：测试用的桩与仓库工具，不参与产品错误语义。
 *
 * ## 已知限制（诚实说明）
 *
 * 规则 1 只认**显式**的 `.error.message`。`if (!result.ok) throw new Error('泛化句')` 这种
 * 把整个失败信封丢掉的写法看不出码，本闸抓不到——它由规则 4（裸抛必须带码）在 P5 收口，
 * 以及 review 兜底。不要为了"抓得更全"把规则 1 的正则放宽成 `if (!x.ok) throw`：
 * `if (!response.ok) throw` 是**HTTP** 的 `ok`，那张网会把正常代码也判红。
 *
 * 用法：
 *   node scripts/check-error-contract.mjs            # 规则 1–3 绝对值，规则 4 只报数
 *   node scripts/check-error-contract.mjs --strict   # 规则 4 也判失败（P5 收口后默认）
 *   node scripts/check-error-contract.mjs --json     # 机器可读摘要
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/** 扫哪些目录（仓库相对路径前缀）。 */
const SCAN_ROOTS = [
  'apps/desktop/src/',
  'apps/desktop-host/src/',
  'apps/android-host/src/',
  'apps/web/src/',
  'packages/host/',
  'packages/client/',
  'packages/shared/src/'
]

/** 这些路径不参与扫描（第三方随包资源、测试、仓库工具）。 */
const EXCLUDED = [
  '/assets/',
  '/tests/',
  'packages/examples/',
  '/node_modules/',
  '/lib/',
  '/dist/',
  '/out/'
]

/** 契约声明的规范目录：那里是规则表，不是失败构造点（规则 2 跳过它）。 */
const CONTRACT_DECLARATION_DIRECTORY = 'packages/shared/src/contracts/errors/'

/** 只扫这些扩展名。 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/** 规则 1：把带码的失败压成一句话。 */
const CODE_DROP = /new\s+Error\s*\([^)]*\.error\??\.message/

/** 规则 2：`code:` 位置上的契约违例码。 */
const CONTRACT_INVALID_CODE = /\bcode\s*:\s*(?:ELECKOI_FAILURE_CODES\.(contractInvalid[A-Za-z_$]*)|(['"])(eleckoi\/contract\/invalid-[a-z-]+)\2)/

/** 规则 2 的形状判据：非空 issues 数组 + 元素带 path 与 message。 */
const ISSUES_ARRAY = /issues\s*:\s*\[[^\]]*[^\]\s][^\]]*\]/
const ISSUE_ITEM = /\{\s*path\b[^}]*\bmessage\s*:|\{\s*message\s*:[^}]*\bpath\b/

/** 契约违例的两条合法码（符号名与字面量都要认）。 */
const CONTRACT_INVALID_SYMBOLS = new Set(['contractInvalidRequest', 'contractInvalidResponse'])
const CONTRACT_INVALID_LITERALS = new Set(['eleckoi/contract/invalid-request', 'eleckoi/contract/invalid-response'])
const CONTRACT_INVALID_PREFIX = 'eleckoi/contract/invalid'

/** 规则 3a：`.catch(() => {})` 及同族的空箭头体。 */
const EMPTY_PROMISE_CATCH = /\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}\s*\)/

/** 规则 3b：空的 / 只有注释的 `catch {}` / `catch (error) {}` 体。 */
const EMPTY_CATCH_BLOCK = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*|\/\*[^\n]*?\*\/\s*)*\}/

/** 规则 4：裸抛。 */
const BARE_THROW = /\bthrow\s+new\s+Error\s*\(/

/** 规则 3 允许的三个具名声明（`.catch(name)` 是唯一"不看处理体"就放行的形式）。 */
const SWALLOW_DECLARATIONS = ['failureAlreadyPublished', 'rejectionIsAwaitedElsewhere', 'bestEffort']

/**
 * 是不是纯注释行（规则只看代码行）。
 * @param {string} line - 一行源码。
 * @returns {boolean} 是注释行时为 true。
 */
function isCommentLine(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

/**
 * 列出仓库里要扫的文件（用 git ls-files，避免把 node_modules 与构建产物扫进来）。
 * @returns {string[]} 仓库相对路径。
 */
function scanFiles() {
  const listed = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  return listed.filter((file) => {
    if (!SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension))) return false
    if (!SCAN_ROOTS.some((root) => file.startsWith(root))) return false
    return !EXCLUDED.some((part) => file.includes(part))
  })
}

/**
 * 逐行跑规则 1/3/4（这三条只看单行），规则 2 看整个文件。
 * @param {string[]} files - 仓库相对路径列表。
 * @returns {{ hits: Array<{rule: string, file: string, line: number, detail: string}>, files: number }} 命中与文件数。
 */
function inspect(files) {
  const hits = []
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    const hasIssuesArray = ISSUES_ARRAY.test(text)
    const hasIssueItem = ISSUE_ITEM.test(text)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (isCommentLine(line)) continue
      if (CODE_DROP.test(line)) hits.push({ rule: 'no-code-drop', file, line: index + 1, detail: line.trim() })
      if (EMPTY_PROMISE_CATCH.test(line)) hits.push({ rule: 'empty-catch', file, line: index + 1, detail: line.trim() })
      if (EMPTY_CATCH_BLOCK.test(line)) hits.push({ rule: 'empty-catch', file, line: index + 1, detail: line.trim() })
      if (BARE_THROW.test(line)) hits.push({ rule: 'bare-throw', file, line: index + 1, detail: line.trim() })
      const contract = file.startsWith(CONTRACT_DECLARATION_DIRECTORY) ? null : CONTRACT_INVALID_CODE.exec(line)
      if (contract !== null) {
        const symbol = contract[1]
        const literal = contract[3]
        const registered = symbol !== undefined
          ? CONTRACT_INVALID_SYMBOLS.has(symbol)
          : CONTRACT_INVALID_LITERALS.has(literal)
        if (!registered) {
          hits.push({ rule: 'contract-issues', file, line: index + 1, detail: `未登记的契约违例码：${symbol ?? literal}` })
        } else if (!hasIssuesArray || !hasIssueItem) {
          hits.push({ rule: 'contract-issues', file, line: index + 1, detail: '契约违例的详情必须是带 path 与 message 的非空 issues 数组' })
        }
      }
    }
  }
  return { hits, files: files.length }
}

/**
 * 规则 3 的放行判据：`.catch(name)` 里的 name 在三个允许的名字里。
 * 规则 3 只把**空处理体**判红，非空的处理体（如 `.catch(error => reportFailure(...))`）不算命中，
 * 所以这里只用于报告时区分"用名字声明的"与"根本没命中"的条数。
 * @param {string} line - 一行源码。
 * @returns {boolean} 是不是具名声明。
 */
export function isNamedDeclaration(line) {
  return SWALLOW_DECLARATIONS.some((name) => new RegExp(`\\.catch\\(\\s*${name}\\s*\\)`).test(line))
}

function main() {
  const strict = process.argv.includes('--strict')
  const json = process.argv.includes('--json')
  const files = scanFiles()
  const { hits } = inspect(files)
  const byRule = new Map()
  for (const hit of hits) {
    const list = byRule.get(hit.rule) ?? []
    list.push(hit)
    byRule.set(hit.rule, list)
  }
  const absoluteRules = ['no-code-drop', 'contract-issues', 'empty-catch']
  const failing = []
  for (const rule of absoluteRules) {
    const list = byRule.get(rule) ?? []
    if (list.length > 0) failing.push({ rule, hits: list })
  }
  const bareThrows = byRule.get('bare-throw') ?? []
  if (strict && bareThrows.length > 0) failing.push({ rule: 'bare-throw', hits: bareThrows })

  if (json) {
    console.log(JSON.stringify({
      sourceFiles: files.length,
      counts: Object.fromEntries([...byRule].map(([rule, list]) => [rule, list.length])),
      failures: failing.map((entry) => ({ rule: entry.rule, count: entry.hits.length }))
    }, null, 2))
  } else {
    console.log(`扫了 ${files.length} 个源文件。`)
    console.log(`规则 1 禁止丢码：${(byRule.get('no-code-drop') ?? []).length} 处`)
    console.log(`规则 2 契约违例详情：${(byRule.get('contract-issues') ?? []).length} 处`)
    console.log(`规则 3 空 catch：${(byRule.get('empty-catch') ?? []).length} 处`)
    console.log(`规则 4 裸抛（${strict ? '绝对值' : '进度，--strict 才判失败'}）：${bareThrows.length} 处`)
    for (const entry of failing) {
      console.log(`\n✗ 规则「${ruleTitle(entry.rule)}」命中 ${entry.hits.length} 处：`)
      for (const hit of entry.hits.slice(0, 40)) console.log(`  ${hit.file}:${hit.line}  ${hit.detail}`)
      if (entry.hits.length > 40) console.log(`  …还有 ${entry.hits.length - 40} 处`)
    }
  }
  if (failing.length > 0) {
    if (!json) console.log(`\nError contract check FAILED（${failing.map((entry) => entry.rule).join(', ')}）。`)
    process.exitCode = 1
    return
  }
  if (!json) console.log('\nError contract check passed.')
}

/**
 * 规则 id → 中文标题（报告用）。
 * @param {string} id - 规则 id。
 * @returns {string} 标题。
 */
function ruleTitle(id) {
  if (id === 'no-code-drop') return '禁止丢码'
  if (id === 'contract-issues') return '契约违例必须带 issues'
  if (id === 'empty-catch') return '空 catch 必须写成具名声明'
  return '不许裸抛（领域 / 宿主 / 客户端插件层）'
}

main()
