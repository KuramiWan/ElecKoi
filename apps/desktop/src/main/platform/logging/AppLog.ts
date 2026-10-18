import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pino, { type Logger } from 'pino'
import { LOG_ACTIONS } from '@shared/contracts/logActions'
import { appLogDirectory, appLogFileName, applyAppLogRotation, logDateStamp } from './logRotation'

/**
 * 会话开始标记：应用就绪时写一行（带日志文件路径、语义键 `session.started` 与配对标识）。
 * 语义键在结构化字段 `action` 里（`LOG_ACTIONS.sessionStarted`），渲染层 / 主进程的动作行
 * 用的是同一套键（`@shared/contracts/logActions`）。
 */
export const APP_LOG_SESSION_START = 'ElecKoi Desktop 会话开始'

/** 会话结束标记：正常退出时写一行（带同一个 `sessionId`）；崩溃 / 强杀时没有这一行。 */
export const APP_LOG_SESSION_END = 'ElecKoi Desktop 会话结束'

/**
 * 创建主进程日志：写到 `<userData>/logs/eleckoi-desktop-<YYYY-MM-DD>.log`。
 *
 * - `userData` 由 `AppPaths` 给出：启动配置可能改写 `app.setPath('userData')`，这个函数不自己
 *   读 `app.getPath`，否则会写到一个用户找不到的目录；
 * - 建实例时先做轮转（纯函数在 `logRotation.ts`）：当日文件超过阈值改名 `.1`，7 天前的文件删掉；
 * - **同步写**：进程级出口是在进程崩溃前最后一刻写日志，异步缓冲会把最后几行正好丢掉；
 * - 文件打不开时**降级为只写 stdout**（stderr 留一行原因）：日志不能成为应用起不来的原因。
 *
 * @param userData - 应用数据根目录（`AppPaths.userData`）。
 * @param now - 取哪一天的日志文件；缺省当前时间（用例传固定值）。
 * @returns pino 日志实例。
 */
export function createAppLog(userData: string, now: Date = new Date()): Logger {
  const today = logDateStamp(now)
  const directory = appLogDirectory(userData)
  const options = {
    name: 'eleckoi-desktop',
    level: process.env.ELECKOI_LOG_LEVEL ?? 'info',
    base: { process: 'main' }
  }
  try {
    mkdirSync(directory, { recursive: true })
    applyAppLogRotation({ directory, today })
    return pino(options, pino.destination({
      dest: join(directory, appLogFileName(today)),
      sync: true
    }))
  } catch (error) {
    process.stderr.write(`eleckoi-desktop: 日志文件不可写，已降级为只写 stdout：${errorTextOf(error)}\n`)
    return pino(options)
  }
}

/**
 * 会话开始：一行 `info`，带语义键 `session.started`、本次会话的配对标识与日志文件路径
 * （维护者靠路径找到这次运行的日志）。
 *
 * @param logger - 主进程日志。
 * @param logFile - 本次运行写到的日志文件。
 * @param sessionId - 配对标识；缺省新生成一个。结束行必须带同一个值，两者才算成对。
 * @returns 本次会话的配对标识（调用点要存起来交给 {@link logAppSessionEnd}）。
 */
export function logAppSessionStart(
  logger: Pick<Logger, 'info'>,
  logFile: string,
  sessionId: string = randomUUID()
): string {
  logger.info({ action: LOG_ACTIONS.sessionStarted, sessionId, logFile }, APP_LOG_SESSION_START)
  return sessionId
}

/**
 * 会话结束：一行 `info`，带语义键 `session.ended` 与开始时给出的配对标识。
 * 崩溃 / 强杀时这一行不会出现，日志里就是"有 start 没 end"。
 *
 * @param logger - 主进程日志。
 * @param sessionId - {@link logAppSessionStart} 返回的配对标识。
 */
export function logAppSessionEnd(logger: Pick<Logger, 'info'>, sessionId: string): void {
  logger.info({ action: LOG_ACTIONS.sessionEnded, sessionId }, APP_LOG_SESSION_END)
}

const bootstrapLogger = pino({ name: 'eleckoi-desktop-bootstrap' })

export function getBootstrapLogger(): Logger {
  return bootstrapLogger
}

/** 失败 → 一行文本（降级提示用；不依赖日志本身）。 */
function errorTextOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
