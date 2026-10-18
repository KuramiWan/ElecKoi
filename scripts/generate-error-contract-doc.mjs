#!/usr/bin/env node
/**
 * 从契约源生成对外可读的失败契约文档 `docs/error-contract.md`。
 *
 * 生成的产物逐码一行：码字符串 / 语义键 / 该码的详情参数 / 默认呈现通道 / 无参数时的用户句；
 * 外加解释四条契约规则、详情参数闭集与「通道只能上调」的三节。产物头部写明是生成物，
 * `pnpm check:error-contract-doc`（`pnpm build` 的一步）拒绝过期产物。
 *
 * ## 为什么用模块钩子读 TS 源（而不是 esbuild 或文本解析）
 *
 * 码表（`packages/shared/src/contracts/errors/codes.ts`）与参数表（同目录 `details.ts`）都是 TS 源，
 * 且 `details.ts` 里有 `import … from './codes.js'`——Node 的类型剥离按真实文件解析，
 * **不会**把 `.js` 重写成 `.ts`，所以直接 `import()` 那个文件会 `ERR_MODULE_NOT_FOUND`。
 * 三条路里选了第三条：
 *
 * 1. **esbuild**：根 `node_modules` 里没有它（`require.resolve('esbuild')` 从仓库根是 MODULE_NOT_FOUND；
 *    它只作为 vite 的传递依赖躺在 pnpm 的 `.pnpm/node_modules` 里）。为一个文档脚本引入一条隐式依赖不值。
 * 2. **文本解析**：码表确实是规整字面量，但那样文档就有两份真相——契约改了形状，生成器会静默产出旧表。
 * 3. **模块钩子（本文件）**：`module.registerHooks` 解析掉 `@shared/*` 别名与 `*.js → *.ts`，
 *    然后 `import()` 真源。没有引入依赖，读到的就是运行期真值（`ELECKOI_FAILURE_DETAIL_PARAMS`
 *    漏一条码在 TS 里就编译不过，这里拿到的就是那张表）。
 *
 * 用户句不能从 `failureText.js` 读：那张表是 `(details) => "…"` 的函数，拿不到字面量。
 * 所以表、默认通道集合与参数读取工具住在 `apps/web/src/utils/failureTexts.js`（无副作用的纯模块），
 * 这里直接 `import()` 它，用 `FAILURE_TEXTS[code]({})` 当「无参数时的说法」。
 *
 * 用法：
 *   node scripts/generate-error-contract-doc.mjs          # 写入 docs/error-contract.md
 *   node scripts/generate-error-contract-doc.mjs --check  # 只校验产物是否最新
 */
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeLineEndings } from './lib/normalize-line-endings.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(root, 'docs/error-contract.md')
const checkOnly = process.argv.includes('--check')

const SHARED_SOURCE = resolve(root, 'packages/shared/src')
const CODES_PATH = resolve(SHARED_SOURCE, 'contracts/errors/codes.ts')
const DETAILS_PATH = resolve(SHARED_SOURCE, 'contracts/errors/details.ts')
const TEXTS_PATH = resolve(root, 'apps/web/src/utils/failureTexts.js')

/** `docs/` 里的相对链接（`check:docs` 会逐个 stat）。 */
const links = {
  codes: '../packages/shared/src/contracts/errors/codes.ts',
  details: '../packages/shared/src/contracts/errors/details.ts',
  texts: '../apps/web/src/utils/failureTexts.js',
  gate: '../scripts/check-error-contract.mjs'
}

/**
 * 参数名 → 一句对外可读的解释。键集合由下面的断言与 `details.ts` 的联合声明对齐：
 * 契约新增参数时必须在这里补一句，否则生成器报错（文档不许漏参数）。
 */
const PARAM_DESCRIPTIONS = {
  field: '出问题的字段或配置项名（用户填的、模型配置的）。',
  issues: '合同违例的逐条诊断：`{ path, message }` 数组。',
  path: '涉及的文件系统路径（操作对象、被占用的目录）。',
  operation: '动作名（`read` / `write` / `delete` / `spawn` / `request` …）。',
  guard: '拒绝执行的那道护栏名（如 `untrusted-sender`）。',
  what: '涉及的**东西**（名词短语，会被拼进用户句，如「角色」「预设分组」）；不是 id。',
  expected: '当前版本或支持范围要求的形态（如 `schema v3`）。',
  actual: '实际观察到的形态。'
}

const isFile = (path) => existsSync(path) && statSync(path).isFile()

