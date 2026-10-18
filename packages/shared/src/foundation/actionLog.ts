/**
 * 动作日志行的形状——主进程与渲染层共用的那一行。
 *
 * 判据来源：`spec-error-handling-remainder.md` WP14「抽任意一行关键路径日志，能读出谁、在做什么、
 * 结果如何、失败时是什么码」。
 *
 * 三个阶段各一行，形态固定：
 *
 * - `动作 conversations.delete 开始`
 * - `动作 conversations.delete 成功`
 * - `动作 conversations.delete 失败：[eleckoi/lookup/not-found] 找不到这个会话：abc（what: 会话）`
 *
 * 失败阶段复用 {@link describeFailure} 的「码 + 开发者文案 + 参数化详情」形状，所以一行里同时有
 * 动作键、码、文案与详情。**不含时间与进程**：那是日志层（pino）的字段，这里再写一遍会打架。
 *
 * 渲染层 → 主进程走 `console`：{@link formatActionLogMessage} 生成一行带固定前缀的 JSON，
 * {@link parseActionLogMessage} 校验后还原成记录。解析失败一律返回 `undefined`——一条坏日志
 * 不能打断应用，也不能把任意 console 行都当动作日志收进文件。
 */
import {
  LOG_ACTION_MESSAGE_MARKER,
  isLogAction,
  isLogActionPhase,
  type LogAction,
  type LogActionPhase
} from '../contracts/logActions.js'
import { describeFailure } from './describeFailure.js'
import { foldFailure } from './failure.js'

/** 一行动作日志的完整记录（既是落盘字段的来源，也是渲染层 → 主进程的线上形状）。 */
export interface ActionLogRecord {
  readonly action: LogAction
  readonly phase: LogActionPhase
  /** 给人看的一句话（pino 的 `msg`）。 */
  readonly text: string
  /** 失败阶段的契约码；其余阶段没有。 */
  readonly code?: string
  /** 失败阶段的开发者诊断；其余阶段没有。 */
  readonly message?: string
  /** 失败阶段的参数化详情；其余阶段没有。 */
  readonly details?: Record<string, unknown>
}

/**
 * 把一次动作阶段变成一行记录。
 *
 * @param action - 语义动作键（`LOG_ACTIONS` 里的值）。
 * @param phase - `start` / `success` / `failure`。
 * @param failure - 失败阶段的抛出值（任意形态，内部用 `foldFailure` 折成契约形态）；其余阶段忽略。
 * @returns 记录；`text` 就是进日志的那句话。
 */
export function describeAction(action: LogAction, phase: LogActionPhase, failure?: unknown): ActionLogRecord {
  if (phase === 'start') return { action, phase, text: `动作 ${action} 开始` }
  if (phase === 'success') return { action, phase, text: `动作 ${action} 成功` }
  const folded = foldFailure(failure)
  return {
    action,
    phase,
    text: `动作 ${action} 失败：${describeFailure(folded)}`,
    code: folded.code,
    message: folded.message,
    details: { ...folded.details }
  }
}

/**
 * 记录 → 渲染层 `console` 的一行（固定前缀 + JSON）。
 *
 * 只放一个 JSON 对象：主进程要的是 `action` / `phase` / `code` 这些字段，格式化由
 * `describeAction` 做完了（`text` 在记录里）。
 *
 * @param record - 动作记录。
 * @returns 一行文本。
 */
export function formatActionLogMessage(record: ActionLogRecord): string {
  return `${LOG_ACTION_MESSAGE_MARKER} ${JSON.stringify(record)}`
}

/**
 * 渲染层 `console` 的一行 → 记录。
 *
 * 只认带固定前缀、字段合法、动作键在白名单里的行；其余（普通 console 输出、坏 JSON、伪造的键）
 * 返回 `undefined`。**永不抛**。
 *
 * @param line - `console` 行原文（任意值）。
 * @returns 记录，或 `undefined`。
 */
export function parseActionLogMessage(line: unknown): ActionLogRecord | undefined {
  if (typeof line !== 'string' || !line.startsWith(`${LOG_ACTION_MESSAGE_MARKER} `)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(line.slice(LOG_ACTION_MESSAGE_MARKER.length + 1))
  } catch {
    return undefined
  }
  return actionLogRecordOf(parsed)
}

/**
 * 已解析的 JSON → 记录（校验形状）。
 * @param value - `JSON.parse` 的产物。
 * @returns 合法记录，或 `undefined`。
 */
function actionLogRecordOf(value: unknown): ActionLogRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const fields = value as Record<string, unknown>
  if (!isLogAction(fields.action) || !isLogActionPhase(fields.phase)) return undefined
  if (typeof fields.text !== 'string' || fields.text.trim() === '') return undefined
  const code = fields.code
  const message = fields.message
  const details = fields.details
  if (code !== undefined && (typeof code !== 'string' || code.trim() === '')) return undefined
  if (message !== undefined && typeof message !== 'string') return undefined
  if (details !== undefined) {
    if (typeof details !== 'object' || details === null || Array.isArray(details)) return undefined
  }
  // 失败行必须带码：没有码的失败行读不出「为什么」，不符合本包的判据。
  if (fields.phase === 'failure' && typeof code !== 'string') return undefined
  return {
    action: fields.action,
    phase: fields.phase,
    text: fields.text,
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof message === 'string' ? { message } : {}),
    ...(details !== undefined ? { details: { ...(details as Record<string, unknown>) } } : {})
  }
}
