/**
 * 产品失败的**开发者诊断**：一行里说清「什么码、谁在哪、为什么」。
 *
 * 判据来源：错误设计的目标「日志里一行能读出码 + 开发者文案 + 详情 + 操作名 + 时间，
 * 看日志不需要回查码表」。
 *
 * 这个模块给**渲染层与主进程**共用（纯函数、无依赖）：它把 `foldFailure` 的结果拼成一行，
 * 既能进 `console.error`（渲染层会经 console-message 桥进主进程日志），也能进 pino。
 *
 * 形状：`[码] 开发者文案（详情） 操作名`。没有操作名时省略尾部；没有详情时省略括号。
 * **不含时间戳**：时间戳由日志层负责（pino 自带），这里再写一遍会与日志时间打架。
 */
import type { EleckoiFailure } from './failure'

/**
 * 拼一行自解释的诊断。
 *
 * @param failure - `foldFailure` 的产物。
 * @param action - 这次操作的语义名（如「保存创作项目」）。**不是**随机 id：随机串能归组但没有意义。
 * @returns 一行诊断；字段之间用空格，详情内部用「；」。
 */
export function describeFailure(failure: EleckoiFailure, action?: string): string {
  const details = describeDetails(failure.details)
  const head = `[${failure.code}] ${failure.message}${details === '' ? '' : `（${details}）`}`
  const verb = typeof action === 'string' ? action.trim() : ''
  return verb === '' ? head : `${head} · ${verb}`
}

/**
 * 详情 → `key: value；key: value`。只接受扁平对象；数组与嵌套对象按 JSON 给。
 * @param details - 契约详情。
 * @returns 一行文本；空详情给空串。
 */
export function describeDetails(details: unknown): string {
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    parts.push(`${key}: ${describeValue(value)}`)
  }
  return parts.join('；')
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? String(value) : serialized
  } catch {
    return String(value)
  }
}