/**
 * 模块说明符可以省略扩展名；按 Node 的 ESM 习惯补成真实文件。
 * @param {string} base - 不含扩展名的绝对路径。
 * @returns {string | undefined} 命中的真实文件。
 */
function findSourceFile(base) {
  return [`${base}.ts`, `${base}.js`, base, `${base}/index.ts`].find(isFile)
}

registerHooks({
  /**
   * 只解析两种说明符：`@shared/*` 别名与相对路径里的 `*.js → *.ts`。
   * 其余原样交给 Node（`node:`、包名等）。
   */
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL
    if (parent !== undefined && parent.startsWith('file:')) {
      const parentDirectory = dirname(fileURLToPath(parent))
      if (specifier.startsWith('@shared/')) {
        const target = findSourceFile(resolve(SHARED_SOURCE, specifier.slice('@shared/'.length)))
        if (target !== undefined) return { url: pathToFileURL(target).href, shortCircuit: true }
      }
      if (specifier.startsWith('.')) {
        const target = resolve(parentDirectory, specifier)
        const typeScript = target.endsWith('.js') ? `${target.slice(0, -3)}.ts` : target
        if (typeScript !== target && isFile(typeScript)) {
          return { url: pathToFileURL(typeScript).href, shortCircuit: true }
        }
      }
    }
    return nextResolve(specifier, context)
  }
})

const {
  ELECKOI_FAILURE_CODES,
  ELECKOI_FAILURE_CODE_LIST,
  ELECKOI_FALLBACK_FAILURE_CODE,
  ELECKOI_FAILURE_CODE_PATTERN
} = await import(pathToFileURL(CODES_PATH).href)
const { ELECKOI_FAILURE_DETAIL_PARAMS } = await import(pathToFileURL(DETAILS_PATH).href)
const { FAILURE_TEXTS, APP_LEVEL_CODES } = await import(pathToFileURL(TEXTS_PATH).href)

const CODES = [...ELECKOI_FAILURE_CODE_LIST]
const KEY_BY_CODE = new Map(Object.entries(ELECKOI_FAILURE_CODES).map(([key, code]) => [code, key]))

assert.equal(CODES.length, Object.keys(ELECKOI_FAILURE_CODES).length, '码表的清单与对象条数不一致')
assert.equal(new Set(CODES).size, CODES.length, '码表清单里有重复的码')
assert.ok(CODES.includes(ELECKOI_FALLBACK_FAILURE_CODE), '兜底码不在码表清单里')

/**
 * 参数名闭集从 `details.ts` 的联合类型声明读（运行期不存在这个类型）。
 * 类型被擦除后没有别的读法；读错时下面的断言会报出条数不符，而不是静默产出半张表。
 */
