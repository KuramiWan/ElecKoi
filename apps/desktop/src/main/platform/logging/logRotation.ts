import { readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 日志文件的命名、轮转与保留期。
 *
 * 落盘路径的唯一形状是 `<userData>/logs/eleckoi-desktop-<YYYY-MM-DD>.log`：
 *
 * - 一天一个文件，日期取**本地**时区（用户眼里的"今天"）；
 * - 轮转是**最小实现**：启动建日志前看一眼当日文件，超过 {@link APP_LOG_MAX_BYTES} 就改名成
 *   `….log.1`（只保留一份轮转副本，旧的 `.1` 先删掉）；
 * - 保留期是 {@link APP_LOG_RETENTION_DAYS} 天：7 天前及更早的日志文件（含轮转副本）删掉。
 *
 * 判断"该改名 / 该删 / 什么都不做"的 {@link planAppLogRotation} 是**纯函数**：输入是
 * 目录里的条目与今天的日期，输出是动作列表，不碰文件系统。用例因此能覆盖三种情形
 * （改名 / 删旧 / 无事可做），而不必真的跑一次应用。执行动作的 {@link applyAppLogRotation}
 * 是唯一碰盘的部分，失败只走 `onFailure`——日志不能成为启动失败的原因。
 */

/** 日志目录名（挂在 `<userData>` 下）。 */
export const APP_LOG_DIRECTORY_NAME = 'logs'

/** 日志文件名前缀。 */
export const APP_LOG_PREFIX = 'eleckoi-desktop'

/** 轮转副本后缀：`…-<日期>.log.1`；只保留一份。 */
export const APP_LOG_ROTATION_SUFFIX = '.1'

/** 当日日志超过这个字节数时，启动时改名成 `.1`。 */
export const APP_LOG_MAX_BYTES = 5 * 1024 * 1024

/** 保留几天：今天 + 前 6 天；7 天前及更早的删掉。 */
export const APP_LOG_RETENTION_DAYS = 7

/** 认得的日志文件名：`eleckoi-desktop-<YYYY-MM-DD>.log` 或它的 `.N` 轮转副本。 */
const APP_LOG_FILE_NAME = new RegExp(`^${APP_LOG_PREFIX}-(\\d{4}-\\d{2}-\\d{2})\\.log(\\.\\d+)?$`)

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 今天的日期戳（**本地**时区），`YYYY-MM-DD`。
 * @param now - 取哪一刻的日期；缺省当前时间（用例传固定值）。
 * @returns 日期戳。
 */
export function logDateStamp(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 某一天的日志文件名。
 * @param date - 日期戳（`YYYY-MM-DD`）。
 * @returns 文件名。
 */
export function appLogFileName(date: string): string {
  return `${APP_LOG_PREFIX}-${date}.log`
}

/**
 * 日志目录：`<userData>/logs`。`userData` 由 `AppPaths` 给出（启动配置可能改写 `userData`，
 * 所以这里只做拼接，不自己读 `app.getPath`）。
 * @param userData - 应用数据根目录。
 * @returns 日志目录的绝对路径。
 */
export function appLogDirectory(userData: string): string {
  return join(userData, APP_LOG_DIRECTORY_NAME)
}

/**
 * 某一天的完整日志路径。
 * @param userData - 应用数据根目录。
 * @param now - 取哪一刻的日期；缺省当前时间。
 * @returns 日志文件的绝对路径。
 */
export function appLogFilePath(userData: string, now: Date = new Date()): string {
  return join(appLogDirectory(userData), appLogFileName(logDateStamp(now)))
}

/** 日志目录里的一个条目（纯函数输入，不读盘）。 */
export interface AppLogFileEntry {
  /** 文件名（不含目录）。 */
  readonly name: string
  /** 文件字节数。 */
  readonly size: number
}

/** 轮转计划的输入。 */
export interface AppLogRotationPlan {
  /** 今天的日期戳（`YYYY-MM-DD`）。 */
  readonly today: string
  /** 日志目录当前的条目。 */
  readonly entries: readonly AppLogFileEntry[]
  /** 当日日志的阈值；缺省 {@link APP_LOG_MAX_BYTES}。 */
  readonly maxBytes?: number
  /** 保留天数；缺省 {@link APP_LOG_RETENTION_DAYS}。 */
  readonly retentionDays?: number
}

/** 轮转计划里的一个动作。 */
export type AppLogRotationAction =
  /** 当日日志超过阈值：改名成 `.1`（`.1` 已存在时前面会有一条 `delete`/`replaced`）。 */
  | { readonly action: 'rename'; readonly from: string; readonly to: string }
  /** 删文件：过期（`expired`）或被新一轮轮转替换（`replaced`）。 */
  | { readonly action: 'delete'; readonly name: string; readonly reason: 'expired' | 'replaced' }

/**
 * 轮转计划（**纯函数**）：只看目录条目与今天的日期，不碰文件系统。
 *
 * 动作顺序固定：先删过期的，再删被替换的 `.1`，最后改名。同一批动作里不会对同一个文件删两次。
 * @param plan - 目录条目与今天日期。
 * @returns 需要执行的动作；无事可做时是空数组。
 */
export function planAppLogRotation(plan: AppLogRotationPlan): readonly AppLogRotationAction[] {
  const maxBytes = plan.maxBytes ?? APP_LOG_MAX_BYTES
  const retentionDays = plan.retentionDays ?? APP_LOG_RETENTION_DAYS
  const todayMs = dayStampMs(plan.today)
  const actions: AppLogRotationAction[] = []
  const deleted = new Set<string>()

  for (const entry of plan.entries) {
    const date = logFileDateOf(entry.name)
    if (date === undefined) continue
    const ageDays = (todayMs - dayStampMs(date)) / DAY_MS
    if (!(ageDays >= retentionDays)) continue
    actions.push({ action: 'delete', name: entry.name, reason: 'expired' })
    deleted.add(entry.name)
  }

  const activeName = appLogFileName(plan.today)
  const rotatedName = `${activeName}${APP_LOG_ROTATION_SUFFIX}`
  const active = plan.entries.find(entry => entry.name === activeName)
  if (active !== undefined && active.size > maxBytes) {
    const rotated = plan.entries.find(entry => entry.name === rotatedName)
    if (rotated !== undefined && !deleted.has(rotatedName)) {
      actions.push({ action: 'delete', name: rotatedName, reason: 'replaced' })
      deleted.add(rotatedName)
    }
    actions.push({ action: 'rename', from: activeName, to: rotatedName })
  }
  return actions
}

/** 执行轮转的目标。 */
export interface AppLogRotationTarget {
  /** 日志目录。 */
  readonly directory: string
  /** 今天的日期戳（`YYYY-MM-DD`）。 */
  readonly today: string
  /** 单个动作失败时的出口；缺省忽略（日志写不进去时别把启动一起拖垮）。 */
  readonly onFailure?: (error: unknown) => void
}

/**
 * 执行 {@link planAppLogRotation}：读目录 → 算计划 → 逐个动作。会碰文件系统。
 * @param target - 目录、今天日期与失败出口。
 * @returns 实际尝试的动作（调用方可以记一行日志；用例也可以只看纯函数）。
 */
export function applyAppLogRotation(target: AppLogRotationTarget): readonly AppLogRotationAction[] {
  let entries: readonly AppLogFileEntry[]
  try {
    entries = logDirectoryEntries(target.directory)
  } catch (error) {
    target.onFailure?.(error)
    return []
  }
  const actions = planAppLogRotation({ today: target.today, entries })
  for (const action of actions) {
    try {
      if (action.action === 'delete') rmSync(join(target.directory, action.name), { force: true })
      else renameSync(join(target.directory, action.from), join(target.directory, action.to))
    } catch (error) {
      target.onFailure?.(error)
    }
  }
  return actions
}

/** 目录里认得的日志文件（名字 + 字节数）。 */
function logDirectoryEntries(directory: string): readonly AppLogFileEntry[] {
  return readdirSync(directory)
    .filter(name => APP_LOG_FILE_NAME.test(name))
    .map(name => ({ name, size: statSync(join(directory, name)).size }))
}

/** 从日志文件名取日期；不是本应用的日志文件给 `undefined`。 */
function logFileDateOf(name: string): string | undefined {
  return APP_LOG_FILE_NAME.exec(name)?.[1]
}

/** 日期戳 → UTC 零点的毫秒数（只做日期差，跟时区无关；认不出给 `NaN`）。 */
function dayStampMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return Number.NaN
  return Date.UTC(year, month - 1, day)
}
