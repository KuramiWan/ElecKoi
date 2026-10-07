/**
 * 生成两份对外兼容文档（`docs/tavern-compatibility.md` / `.en.md`）。
 *
 * 与仓库里既有的生成器同一套路（`generate-plugin-developer-docs.mjs`、`generate-common-schema.mjs`）：
 *   - 事实与措辞分开：**事实**来自 `tests/fixtures/tavern-docs/docTokens.ts`（数字、源码引用，
 *     由本文件把两份字段清单喂进去算出），**措辞**在模板
 *     `tests/fixtures/tavern-docs/tavern-compatibility.{zh,en}.md` 里——正文只允许出现 `<<token>>`，
 *     不许出现手写的计数（`tavern-docs-generated.test.ts` 会逐个数字核对）；
 *   - `--check` 只比对不写盘：产物与渲染结果不一致就报"已过期"，由 `pnpm build`（`check:tavern-docs`）
 *     在 CI 里拦住；
 *   - 手改 `docs/tavern-compatibility*.md` 一定会在下一次 `--check` 时红——那是生成产物。
 *
 * ⚠️ 这里用 `.ts` 扩展名 import：Node 24 原生类型剥离能直接吃 TS，但 ESM 要求显式扩展名；
 * 而 `docTokens.ts` / `docRender.ts` 本身是 import-free 的（双加载器约束，理由见那个文件顶部）。
 *
 * 用法：
 *   pnpm generate:tavern-docs          # 写盘
 *   pnpm check:tavern-docs             # 只核对（CI / build 链）
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function generateTavernCompatDocs(root, { check = false } = {}) {
  const card = await import(resolve(root, 'tests/helpers/tavernCardFieldManifest.ts'))
  const world = await import(resolve(root, 'tests/helpers/tavernWorldFieldManifest.ts'))
  const { buildTokens } = await import(resolve(root, 'tests/fixtures/tavern-docs/docTokens.ts'))
  const { DOC_FILES, renderDoc } = await import(resolve(root, 'tests/fixtures/tavern-docs/docRender.ts'))
  const tokenMap = buildTokens(card.tavernCardFields, world.worldFields)
  const stale = []
  for (const { lang, doc, template } of DOC_FILES) {
    const source = await readFile(resolve(root, template), 'utf8')
    const generated = renderDoc(lang, source, tokenMap)
    const absolute = resolve(root, doc)
    if (check) {
      const current = await readFile(absolute, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
      if (current !== generated) stale.push(doc)
    } else {
      await writeFile(absolute, generated, 'utf8')
    }
  }
  if (stale.length) {
    throw new Error(`对外兼容文档已过期（手改过产物，或改了清单/事实模型没重新生成），请运行 pnpm generate:tavern-docs：\n${stale.join('\n')}`)
  }
  return { documents: DOC_FILES.length, tokens: tokenMap.size, check }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  console.log(await generateTavernCompatDocs(root, { check: process.argv.includes('--check') }))
}