const detailsSource = await readFile(DETAILS_PATH, 'utf8')
const paramUnion = /export type EleckoiFailureDetailParam =([\s\S]*?)\n\n/.exec(detailsSource)
assert.ok(paramUnion !== null, 'details.ts 里找不到 EleckoiFailureDetailParam 的联合声明')
const CLOSED_PARAMS = [...paramUnion[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
assert.equal(new Set(CLOSED_PARAMS).size, CLOSED_PARAMS.length, '参数名闭集里有重复项')
assert.deepEqual(
  [...CLOSED_PARAMS].sort(),
  Object.keys(PARAM_DESCRIPTIONS).sort(),
  'details.ts 的参数名闭集与生成器的解释表不一致：新增参数要在 generate-error-contract-doc.mjs 里补一句'
)

/** 每个参数被哪些码要求（文档表格用，永远与参数表一致）。 */
const CODES_BY_PARAM = new Map(CLOSED_PARAMS.map((param) => [param, []]))
for (const code of CODES) {
  const params = ELECKOI_FAILURE_DETAIL_PARAMS[code]
  assert.ok(Array.isArray(params), `码 ${code} 在 ELECKOI_FAILURE_DETAIL_PARAMS 里没有一行`)
  for (const param of params) {
    assert.ok(CODES_BY_PARAM.has(param), `码 ${code} 用了闭集外的参数 ${param}`)
    CODES_BY_PARAM.get(param).push(code)
  }
}

/**
 * 码 → 无参数时的用户句（兜底码没有固定说法，它走「原始失败」那条分支）。
 * @param {string} code - 契约码。
 * @returns {string} 一句话。
 */
function userTextOf(code) {
  const describe = FAILURE_TEXTS[code]
  if (describe === undefined) {
    assert.equal(code, ELECKOI_FALLBACK_FAILURE_CODE, `码 ${code} 在 failureTexts.js 里没有用户句`)
    return '—（兜底码没有固定说法：有 `details.what` 时用调用方给的说法，否则用原始失败的 `message`）'
  }
  assert.equal(typeof describe, 'function', `码 ${code} 的用户句不是函数`)
  const text = describe({})
  assert.equal(typeof text, 'string', `码 ${code} 的用户句不是字符串`)
  assert.notEqual(text.trim(), '', `码 ${code} 的用户句是空的`)
  return text
}

/** 通道 → 对外说法。 */
const channelOf = (code) => (APP_LEVEL_CODES.has(code) ? '应用级（app）' : '功能内（inline）')

/** Markdown 表格单元格转义。 */
function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

const APP_LEVEL_LIST = CODES.filter((code) => APP_LEVEL_CODES.has(code))

const rows = CODES.map((code) => {
  const key = KEY_BY_CODE.get(code)
  assert.ok(key !== undefined, `码 ${code} 不在 ELECKOI_FAILURE_CODES 里`)
  const params = ELECKOI_FAILURE_DETAIL_PARAMS[code].map((param) => `\`${param}\``).join('、')
  return `| \`${code}\` | \`${key}\` | ${params} | ${channelOf(code)} | ${escapeCell(userTextOf(code))} |`
})

const paramRows = CLOSED_PARAMS.map((param) => {
  const users = CODES_BY_PARAM.get(param)
  const usedBy = users.length === 0 ? '—（当前没有码要求）' : users.map((code) => `\`${code}\``).join('、')
  return `| \`${param}\` | ${PARAM_DESCRIPTIONS[param]} | ${usedBy} |`
})

/* 行数组而不是整段模板字符串：正文里有大量反引号（代码跨度），数组里每行都是纯字面量。 */
const lines = [
  '<!-- 由 pnpm generate:error-contract-doc 生成，请勿手改。 -->',
  '',
  '# ElecKoi 失败契约',
  '',
  '这份文档把 ElecKoi 的失败码、每条码的参数化详情、用户文案通道与四条契约规则写成对外可读的一页。',
  '它从契约源码生成（真源见文末），所以不会与实现漂移：手改产物会被 `pnpm check:error-contract-doc`',
  '拒绝，`pnpm build` 也跑这一步。',
  '',
  '适合三类读者：非 TypeScript 实现者（照抄码字符串与参数名）、第三方插件作者（按 `code` 判断失败种类）、',
  '维护者（哪条码带哪些参数、默认走哪个通道、用户看到的无参数说法是什么）。',
  '',
  '## 1. 失败对象与码的形态',
  '',
  '任何边界遇到无法判别的失败，一律折成兜底码 `eleckoi/internal`，并把原码或短诊断记进 `details.what`；',
  '**不许猜**成某个域码——猜错等于给调用方一个假的可判别失败。',
  '',
  '失败对象的形状（跨边界可以 `JSON.stringify` 往返，详情是扁平 JSON 对象）：',
  '',
  '```json',
  '{ "code": "<码表里的一条>", "message": "<开发者诊断>", "details": {} }',
  '```',
  '',
  `- \`code\`：给程序的分支依据；形态 \`eleckoi/<域>/<原因>\`（全小写 ASCII、连字符分词），` +
    '唯一例外是兜底码 `eleckoi/internal`（只有两段）。判定正则：`' + String(ELECKOI_FAILURE_CODE_PATTERN) + '`。',
  '- `message`：开发者诊断（原始中文句，可以带 id 与路径）。它进日志，**不是**给用户看的句子。',
  '- `details`：参数化详情，只放参数（见 §3），不许放拼好的句子。',
  '',
  '**用户可见文案只有一个解析点**（渲染层 `apps/web/src/utils/failureTexts.js`）：宿主、插件与领域层',
  '永不拼用户可见句子；非 TypeScript 实现自己写文案，契约只保证 `code` + `details` 足以说出正确的话。',
  '',
  '## 2. 四条契约规则',
  '',
  '`pnpm check:error-contract` 用四条规则守这份契约（实现见文末真源）。规则只看**代码位置**：',
  '同样一段文本出现在字符串或注释里不算（作者脚本示例、文档字面量因此不会被误判）。',
  '',
  '1. **禁止丢码**：不许把带码的失败压成一句话（例如 `new Error(result.error.message)`）。',
  '   宿主已经把 `code` 与 `details` 交出来了，调用方必须原样传下去，或者交给 `resolveFailure` 解析。',
  '2. **契约违例必须带 `issues`**：`eleckoi/contract/invalid-request` 与 `-response` 的详情必须是',
  '   **非空**数组，元素带 `path` 与 `message`。丢了 issues，用户就不知道哪一个字段不合要求。',
  '3. **空 catch 必须写成具名声明**：处理体为空时只能写成 `.catch(failureAlreadyPublished)`、',
  '   `.catch(rejectionIsAwaitedElsewhere)`、`.catch(bestEffort)` 之一，或者写一个非空处理体；',
  '   `catch {}` 与只含注释的 `catch {}` 都算裸吞。',
  '4. **不许裸抛**：领域、宿主与客户端插件层的 `throw new Error(` 必须改成带契约码的构造',
  '   （`DesktopError` / `productFailure`）。规则 1–3 是绝对值（命中即失败）；规则 4 是收口进度尺，',
  '   数字必须归零，归零后闸按绝对值判失败（`--strict`）。',
  '',
  '## 3. 详情参数（闭集）',
  '',
  '详情只放参数，不放拼好的句子。参数名是**闭集**：不在这 ' + CLOSED_PARAMS.length + ' 个里的新参数属于契约变更。',
  '最初六个（`field` / `issues` / `path` / `operation` / `guard` / `what`）之外，扩表时新增了',
  '`expected` / `actual`，用来表达「要求什么、实际是什么」。',
  '',
  '| 参数 | 含义 | 要求这个参数的码 |',
  '| --- | --- | --- |',
  ...paramRows,
  '',
  '## 4. 呈现通道：默认由码给，只能上调',
  '',
  '每条码有一个**默认通道**：',
  '',
  '- `app`（应用级）：失败不属于某一个窗口或面板（宿主进程、库、存储、调用来源），要弹应用级对话框或窗口级提示；',
  '- `inline`（功能内）：就地显示在发生的那块界面里（目录读失败、保存冲突这类）。',
  '',
  '调用点可以**上调**（`upgradeTo: "app"`），而**没有下调的位置**——解析函数的参数里根本没有那个方向，',
  '把严重失败藏成一行小字这条在结构上做不到。',
  '',
  `默认走应用级的码（${APP_LEVEL_LIST.length} 条）：${APP_LEVEL_LIST.map((code) => `\`${code}\``).join('、')}。`,
  '',
  `## 5. 码表（${CODES.length} 条，逐码一行）`,
  '',
  '顺序即跨语言实现、文档表格与逐条断言的**列举顺序**（先兜底，再按「谁的问题」分组），别各自重排。',
  '「语义键」是契约源码里那条常量的键（给代码读）；「详情参数」是该码会带的参数（必填 / 可选见',
  `[详情形状](${links.details})）；「用户句」是**没有详情参数时**渲染层给用户的说法。`,
  '',
  '| 码 | 语义键 | 详情参数 | 默认通道 | 用户句（无参数时） |',
  '| --- | --- | --- | --- | --- |',
  ...rows,
  '',
  '## 6. 真源与维护',
  '',
  '| 内容 | 真源 |',
  '| --- | --- |',
  `| 码字符串与顺序 | [codes.ts](${links.codes}) |`,
  `| 每条码的参数 | [details.ts](${links.details}) |`,
  `| 用户句与默认通道 | [failureTexts.js](${links.texts}) |`,
  `| 四条规则的实现 | [check-error-contract.mjs](${links.gate}) |`,
  '',
  '改契约的顺序：先改真源，再 `pnpm generate:error-contract-doc` 重生成，然后把产物一起提交。',
  '`pnpm check:error-contract-doc`（`pnpm build` 的一步）会拒绝过期产物。',
  '',
  '这份文档不记录当前裸抛处数——数字看 `pnpm check:error-contract` 的输出。',
  ''
]

const generated = `${lines.join('\n')}\n`

if (checkOnly) {
  let current = ''
  try {
    current = await readFile(outputPath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (normalizeLineEndings(current) !== normalizeLineEndings(generated)) {
    throw new Error('失败契约文档已过期，请运行 pnpm generate:error-contract-doc')
  }
  console.log(
    `Error contract documentation is current: ${CODES.length} codes, ${CLOSED_PARAMS.length} detail params, ` +
      `${APP_LEVEL_LIST.length} app-level codes.`
  )
} else {
  await writeFile(outputPath, generated, 'utf8')
  console.log(
    `Generated ${relative(root, outputPath)}: ${CODES.length} codes, ${CLOSED_PARAMS.length} detail params, ` +
      `${APP_LEVEL_LIST.length} app-level codes.`
  )
}
