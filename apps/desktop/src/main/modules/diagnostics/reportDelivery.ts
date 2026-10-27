/**
 * 报告投递的**纯**配置与文案——不 import `electron`，所以用例能直接跑。
 *
 * 判据（[ADR 0041](../../../../../docs/adr/0041-bug-report-delivery.md) 决定 5）：收件邮箱与收件
 * 仓库由发布配置注入，不写死在仓库里。这里只负责把环境变量读成配置、把 Node 的平台名翻成契约里的
 * 平台名、拼导出文件名。
 *
 * 为什么单独一个文件：`diagnosticsPlugin.ts` 要 import `electron` 才能注册 IPC，而纯函数应当在
 * `node` 环境里就能测。分开之后，插件只做接线。
 */
import type { BugReportEnvironment, BugReportPlatform } from '@shared/contracts/bugReport/report'
import type { BugReportDeliveryConfig } from '@shared/contracts/bugReport/delivery'

/** 收件邮箱的环境变量名（发布配置注入）。 */
export const BUG_REPORT_MAILBOX_ENV = 'ELECKOI_BUG_REPORT_MAILBOX'

/** 收件箱仓库的环境变量名（`owner/name`，发布配置注入）。 */
export const BUG_REPORT_REPOSITORY_ENV = 'ELECKOI_BUG_REPORT_REPOSITORY'

/** 收集时最多回看多少行日志：够覆盖一次崩溃的现场，又不至于把整天的日志读进内存。 */
export const BUG_REPORT_LOG_SCAN_LINES = 2000

/**
 * 读投递配置。
 *
 * @param environment - 环境变量（用例传固定值）。
 * @returns 两个通道；空字符串表示未配置。
 */
export function readBugReportDelivery(
  environment: NodeJS.ProcessEnv = process.env
): BugReportDeliveryConfig {
  return {
    mailbox: (environment[BUG_REPORT_MAILBOX_ENV] ?? '').trim(),
    repository: (environment[BUG_REPORT_REPOSITORY_ENV] ?? '').trim()
  }
}

/**
 * `process.platform` → 报告里的平台名。
 *
 * @param platform - Node 的平台名。
 * @returns 契约里的平台；认不出的一律按 `linux`（报告是给人看的，不是分支依据）。
 */
export function desktopReportPlatform(platform: NodeJS.Platform): BugReportPlatform {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'android') return 'android'
  return 'linux'
}

/** 拼环境段要的输入（用例能给定值，不依赖真机）。 */
export interface DesktopEnvironmentInput {
  readonly appVersion: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly osType: string
  readonly osRelease: string
  readonly electronVersion?: string
  readonly nodeVersion: string
}

/**
 * 拼环境段。
 *
 * @param input - 版本、平台与系统。
 * @returns 报告的环境段。
 */
export function desktopReportEnvironment(input: DesktopEnvironmentInput): BugReportEnvironment {
  const electron = input.electronVersion === undefined ? '' : `Electron ${input.electronVersion} / `
  return {
    appVersion: input.appVersion,
    platform: desktopReportPlatform(input.platform),
    arch: input.arch,
    osVersion: `${input.osType} ${input.osRelease}`,
    runtime: `${electron}Node ${input.nodeVersion}`
  }
}

/**
 * 导出文件的默认名：`eleckoi-report-<YYYYMMDD-HHmmss>.json`。
 *
 * @param now - 取哪个时刻（用例传固定值）。
 * @returns 文件名。
 */
export function exportFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `eleckoi-report-${stamp}.json`
}
