import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pino, { type Logger } from 'pino'
import { appLogDirectory, appLogFileName, applyAppLogRotation, logDateStamp } from './logRotation'

/** 会话开始标记：应用就绪时写一行（带日志文件路径）。 */
export const APP_LOG_SESSION_START = 'ElecKoi Desktop 会话开始'

/** 会话结束标记：正常退出时写一行；崩溃 / 强杀时没有这一行。 */
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
 * 会话开始：一行 `info`，带日志文件路径（维护者靠它找到这次运行的日志）。
 * @param logger - 主进程日志。
 * @param logFile - 本次运行写到的日志文件。
 */
export function logAppSessionStart(logger: Pick<Logger, 'info'>, logFile: string): void {
  logger.info({ logFile }, APP_LOG_SESSION_START)
}

/**
 * 会话结束：一行 `info`。崩溃 / 强杀时这一行不会出现，日志里就是"有 start 没 end"。
 * @param logger - 主进程日志。
 */
export function logAppSessionEnd(logger: Pick<Logger, 'info'>): void {
  logger.info(APP_LOG_SESSION_END)
}

const bootstrapLogger = pino({ name: 'eleckoi-desktop-bootstrap' })

export function getBootstrapLogger(): Logger {
  return bootstrapLogger
}

/** 失败 → 一行文本（降级提示用；不依赖日志本身）。 */
function errorTextOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
