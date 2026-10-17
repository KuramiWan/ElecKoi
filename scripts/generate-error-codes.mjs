#!/usr/bin/env node
/**
 * 把契约码表生成成**客户端 bundle 能用**的常量模块。
 *
 * 为什么需要生成：`packages/host/product-api` 的 client 面是运行时独立加载的 module-loader bundle，
 * 取不到契约包（`@eleckoi/product-shared` 的 exports 指向 TS 源码，只有构建期能内联）。
 * 在那之前我们靠两份手写常量（`INVALID_RESPONSE_CODE` / `INTERNAL_FAILURE_CODE`）+ 用例守住，
 * 现在 27 个 `dsh-client-*` 也要开始抛带码的失败，手写会漂。
 *
 * 真相只有一份：本脚本从 `packages/shared/src/contracts/errors/codes.ts` 读码表本体
 * （Node 24 的类型剥离能直接 import 那个 .ts），渲染成
 * `packages/host/product-api/src/client/errorCodes.generated.ts`。
 * `check:error-codes` 校验产物是新的；产物头部写明"生成，请勿手改"。
 *
 * 用法：
 *   node scripts/generate-error-codes.mjs            # 写入产物
 *   node scripts/generate-error-codes.mjs --check    # 只校验是否最新
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'packages/shared/src/contracts/errors/codes.ts')
const outputPath = resolve(root, 'packages/host/product-api/src/client/errorCodes.generated.ts')
const checkOnly = process.argv.includes('--check')

const { ELECKOI_FAILURE_CODES } = await import(sourcePath)

const entries = Object.entries(ELECKOI_FAILURE_CODES)
const width = Math.max(...entries.map(([name]) => name.length))
const lines = entries.map(([name, code]) => `  ${`${name}:`.padEnd(width + 1)} '${code}'`)

const content = `/**
 * 失败码表（客户端 bundle 用）。
 *
 * ⚠️ **本文件由 \`pnpm generate:error-codes\` 从
 * \`packages/shared/src/contracts/errors/codes.ts\` 生成，请勿手改。**
 * 改码表请改契约包那份，然后重跑生成；\`check:error-codes\` 会拦住手改与忘记重生成。
 *
 * 为什么要有这份副本：product-api 的 client 面是运行时独立加载的 module-loader bundle，
 * 取不到契约包源码，而 27 个 \`dsh-client-*\` 也要抛带契约码的失败。
 */

/** 契约码（键是 ASCII 名，值是线上码字符串）。 */
export const ELECKOI_FAILURE_CODES = {
${lines.join(',\n')}
} as const

/** 契约码的联合类型。 */
export type ClientFailureCode = typeof ELECKOI_FAILURE_CODES[keyof typeof ELECKOI_FAILURE_CODES]
`

const current = await readFile(outputPath, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return null
  throw error
})

if (checkOnly) {
  if (current !== content) {
    console.error('客户端码表已过期，请运行 pnpm generate:error-codes：')
    console.error(`  ${outputPath.slice(root.length + 1)}`)
    process.exit(1)
  }
  console.log(`Client error codes are current: ${entries.length} codes.`)
} else {
  await writeFile(outputPath, content, 'utf8')
  console.log(`Wrote ${outputPath.slice(root.length + 1)}: ${entries.length} codes.`)
}
