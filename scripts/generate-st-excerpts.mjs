/**
 * 生成/核对 `tests/fixtures/st-upstream/excerpts.json`——**酒馆（SillyTavern）上游被引用行的摘录**。
 *
 * 为什么要有这个文件（2026-10-07 独立评估 P0-1）：
 *   文档与清单里那 28 行"酒馆侧引用"（`wi.js:5632` 这类 `文件:行号` + 一行摘录）原先只有**作者机器**上
 *   的 `wi.js` 与 `.st-upstream/` 能核对，两样都**不进仓库**。于是：
 *     ① `tests/tavern-docs-generated.test.ts` 的引用闸在干净检出上直接 `ENOENT`（CI 必红）；
 *     ② 就算补了 try/catch，`checked === 0` 的"闸在空转必须失败"仍会红；
 *     ③ 清单里 manifest 每行的 `stReference` + `stSnippet` **完全没有消费者**——写错了没人知道。
 *   修法是把"被引用的那几行"摘进仓库（几十行，不是整份上游文件），让上面三件事在任何机器上都能真核对。
 *   摘录**只增不减**：新写一条引用，`pnpm check:st-excerpts` 会要求把那一行也摘进来。
 *
 * 边界（必须诚实）：
 *   - 摘录证明的是"**这份摘录里**第 N 行确实是这段原文"，**不等于**"上游 HEAD 的第 N 行还是它"。
 *     后者要真的上游副本：本文件在检测到本机有副本时会顺手核对新鲜度（不一致就报错）。
 *   - 摘录是**摘录**：只有被引用的行，行号靠 JSON 的键保留，缺的行是空洞（不是空字符串）——所以
 *     "全文出现次数"这类反证**不能**用摘录做（见 `tests/helpers/stUpstream.ts` 顶部的说明）。
 *   - 该文件是第三方源码的**节选**（SillyTavern, AGPL-3.0）；来源与版本记在产物与
 *     `tests/fixtures/st-upstream/README.md` 里。
 *
 * 用法：
 *   pnpm generate:st-excerpts     # 写盘（需要本机有上游副本：wi.js / .st-upstream）
 *   pnpm check:st-excerpts        # 只核对（离线可跑，进 pnpm build）
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ST_EXCERPTS,
  ST_PROVENANCE,
  ST_SOURCES,
  refFileName,
  refParts,
  refRanges,
  stFullLines,
  stLocalFile,
  stSourceName
} from '../tests/helpers/stUpstream.ts'

/** 单条引用允许覆盖的最大行数 / 全部摘录允许的最大行数：写错一个范围就在生成期炸，而不是产出巨型夹具 */
const MAX_RANGE = 120
const MAX_TOTAL = 4000

/** 没有摘录的文件（`ST_SOURCES` 里标了 `vendored: false`）的引用一律跳过核对，但会被显式列出来 */
const isVendored = (file) => ST_SOURCES[file]?.vendored !== false

/**
 * 把所有声明"酒馆侧依据"的地方收集成一张表。
 * 每条记录是 `{ group, file, ref, snippet, from }`：**同一 group 共享一条摘录**，
 * 因为一条 `stReference` 可能挂多个文件（如 `script.js:3413-3417; openai.js:1492-1498; …`），
 * 而 `stSnippet` 是"这段原文在这一组引用的某一行上"。
 */
