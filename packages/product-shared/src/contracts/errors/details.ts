/**
 * 每条失败码的**参数化详情**形状。
 *
 * 判据来源：ADR 0002 决定 14（每条码该带哪些参数）；spec 决定 6（`field` / `issues` / `path` /
 * `operation` / `guard` / `what` 这六个参数名）。
 *
 * 两条硬约束，跨语言实现也要守：
 *
 * 1. **详情是给程序看的，不是拼好的句子。** 契约只放参数，用户可见文案只有一个解析点
 *    （渲染层，ADR 0002 决定 4）。宿主永不拼用户可见句子。
 * 2. **顶层必须是扁平 JSON 对象。** 线上只校验 `z.record(z.string(), z.unknown())`
 *    （`packages/dsh-client-connection`），且失败信封要被 `JSON.stringify` 过一遍。
 *    所以详情里不放 `undefined`、函数、`Date`、类实例、循环引用。
 *
 * 参数名闭集（ADR 0002 决定 14）：`field` / `issues` / `path` / `operation` / `guard` / `what`。
 * 不在这六个里的新参数属于契约变更——先改 ADR，再动这里。
 */

import { ELECKOI_FAILURE_CODES } from './codes.js'

/**
 * 一条合同违例。
 *
 * 从 codec（zod 之类）的输出投影而来，只保留能过 JSON 的两项：
 * `path` 是失败字段的路径（点号连接；整个载荷失败时是空字符串），`message` 是 codec 的原文诊断。
 * 不在这里改写文案——codec 说什么就是什么。
 */
export interface EleckoiFailureIssue {
  readonly path: string
  readonly message: string
}

/** 兜底码的详情：`what` 记被折叠掉的原码或短诊断种类。 */
export interface EleckoiInternalDetails {
  readonly what?: string
}

/** 合同违例（入参或出参）的详情：codec 给出的逐条 issues。 */
export interface EleckoiContractIssueDetails {
  readonly issues: readonly EleckoiFailureIssue[]
}

/** 用户输入不合法的详情：`field` 是出问题的字段名。 */
export interface EleckoiInputInvalidDetails {
  readonly field: string
}

/** 乐观并发失配的详情：`what` 是被改过的那种资源（如 `regex-rules`）。 */
export interface EleckoiStaleRevisionDetails {
  readonly what: string
}

/** 同名目录已存在的详情：`path` 是已存在的那个目录。 */
export interface EleckoiCreatorProjectNameTakenDetails {
  readonly path: string
}

/** IO 失败的详情：`operation` 是动作（`read` / `write` / `delete` / `spawn` …），`path` 有就带上。 */
export interface EleckoiIoFailedDetails {
  readonly operation: string
  readonly path?: string
}

/** 护栏拒绝的详情：`guard` 是拒绝执行的那道护栏（如 `untrusted-sender`）。 */
export interface EleckoiSafetyRefusedDetails {
  readonly guard: string
}

/** 存储损坏的详情：`what` 是损坏的东西（如 `creator-project-index`）。 */
export interface EleckoiStorageCorruptDetails {
  readonly what: string
}

/** 找不到东西的详情：`what` 是调用方请求的标识（角色 id / 项目 id / 预设 id）。 */
export interface EleckoiNotFoundDetails {
  readonly what: string
}

/** 不可信发送方的详情：`what` 是观察到的发送方身份（frame URL / origin），`guard` 是拒绝执行的那条守卫。 */
export interface EleckoiSenderUntrustedDetails {
  readonly what: string
  readonly guard: string
}

/**
 * 码 → 详情形状。这是 `RemoteErrorDetailsMap` 声明合并的真相来源
 * （ADR 0002 决定 7：合并本身住 `packages/dsh-product-api/`，形状住这里）。
 */
export interface EleckoiFailureDetailsMap {
  [ELECKOI_FAILURE_CODES.internal]: EleckoiInternalDetails
  [ELECKOI_FAILURE_CODES.contractInvalidRequest]: EleckoiContractIssueDetails
  [ELECKOI_FAILURE_CODES.contractInvalidResponse]: EleckoiContractIssueDetails
  [ELECKOI_FAILURE_CODES.inputInvalid]: EleckoiInputInvalidDetails
  [ELECKOI_FAILURE_CODES.conflictStaleRevision]: EleckoiStaleRevisionDetails
  [ELECKOI_FAILURE_CODES.creatorProjectNameTaken]: EleckoiCreatorProjectNameTakenDetails
  [ELECKOI_FAILURE_CODES.ioFailed]: EleckoiIoFailedDetails
  [ELECKOI_FAILURE_CODES.safetyRefused]: EleckoiSafetyRefusedDetails
  [ELECKOI_FAILURE_CODES.storageCorrupt]: EleckoiStorageCorruptDetails
  [ELECKOI_FAILURE_CODES.characterNotFound]: EleckoiNotFoundDetails
  [ELECKOI_FAILURE_CODES.creatorProjectNotFound]: EleckoiNotFoundDetails
  [ELECKOI_FAILURE_CODES.agentPresetNotFound]: EleckoiNotFoundDetails
  [ELECKOI_FAILURE_CODES.senderUntrusted]: EleckoiSenderUntrustedDetails
}

/** 任意一条码的详情形状。 */
export type EleckoiFailureDetails = EleckoiFailureDetailsMap[keyof EleckoiFailureDetailsMap]
