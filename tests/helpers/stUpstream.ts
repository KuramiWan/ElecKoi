/**
 * 【酒馆上游的行级证据】——本机整份副本（可选）与仓库内摘录（`tests/fixtures/st-upstream/excerpts.json`）。
 *
 * 背景（2026-10-07 独立评估 P0-1）：文档/清单里 28 行"酒馆侧引用"原先只能对着**作者机器**上的
 * `wi.js` 与 `.st-upstream/` 核对，两样都不进仓库 ⇒ 干净检出（CI）上引用闸 `ENOENT`、"闸在空转"
 * 又必然失败、manifest 每行的 `stReference` + `stSnippet` 更是零消费者。修法是把**被引用的那几行**
 * 摘进仓库；本文件是读摘录的唯一入口，也是"本机有没有整份副本"的唯一判定处。
 *
 * 两种数据面，别混用：
 *   - `stSourceLines(name)`：**行级**核对用。优先本机整份副本，其次仓库内摘录（稀疏行数组，行号是真行号、
 *     没摘的行是空洞）。行级断言（`file:NNNN` 那一行必须含某段原文）在任何机器上都能跑。
 *   - `stFullLines(name)`：**全文**反证用（"全文 0 命中 use_regex"、`getwi` 只出现 1 次、总行数）。
 *     只有本机有整份副本时才有值——拿摘录去数"全文出现次数"是**假绿**（缺的行会被当成"没有"）。
 *
 * ⚠️ 摘录能证明的只有"**这份摘录里**第 N 行是这段原文"，不等于"上游 HEAD 的第 N 行还是它"。
 * 后者要整份副本；`scripts/generate-st-excerpts.mjs --check` 在有副本时会顺手核对新鲜度。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** 仓库根（本文件在 `tests/helpers/` 下） */
export const repoRoot = join(here, '..', '..')

/** 摘录来源的上游版本：与 `.redgreen/55` 的取证记录同一批 */
export const ST_PROVENANCE = {
  project: 'SillyTavern',
  url: 'https://github.com/SillyTavern/SillyTavern',
  version: 'v1.19.0',
  commit: '06bde939fb1e9c4c8d8641d810f0a916b5bce127',
  license: 'AGPL-3.0'
}

/**
 * 每个"引用文件名"从哪儿来：
 *   - `origin`：上游仓库里的路径（写进摘录产物）；
 *   - `env`：本机副本的环境变量。**给了就是权威、没有回退**，所以"CI 上没有副本"能被真的模拟出来；
 *   - `local`：没有环境变量时的默认位置，相对**仓库上一级**（本工作区是 `/home/camel/travern/`）；
 *   - `vendored`：仓库里有没有它的摘录。`false` 的（ST 的默认设置档）**只登记、不核对**，
 *     由闸显式列出，不许静默消失。
 */
export const ST_SOURCES: Record<string, { origin: string; env: string; local: string; dir: boolean; vendored?: false; reason?: string }> = {
  'wi.js': { origin: 'public/scripts/world-info.js', env: 'ELECKOI_WI_JS', local: 'wi.js', dir: false },
  'characters.js': { origin: 'src/endpoints/characters.js', env: 'ELECKOI_ST_UPSTREAM', local: '.st-upstream', dir: true },
  'script.js': { origin: 'public/script.js', env: 'ELECKOI_ST_UPSTREAM', local: '.st-upstream', dir: true },
  'openai.js': { origin: 'public/scripts/openai.js', env: 'ELECKOI_ST_UPSTREAM', local: '.st-upstream', dir: true },
  'power-user.js': { origin: 'public/scripts/power-user.js', env: 'ELECKOI_ST_UPSTREAM', local: '.st-upstream', dir: true },
  'PromptManager.js': { origin: 'public/scripts/PromptManager.js', env: 'ELECKOI_ST_UPSTREAM', local: '.st-upstream', dir: true },
  'settings.json': {
    origin: 'default/content/settings.json',
    env: 'ELECKOI_ST_UPSTREAM',
    local: '.st-upstream',
    dir: true,
    vendored: false,
    reason: 'ST 的默认设置档：本机副本只取了 7 个 .js，没有它 ⇒ 只登记引用、不核对（`docTokens.CITATIONS` 也这么写的）'
  }
}

/** 这个文件在仓库里有没有摘录（`settings.json` 没有 ⇒ 它的引用只能靠本机副本或人工） */
export function stIsVendored(name: string): boolean {
  return ST_SOURCES[name]?.vendored !== false && Boolean(stExcerpts().sources[name])
}

/** 明确声明"有引用但没摘录"的文件（它们的引用**不会被核对**，所以必须显式列出来，不许静默消失） */
export function stNotVendored(): string[] {
  return Object.entries(ST_SOURCES).filter(([, source]) => source.vendored === false).map(([name]) => name)
}

/**
 * 同一个上游文件在文档里有两种写法：`wi.js`（工作区里那份副本的名字，`wi.js:5632` 这类引用）与
 * `world-info.js`（它在 ST 仓库里的真名，清单里 `extensions.world` 那行用的写法）。指同一个文件。
 */