export async function collectStReferences(root) {
  const records = []
  const add = (group, file, ref, snippet, from, literal = true) => {
    if (!ref) return
    const name = stSourceName(file ?? refFileName(ref) ?? '')
    if (!name) throw new Error(`${from} 的引用「${ref}」里既没有文件名，也没登记来源`)
    if (!ST_SOURCES[name]) throw new Error(`${from} 引用了没登记来源的文件「${name}」（${ref}）：请在 ST_SOURCES 里补一行`)
    records.push({ group, file: name, ref, snippet, from, literal })
  }
  /** 一条引用串可能带版本前缀、多个文件、分号分隔；拆开逐条记，共用同一个 group 与 snippet */
  const addReference = (group, reference, snippet, from, file, literal = true) => {
    // 分号段可能**不带文件名**（`world-info.js:4481-4483; 1127-1128` 的后半段是延续）⇒ 继承前一段。
    let current = file
    for (const part of refParts(reference)) {
      const named = refFileName(part)
      if (named) current = named
      add(group, current, part, snippet, from, literal)
    }
  }

  const docs = await import(join(root, 'tests/fixtures/tavern-docs/docTokens.ts'))
  for (const [id, citation] of Object.entries(docs.CITATIONS)) {
    // 登记表里混着**电子爱自己**的两条引用，id 以 `eleckoi.` 开头（同一约定见 `PATHS`）：
    // 它们不进酒馆摘录，由各自的导入/锚点闸看着（比如 `tavern-world-file.test.js` 的 TOOL_CITATIONS）。
    if (id.startsWith('eleckoi.')) continue
    addReference(`docTokens.CITATIONS.${id}`, citation.ref, citation.snippet, `docTokens.CITATIONS.${id}`, citation.wi ? 'wi.js' : citation.upstream)
  }

  const semantic = await import(join(root, 'tests/helpers/tavernStEvidenceTable.ts'))
  for (const evidence of semantic.SEMANTIC_EVIDENCE) {
    if (evidence.basis.kind !== 'st') continue
    for (const citation of evidence.basis.citations) {
      add(`tavernStEvidence:${evidence.title}:${citation.ref}`, 'wi.js', citation.ref, citation.snippet, `tavernStEvidence:${evidence.title}`)
    }
  }

  const worldTarget = await import(join(root, 'tests/helpers/tavernWorldFileTargetEvidence.ts'))
  for (const item of worldTarget.setWorldInfo) {
    for (const citation of item.citations) {
      add(`tavernWorldFileTargetEvidence:${item.title}:${citation.ref}`, 'wi.js', citation.ref, citation.snippet, `tavernWorldFileTargetEvidence:${item.title}`)
    }
  }

  const anchors = await import(join(root, 'tests/helpers/tavernWiAnchors.ts'))
  for (const [line, snippet] of Object.entries(anchors.ST_CITATIONS)) {
    add(`tavernWiAnchors.ST_CITATIONS:${line}`, 'wi.js', `wi.js:${line}`, snippet, 'tavernWiAnchors.ST_CITATIONS')
  }

  for (const [label, fields] of [
    ['tavernCardFields', (await import(join(root, 'tests/helpers/tavernCardFieldManifest.ts'))).tavernCardFields],
    ['worldFields', (await import(join(root, 'tests/helpers/tavernWorldFieldManifest.ts'))).worldFields]
  ]) {
    for (const field of fields) {
      if (!field.stReference) continue
      // 清单里的 `stSnippet` 是**缩写**（接口注明"≤80 字符，行号漂移后用于检索回定位"）：实测它会把
      // `entry.extensions?.X` 写成 `extensions.X`、把 `world_info_position.before` 写成 `0`、用 `...` 省略尾部，
      // 所以这几行只能核"引用的行都在摘录里、且没指到文件外"，**不能**核逐字包含。
      // 逐字核对留给另外四个**真的逐字**的来源：docTokens.CITATIONS / tavernStEvidence /
      // tavernWorldFileTargetEvidence / tavernWiAnchors（它们是把断言钉死的那批）。
      addReference(`${label}:${field.path}`, field.stReference, field.stSnippet, `${label}:${field.path}`, undefined, false)
    }
  }

  return records
}

/** 本机副本 → `文件 → { 行号 → 原文 }`；缺副本的文件记在 `missing` 里由调用方报错 */
function excerptFromLocal(records) {
  const lines = {}
  const full = {}
  const missing = new Set()
  for (const { file, ref } of records) {
    if (!isVendored(file)) continue
    if (!(file in lines)) {
      const text = stFullLines(file)
      if (!text) {
        missing.add(file)
        continue
      }
      lines[file] = {}
      full[file] = text
    }
    if (!(file in lines)) continue
    for (const [first, last] of refRanges(ref)) {
      if (last - first + 1 > MAX_RANGE) throw new Error(`${ref} 一次引用 ${last - first + 1} 行，超过 ${MAX_RANGE} 行的上限（范围是不是写错了？）`)
      for (let line = first; line <= last; line += 1) {
        if (full[file][line - 1] === undefined) throw new Error(`${ref} 指到了 ${file} 里不存在的第 ${line} 行（该文件共 ${full[file].length} 行）`)
        lines[file][line] = full[file][line - 1]
      }
    }
  }
  return { lines, missing: [...missing] }
}

/**
 * 摘录里每个 group 的引用行是否都在、且 `snippet` 真的出现在其中一行（这是**离线**能做的全部核对）。
 * 没有摘录的文件（`settings.json`）不进核对，但会被列进 `unvendored`。
 */
