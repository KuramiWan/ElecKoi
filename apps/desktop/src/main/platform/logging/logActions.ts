/**
 * 主进程的动作日志入口。
 *
 * 语义键在 `@shared/contracts/logActions`（与渲染层同一张表，`apps/web/src/utils/logAction.js` 用它
 * 拼动作行、经 console-message 桥送回来）；本文件只负责把一次动作阶段写进 pino，并把失败折成
 * 契约形态（`code` / `message` / `details`）。
 *
 * 一行日志的形状由 `@shared/foundation/actionLog` 定义（`动作 <键> 开始|成功|失败：[码] …`），
 * 这里不另拼句子——两边（主进程 / 渲染层）必须长得一样。
 */
import type { Logger } from 'pino'
import type { LogAction, LogActionPhase } from '@shared/contracts/logActions'
import { describeAction, parseActionLogMessage } from '@shared/foundation/actionLog'

/** 写动作日志只需要两档：开始 / 成功是 `info`，失败是 `error`。 */
type ActionLogger = Pick<Logger, 'info' | 'error'>

/**
 * 写一行动作日志。
 *
 * @param logger - 主进程日志（`ctx.appLog`）。
 * @param action - 语义动作键，取自 `LOG_ACTIONS`；类型是闭集，拼错编译不过。
 * @param phase - `start` / `success` / `failure`（三个各写一行）。
 * @param failure - 失败阶段的抛出值（任意形态；内部折成契约码 + 详情）。其余阶段忽略。
 */
export function logAction(
  logger: ActionLogger,
  action: LogAction,
  phase: LogActionPhase,
  failure?: unknown
): void {
  const record = describeAction(action, phase, failure)
  if (record.phase === 'failure') {
    logger.error({
      action: record.action,
      phase: record.phase,
      code: record.code,
      details: record.details,
      // pino 只认 `err` 这个键；写成别的会丢掉栈。
      ...(failure instanceof Error ? { err: failure } : {})
    }, record.text)
    return
  }
  logger.info({ action: record.action, phase: record.phase }, record.text)
}

/**
 * 把渲染层经 `console` 送来的动作行转发进文件日志。
 *
 * 只认 `eleckoi-action ` 前缀且通过契约校验的行（见 `parseActionLogMessage`）；其余返回 `false`，
 * 调用点继续按普通 console 分支处理。这样渲染层不需要新开 IPC 通道，主进程也不会把任意
 * console 输出当动作日志收进文件。
 *
 * @param logger - 主进程日志。
 * @param line - renderer 的 console 行原文。
 * @returns 这一行是动作日志并已写入时为 true。
 */
export function relayRendererActionLog(logger: ActionLogger, line: unknown): boolean {
  const record = parseActionLogMessage(line)
  if (record === undefined) return false
  const fields = {
    action: record.action,
    phase: record.phase,
    source: 'renderer',
    ...(record.code === undefined ? {} : { code: record.code }),
    ...(record.details === undefined ? {} : { details: record.details })
  }
  if (record.phase === 'failure') logger.error(fields, record.text)
  else logger.info(fields, record.text)
  return true
}
