/**
 * 报告投递的线上形状——渲染层与主进程之间那一层。
 *
 * 判据（[ADR 0041](../../../../../docs/adr/0041-bug-report-delivery.md)）：主进程负责收集与脱敏，
 * 渲染层负责展示与选择通道。所以过边界的只有三样东西：**已脱敏的报告**、**通道配置**、**用户的选择**。
 *
 * 两条约束：
 *
 * 1. **报告只从主进程流向渲染层。** 渲染层不拼报告、不改报告；它拿到的那份已经脱敏。导出时主进程
 *    重新收集一遍，不信任渲染层回传的副本。
 * 2. **地址不进渲染层代码，只经这里的数据过去。** 收件邮箱与收件仓库来自发布配置；为空表示该通道
 *    未配置，界面不显示对应按钮。
 */
import type { BugReport } from './report'

/** 代发通道能用的托管服务。都是「客户端公开标识」那一类，不需要自己的服务器。 */
export const BUG_REPORT_RELAY_PROVIDERS = ['web3forms', 'formspree'] as const

/** 代发服务名。 */
export type BugReportRelayProvider = (typeof BUG_REPORT_RELAY_PROVIDERS)[number]

/**
 * 代发通道：由第三方托管服务把报告变成一封邮件。
 *
 * 它解决的是 `mailto:` 最弱的一环——Windows 上没配默认邮件客户端时，`mailto:` 点了没反应。
 * 代价写在 ADR 0041：报告经第三方中转，公开标识可被提取，免费额度有限。
 */
export interface BugReportRelayConfig {
  readonly provider: BugReportRelayProvider
  /** 服务端点（完整 https URL）。 */
  readonly endpoint: string
  /** Web3Forms 的 access key；Formspree 用不到，留空。 */
  readonly accessKey: string
  /** 邮件里显示的发件人名字。 */
  readonly fromName?: string
}

/**
 * 通道配置。空字符串 = 该通道未配置。
 *
 * 邮件目的地可以是一个邮件列表：`mailboxName` 是它在界面上的名字，`subscribeUrl` 让报告人能
 * 自己跟进（邮件通道没有回执，不订阅就跟丢了）。
 */
export interface BugReportDeliveryConfig {
  readonly mailbox: string
  /** 邮件目的地的显示名，例如列表名；空就用「邮件」。 */
  readonly mailboxName?: string
  /** 想跟进这条报告时可以订阅的地址。 */
  readonly subscribeUrl?: string
  readonly repository: string
  /** 代发通道；没配就没有这个字段。 */
  readonly relay?: BugReportRelayConfig
}

/** 代发请求：与预览同形——主进程重新收集，不相信渲染层回传的报告。 */
export interface BugReportSendRequest {
  readonly includeLogTail: boolean
  readonly notes?: string
}

/** 代发结果；失败一律抛，`sent` 为真只表示服务返回了 2xx。 */
export interface BugReportSendResult {
  readonly sent: boolean
}

/** 预览请求：要不要带日志尾、用户补的一句话。 */
export interface BugReportPreviewRequest {
  readonly includeLogTail: boolean
  readonly notes?: string
}

/** 预览结果：已脱敏的报告 + 通道配置。 */
export interface BugReportPreview {
  readonly report: BugReport
  readonly delivery: BugReportDeliveryConfig
}

/** 导出请求：导出永远带日志尾（用户按的就是「把它存下来」）。 */
export interface BugReportExportRequest {
  readonly notes?: string
}

/** 导出结果；用户在保存对话框里取消时 `saved` 为假。 */
export interface BugReportExportResult {
  readonly saved: boolean
  readonly path?: string
}

/** 可以打开的投递通道。 */
export const BUG_REPORT_TARGET_KINDS = ['mail', 'issue'] as const

/** 通道名。 */
export type BugReportTargetKind = (typeof BUG_REPORT_TARGET_KINDS)[number]

/** 要交给系统浏览器或邮件客户端的地址。 */
export interface BugReportExternalTarget {
  readonly kind: BugReportTargetKind
  readonly url: string
}

/** 邮件通道只接受 `mailto:`，issue 通道只接受 GitHub 的 https 地址。 */
const MAIL_URL_PREFIX = 'mailto:'
const ISSUE_URL_PREFIX = 'https://github.com/'

/**
 * 是不是一个可以交给系统的投递地址。
 *
 * 主进程用它挡渲染层送来的任意 URL：只有这两个前缀能进 `shell.openExternal`，所以
 * `file://` 之类不会被打开。
 *
 * @param value - 任意值（跨进程来的载荷必须先校验）。
 * @returns 合法时为 true。
 */
export function isBugReportExternalTarget(value: unknown): value is BugReportExternalTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const fields = value as Record<string, unknown>
  if (fields.kind !== 'mail' && fields.kind !== 'issue') return false
  if (typeof fields.url !== 'string') return false
  const url = fields.url.trim()
  return fields.kind === 'mail'
    ? url.startsWith(MAIL_URL_PREFIX) && url.length > MAIL_URL_PREFIX.length
    : url.startsWith(ISSUE_URL_PREFIX) && url.length > ISSUE_URL_PREFIX.length
}

/**
 * 报告里「有没有可用的通道」。
 *
 * @param config - 通道配置。
 * @returns 至少一条通道配好时为 true。
 */
export function hasBugReportChannel(config: BugReportDeliveryConfig): boolean {
  return config.mailbox.trim() !== '' || config.repository.trim() !== '' || config.relay !== undefined
}

/**
 * 代发服务名是否认识。
 *
 * @param value - 任意值（环境变量或跨进程载荷）。
 * @returns 是 {@link BUG_REPORT_RELAY_PROVIDERS} 里的一员时为 true。
 */
export function isBugReportRelayProvider(value: unknown): value is BugReportRelayProvider {
  return typeof value === 'string' && (BUG_REPORT_RELAY_PROVIDERS as readonly string[]).includes(value)
}
