/**
 * ElecKoi 失败码表——错误契约的规范形态。
 *
 * 判据来源：ADR 0002 决定 14（首批 13 条码的字面值）；spec 决定 6 复述同一张表。
 *
 * **语言中立**：本文件只声明「13 个字符串 + 每个字符串的含义」，任何语言都能照抄。
 * 除本文件与同目录的 `details.ts` / `boundaries.ts` 之外，别处不得再定义失败码字符串——
 * 契约只有一套真相（ADR 0002 决定 1：不新造第二套类型）。
 *
 * 形态 `eleckoi/<域>/<原因>`（全小写、ASCII、连字符分词）。唯一例外是兜底码
 * {@link ELECKOI_FALLBACK_FAILURE_CODE}，它只有两段。
 *
 * 落点说明：ADR 0002 决定 7 要求「纯枚举住 `product-shared`，不住 `dsh-product-api`」；
 * spec 决定 1 把这个子目录钉在 `product-shared/src/contracts/errors/`。
 */

/** 首批 13 条失败码。键是 ASCII 名（给代码读），值是上线的码字符串（给跨语言实现照抄）。 */
export const ELECKOI_FAILURE_CODES = {
  /** 兜底：不属于任何已点名语义的失败。详情见 `details.ts` 的 `EleckoiInternalDetails`。 */
  internal: 'eleckoi/internal',
  /** 调用方送进来的载荷不合合同。详情带 `issues`。 */
  contractInvalidRequest: 'eleckoi/contract/invalid-request',
  /** 服务返回的载荷不合合同。详情带 `issues`。 */
  contractInvalidResponse: 'eleckoi/contract/invalid-response',
  /** 用户输入不合法。详情带 `field`。 */
  inputInvalid: 'eleckoi/input/invalid',
  /** 乐观并发校验失配：东西在别处被改过。详情带 `what`。 */
  conflictStaleRevision: 'eleckoi/conflict/stale-revision',
  /** 创建创作项目时目标目录已存在同名目录。详情带 `path`。 */
  creatorProjectNameTaken: 'eleckoi/creator-project/name-taken',
  /** 文件系统或外部 IO 操作失败。详情带 `operation` / `path`。 */
  ioFailed: 'eleckoi/io/failed',
  /** 护栏拒绝执行（不是「执行了但失败」）。详情带 `guard`。 */
  safetyRefused: 'eleckoi/safety/refused',
  /** 存储里的内容损坏，无法解析。详情带 `what`。 */
  storageCorrupt: 'eleckoi/storage/corrupt',
  /** 找不到角色。详情带 `what`。 */
  characterNotFound: 'eleckoi/character/not-found',
  /** 找不到创作项目。详情带 `what`。 */
  creatorProjectNotFound: 'eleckoi/creator-project/not-found',
  /** 找不到 Agent 预设。详情带 `what`。 */
  agentPresetNotFound: 'eleckoi/agent-preset/not-found',
  /** 调用来自不可信的渲染进程 / frame。详情带 `what`。 */
  senderUntrusted: 'eleckoi/sender/untrusted'
} as const

/** 13 条码的联合类型。 */
export type EleckoiFailureCode = typeof ELECKOI_FAILURE_CODES[keyof typeof ELECKOI_FAILURE_CODES]

/**
 * 13 条码的固定清单，顺序与 ADR 0002 决定 14 的列举顺序一致。
 * 跨语言实现、文档表格、逐条断言都该用这份顺序，别各自重排。
 */
export const ELECKOI_FAILURE_CODE_LIST = [
  ELECKOI_FAILURE_CODES.internal,
  ELECKOI_FAILURE_CODES.contractInvalidRequest,
  ELECKOI_FAILURE_CODES.contractInvalidResponse,
  ELECKOI_FAILURE_CODES.inputInvalid,
  ELECKOI_FAILURE_CODES.conflictStaleRevision,
  ELECKOI_FAILURE_CODES.creatorProjectNameTaken,
  ELECKOI_FAILURE_CODES.ioFailed,
  ELECKOI_FAILURE_CODES.safetyRefused,
  ELECKOI_FAILURE_CODES.storageCorrupt,
  ELECKOI_FAILURE_CODES.characterNotFound,
  ELECKOI_FAILURE_CODES.creatorProjectNotFound,
  ELECKOI_FAILURE_CODES.agentPresetNotFound,
  ELECKOI_FAILURE_CODES.senderUntrusted
] as const

/**
 * 兜底码。ADR 0002 决定 7 说「通用码只做兜底」，所以它是唯一只有两段的码：
 * 任何边界遇到无法判别的失败都折成它（`details.what` 记原码做诊断）。
 */
export const ELECKOI_FALLBACK_FAILURE_CODE = ELECKOI_FAILURE_CODES.internal

/**
 * 码的形态：`eleckoi/<域>/<原因>`；`eleckoi/internal` 是文档化的例外（兜底码只有两段）。
 * 域与原因都是小写 ASCII、以连字符分词。
 */
export const ELECKOI_FAILURE_CODE_PATTERN = /^eleckoi\/(?:internal|[a-z][a-z-]*\/[a-z][a-z-]*)$/

const ELECKOI_FAILURE_CODE_SET: ReadonlySet<string> = new Set(Object.values(ELECKOI_FAILURE_CODES))

/**
 * 运行期判定一个字符串是不是码表里的码。
 * 跨边界收码时才用得到它（例如结构上像 RemoteError 但码不在表里的失败要兜底，
 * 不能把未知码原样传下去——`foldFailure` 就是这么用的）。
 */
export function isEleckoiFailureCode(value: string): value is EleckoiFailureCode {
  return ELECKOI_FAILURE_CODE_SET.has(value)
}
