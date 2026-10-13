import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import pino, { type Logger } from 'pino'
import { appLogsDirectory } from '@main/platform/filesystem/AppPaths'

/**
 * 日志的写文件出口：stdout **加**一个能保留的文件（ADR 0002 决定 10 / spec 决定 10；用户故事 8：
 * 「日志写到文件并能保留，不依赖终端还开着」）。
 *
 * 两件事**都住在本文件内**，不许摊到调用方：
 *
 * - **轮转**：当前文件会超过单文件上限时，`<name>.log` → `<name>.log.1`，`.1` → `.2`，依次后移；
 * - **保留期**：保留的文件数（含正在写的那个）有上限，最老的一份直接删掉。
 *
 * 目录是**每个实例给的一次真相**，两条实例的差别只有这一个参数：
 *
 * - `createAppLog()`（唯一调用点 `plugins.ts`）拿 `AppPaths.logs`（那时 `userData` 已经定了）；
 * - `getBootstrapLogger()`（唯一调用点 `main.ts`）只能传**函数**：它在 `app.setPath('userData')`
 *   之前就构造了，启动阶段的失败恰恰发生在这条实例上，所以目录在**写入时**才解析。
 */

/** 单文件上限与保留的文件数（含正在写的那个）。 */
export interface AppLogFilePolicy {
  readonly maxBytes: number
  readonly maxFiles: number
}

/**
 * 生产默认值：单文件 1 MiB、保留 5 个文件（含活动文件），最坏约 5 MiB。
 * 日志是 ASCII/UTF-8 的 JSON 行；主进程的量级远达不到这个上限，正常运行时只看得到活动文件。
 */
export const DEFAULT_APP_LOG_FILE_POLICY: AppLogFilePolicy = { maxBytes: 1024 * 1024, maxFiles: 5 }

interface LoggerSpec {
  readonly name: string
  /** 目录；给函数表示**写入时**才解析（bootstrap 那侧需要的形状）。 */
  readonly directory: string | (() => string)
  readonly base?: Record<string, unknown>
  readonly level?: string
  readonly filePolicy?: AppLogFilePolicy
}

/**
 * 应用运行期的 logger（`ctx.appLog` 那条实例）。
 *
 * `filePolicy` 是**测试**压低上限用的口子（生产调用点 `plugins.ts` 不传，走
 * {@link DEFAULT_APP_LOG_FILE_POLICY}）：轮转与保留期的**策略与实现都住在本文件内**，
 * 这里只是把上限参数化，好让用例不用写满 1 MiB 就能断言它生效。
 */
export function createAppLog(directory: string, filePolicy?: AppLogFilePolicy): Logger {
  return createLogger({
    name: 'eleckoi-desktop',
    directory,
    level: process.env.ELECKOI_LOG_LEVEL ?? 'info',
    base: { process: 'main' },
    ...(filePolicy === undefined ? {} : { filePolicy })
  })
}

let bootstrapLogger: Logger | undefined

/**
 * 启动阶段的 logger。目录在写入时才定，因为 `main.ts` 只在 `configureRuntimeUserData()` /
 * `configureElectron()` 之后才知道最终的 `userData`（未打包时带 `-dev` 后缀）。
 */
export function getBootstrapLogger(): Logger {
  bootstrapLogger ??= createLogger({
    name: 'eleckoi-desktop-bootstrap',
    directory: () => appLogsDirectory(app.getPath('userData'))
  })
  return bootstrapLogger
}

function createLogger(spec: LoggerSpec): Logger {
  const destination = pino.multistream([
    { stream: pino.destination(1) },
    { stream: createRotatingFileStream(spec.name, spec.directory, spec.filePolicy ?? DEFAULT_APP_LOG_FILE_POLICY) }
  ])
  return pino({
    name: spec.name,
    level: spec.level ?? 'info',
    ...(spec.base === undefined ? {} : { base: spec.base })
  }, destination)
}

/** 一个只做追加与轮转的文件流：`pino.multistream` 只要求 `write(msg)`。 */
function createRotatingFileStream(
  name: string,
  directory: string | (() => string),
  policy: AppLogFilePolicy
): pino.DestinationStream {
  const fileName = `${name}.log`
  let activePath: string | undefined
  return {
    write(line: string): void {
      try {
        const current = typeof directory === 'function' ? directory() : directory
        const path = join(current, fileName)
        if (path !== activePath) {
          mkdirSync(current, { recursive: true })
          activePath = path
        }
        rotateBeforeAppend(path, policy, Buffer.byteLength(line))
        appendFileSync(path, line)
      } catch (error) {
        // 日志出口自己失败**不能**把调用方带走：`logger.error(...)` 经常正好写在某个 catch 里，
        // 那会把真正的失败换成这条 IO 错误、还把 catch 之后的收尾整段跳过。所以降级：
        // 这一条只走 stdout，并把「文件那条断了」报到 stderr——不静默、也不假装成功。
        // 下一条还会再试一次（目录可能是暂时不可写），所以这里每次都如实报。
        process.stderr.write(`eleckoi-desktop: 日志文件写入失败，这一条只走了 stdout：${String(error)}\n`)
      }
    }
  }
}

/**
 * 追加这一行会让文件超过上限时先轮转。轮转是「最老的先删、其余后移一个号」，
 * 所以保留期就是文件数上限本身，不需要按时间扫目录。
 */
function rotateBeforeAppend(activePath: string, policy: AppLogFilePolicy, incomingBytes: number): void {
  if (!existsSync(activePath)) return
  if (statSync(activePath).size + incomingBytes <= policy.maxBytes) return
  // 上限只有 1 个文件（活动文件自己）时没有可轮转的去处，直接丢掉旧的。
  if (policy.maxFiles <= 1) {
    rmSync(activePath, { force: true })
    return
  }
  rmSync(rotatedPath(activePath, policy.maxFiles - 1), { force: true })
  for (let index = policy.maxFiles - 2; index >= 1; index -= 1) {
    const source = rotatedPath(activePath, index)
    if (existsSync(source)) renameSync(source, rotatedPath(activePath, index + 1))
  }
  renameSync(activePath, rotatedPath(activePath, 1))
}

function rotatedPath(activePath: string, index: number): string {
  return `${activePath}.${String(index)}`
}