export function checkRecords(records, sources) {
  const problems = []
  const unvendored = new Set()
  const groups = new Map()
  for (const record of records) {
    if (!isVendored(record.file)) {
      unvendored.add(record.file)
      continue
    }
    const key = record.group ?? record.ref
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  for (const [group, items] of groups) {
    const located = []
    const absent = []
    const beyond = []
    for (const { file, ref } of items) {
      const lines = sources[file]?.lines ?? {}
      const lineCount = sources[file]?.lineCount
      for (const [first, last] of refRanges(ref)) {
        if (lineCount !== undefined && last > lineCount) beyond.push(`${file}:${last}（该文件共 ${lineCount} 行）`)
        for (let line = first; line <= last; line += 1) {
          if (lines[line] === undefined) absent.push(`${file}:${line}`)
          else located.push([`${file}:${line}`, lines[line]])
        }
      }
    }
    const from = items[0]?.from ?? group
    const refs = items.map((item) => item.ref).join(' / ')
    if (beyond.length) problems.push(`引用指到了文件外：${beyond.join('、')}（${from} 的 ${refs}）`)
    if (absent.length) {
      problems.push(`摘录缺行：${absent.join('、')}（${from} 的 ${refs}）——重新跑 pnpm generate:st-excerpts，或手工把这几行补进 excerpts.json`)
      continue
    }
    const literal = items.some((item) => item.literal)
    // 一条引用可以登记**多条**摘录（`snippet: string[]`）：多目标引用（如 `3440/3445/3451` 三个顶层读取点）
    // 每条都要在引用行的并集里就位——只登记一条会漏掉另外两行（第一版就是这么漏的）。
    const snippets = items.flatMap((item) => Array.isArray(item.snippet) ? item.snippet : item.snippet ? [item.snippet] : [])
    if (literal) {
      for (const snippet of snippets) {
        if (!located.some(([, text]) => text.includes(snippet))) {
          problems.push(`${refs} 里找不到摘录「${snippet}」（${from}）——要么改引用，要么改摘录`)
        }
      }
    }
  }
  return { problems, unvendored: [...unvendored].sort() }
}

export async function generateStExcerpts(root, { check = false } = {}) {
  const records = await collectStReferences(root)

  if (check) {
    const current = JSON.parse(await readFile(ST_EXCERPTS, 'utf8'))
    const { problems, unvendored } = checkRecords(records, current.sources ?? {})
    const failures = [...problems]
    // 本机有上游副本时，顺手核对"摘录与上游副本是否一致"（没有副本就只做离线那半，并在返回值里说明）。
    let fresh = 0
    for (const file of Object.keys(ST_SOURCES)) {
      if (!isVendored(file) || !stLocalFile(file)) continue
      fresh += 1
      const full = stFullLines(file) ?? []
      for (const [line, value] of Object.entries(current.sources?.[file]?.lines ?? {})) {
        if (full[Number(line) - 1] !== value) {
          failures.push(`${file}:${line} 的摘录与上游副本不一致（本机副本是「${(full[Number(line) - 1] ?? '').trim()}」）`)
        }
      }
    }
    if (failures.length) throw new Error(`酒馆上游摘录有问题（跑 pnpm generate:st-excerpts 重新摘）：\n${failures.join('\n')}`)
    return { records: records.length, sources: Object.keys(current.sources ?? {}).length, freshSources: fresh, unvendored, check: true }
  }

  const { lines, missing } = excerptFromLocal(records)
  if (missing.length) {
    throw new Error(`本机没有这些上游副本，摘不出来：${missing.join('、')}（用 ELECKOI_WI_JS / ELECKOI_ST_UPSTREAM 指到有副本的地方）`)
  }
  const { problems, unvendored } = checkRecords(records, Object.fromEntries(Object.entries(lines).map(([file, value]) => [file, { lines: value }])))
  if (problems.length) throw new Error(`摘出来的行对不上引用：\n${problems.join('\n')}`)

  const total = Object.values(lines).reduce((sum, value) => sum + Object.keys(value).length, 0)
  if (total > MAX_TOTAL) throw new Error(`摘录共 ${total} 行，超过 ${MAX_TOTAL} 行上限——引用范围是不是写得太大了？`)

  const sources = {}
  for (const [file, value] of Object.entries(lines)) {
    const sorted = {}
    for (const line of Object.keys(value).map(Number).sort((left, right) => left - right)) sorted[line] = value[line]
    const full = stFullLines(file) ?? []
    sources[file] = { origin: ST_SOURCES[file].origin, lineCount: full.length, lines: sorted }
  }
  await mkdir(dirname(ST_EXCERPTS), { recursive: true })
  await writeFile(ST_EXCERPTS, `${JSON.stringify({ schemaVersion: 1, provenance: ST_PROVENANCE, sources }, null, 2)}\n`, 'utf8')
  return { records: records.length, sources: Object.keys(sources).length, lines: total, unvendored, check: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  console.log(await generateStExcerpts(root, { check: process.argv.includes('--check') }))
}