export const ST_ALIASES: Record<string, string> = { 'world-info.js': 'wi.js' }

/** 引用里的文件名 → 摘录来源名（消别名） */
export function stSourceName(name: string): string {
  return ST_ALIASES[name] ?? name
}

/** 摘录产物路径（生成器与闸读同一处） */
export const ST_EXCERPTS = join(here, '..', 'fixtures', 'st-upstream', 'excerpts.json')

export interface StExcerptSource {
  /** 上游仓库里的路径：`wi.js` 是 `public/scripts/world-info.js` … */
  origin: string
  /** 摘录时上游文件的总行数：引用指到"文件里不存在的行"这类错要能在离线状态下被发现 */
  lineCount: number
  /** 行号（字符串键）→ 该行原文；**只有被引用的行**，缺的行不存在 */
  lines: Record<string, string>
}

export interface StExcerpts {
  schemaVersion: number
  provenance: typeof ST_PROVENANCE
  sources: Record<string, StExcerptSource>
}

let excerptCache: StExcerpts | undefined

/** 读仓库内的摘录（只读一次） */
export function stExcerpts(): StExcerpts {
  excerptCache ??= JSON.parse(readFileSync(ST_EXCERPTS, 'utf8')) as StExcerpts
  return excerptCache
}

/**
 * 本机整份副本的路径；没有就 undefined。
 * ⚠️ `ELECKOI_WI_JS` / `ELECKOI_ST_UPSTREAM` 一旦给出就是权威（不回退到默认位置），
 * 所以"路径写错"与"文件不存在"都表现为 undefined——这是已知的弱化点，换来的是"能在 CI 上模拟缺席"。
 */
export function stLocalFile(name: string): string | undefined {
  const source = ST_SOURCES[name]
  if (!source) return undefined
  const env = source.env ? process.env[source.env]?.trim() : ''
  if (env) {
    const candidate = source.dir ? join(env, source.origin.split('/').pop() as string) : env
    return existsSync(candidate) ? candidate : undefined
  }
  const candidate = source.dir
    ? join(repoRoot, '..', source.local, source.origin.split('/').pop() as string)
    : join(repoRoot, '..', source.local)
  return existsSync(candidate) ? candidate : undefined
}

/** 本机整份副本的行（`\r\n` 已归一）；没有副本就是 undefined */
export function stFullLines(name: string): string[] | undefined {
  const file = stLocalFile(name)
  return file ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n') : undefined
}

/** 摘录还原成的**稀疏行数组**：下标是真实行号 - 1，没摘的行是空洞（不是空字符串） */
export function stExcerptLines(name: string): string[] | undefined {
  const source = stExcerpts().sources[name]
  if (!source) return undefined
  const numbers = Object.keys(source.lines).map(Number)
  if (!numbers.length) return undefined
  const lines = new Array<string>(Math.max(...numbers))
  for (const number of numbers) lines[number - 1] = source.lines[String(number)] as string
  return lines
}

/** 行级核对用：本机整份副本优先，其次仓库内摘录 */
export function stSourceLines(name: string): string[] | undefined {
  return stFullLines(name) ?? stExcerptLines(name)
}

/**
 * 摘录记下的上游文件总行数（本机有整份副本时以副本为准）。
 * ⚠️ 用它只能判断"引用没指到文件外"，判断不了"那一行还是原来那句"——后者要摘录/副本本身。
 */
export function stLineCount(name: string): number | undefined {
  return stFullLines(name)?.length ?? stExcerpts().sources[name]?.lineCount
}

/** 某个引用文件当前的行来源（报告/自查用） */
export function stSourceKind(name: string): 'local' | 'excerpt' | 'missing' {
  if (stLocalFile(name)) return 'local'
  return stExcerpts().sources[name] ? 'excerpt' : 'missing'
}

/** `src/endpoints/characters.js:504-551` / `wi.js:5632, 4801` / `:551` → [[504, 551]] / [[5632, 5632], [4801, 4801]] */
export function refRanges(ref: string): [number, number][] {
  const tail = ref.slice(ref.indexOf(':') + 1)
  return [...tail.matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)].map((match) => {
    const first = Number(match[1])
    return [first, match[2] ? Number(match[2]) : first] as [number, number]
  })
}

/** `src/endpoints/characters.js:504` → `characters.js`；`:551` 与 `1127-1128`（延续段）没有文件名 → undefined */
export function refFileName(ref: string): string | undefined {
  const colon = ref.indexOf(':')
  if (colon < 0) return undefined
  const head = ref.slice(0, colon)
  return head ? head.split('/').pop() : undefined
}

/**
 * 一条 `stReference` 可能挂着**多个文件**、带版本前缀、用 `;` 分隔，例如
 * `ST v1.19.0 script.js:3413-3417; openai.js:1492-1498; power-user.js:203; default/content/settings.json:146`。
 * 这里拆成单文件引用（去掉 `ST v1.19.0 ` 前缀），供生成器与闸共用。
 */
export function refParts(reference: string): string[] {
  return reference
    .split(';')
    .map((part) => part.trim().replace(/^ST\s+v[\d.]+\s+/, ''))
    .filter(Boolean)
}
