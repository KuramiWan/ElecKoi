/**
 * 边界翻译规则表——①–⑥ 每条边界把哪些失败折成什么码。
 *
 * 判据来源：ADR 0002 决定 2（边界闭集 ①–⑥）/ spec 决定 4；兜底规则见 ADR 决定 7。
 * 这张表是规格的**机器可读副本**，不是散文：改规则先改 ADR，再改这里。
 *
 * 闭集的其余四项在这份文件里体现为形状而不是条目：
 *
 * - ⑦ 观测：每条边界的产物都是**同一个可记录对象** `EleckoiFailure`
 *   （`{ code, message, details }`，见 `packages/product-shared/src/foundation/failure.ts`），
 *   所以任何边界都能直接喂 logger；
 * - ⑧ 测试与闸：EH-9 的 `check:error-contract`；
 * - ⑨ Android：本目录只声明可被照抄的合同，不写实现、不建机制；
 * - ⑩ 第三方插件内部：**排除**，不是我们的边界。
 *
 * 三个术语，全表一致：
 *
 * - **folds**：这条边界认识的失败 → 它该变成的契约码；`code: null` 表示**不折**，
 *   保留失败自己带的码与详情（前提是它已经带契约码）；
 * - **fallback**：没在上面命中的失败，一律折成兜底码 `eleckoi/internal`，
 *   并在 `details.what` 里记下原码或短诊断种类——**不许猜**成某个域码；
 * - **adapter**：这条边界上那层薄适配器的落点（只做翻译，不做第二套信封；
 *   ADR 0017 第 7 条与 ADR 0002 决定 1 都明令不得重建业务通道）。
 */

import { ELECKOI_FAILURE_CODES, type EleckoiFailureCode } from './codes.js'

/** 边界闭集 ①–⑥ 的稳定标识（ASCII，别用序号当键）。 */
export type EleckoiBoundaryId =
  | 'domain-throw'
  | 'host-remote-exit'
  | 'host-dsh-subprocess'
  | 'runtime-plugin'
  | 'electron-ipc'
  | 'renderer'

/** 一种失败的折法。 */
export interface EleckoiBoundaryFold {
  /** 这条边界上的一种失败；写「判断依据」而不是文案。 */
  readonly when: string
  /** 折成的契约码；`null` = 不折，保留失败自带的码与详情。 */
  readonly code: EleckoiFailureCode | null
}

/** 一条边界。 */
export interface EleckoiBoundary {
  readonly id: EleckoiBoundaryId
  /** ADR 0002 决定 2 / spec 决定 4 的闭集编号 ①–⑥。 */
  readonly ordinal: 1 | 2 | 3 | 4 | 5 | 6
  /** 边界名（中文，用于文档与失败信息）。 */
  readonly title: string
  /** 这层薄适配器的落点（路径 + 负责的票）。 */
  readonly adapter: string
  /** 失败在这条边界上以什么形态移动。 */
  readonly carries: string
  readonly folds: readonly EleckoiBoundaryFold[]
  /** 未命中 folds 的失败一律折成它。 */
  readonly fallback: EleckoiFailureCode
}

export const ELECKOI_BOUNDARIES = [
  {
    id: 'domain-throw',
    ordinal: 1,
    title: '领域内抛出',
    adapter: '@eleckoi/dsh-product-data 的仓储与领域服务抛出点（EH-3）',
    carries: '进程内的 throw；失败在这里第一次获得契约码与参数化详情',
    folds: [
      { when: '入参不合合同（zod / codec 失败）', code: ELECKOI_FAILURE_CODES.contractInvalidRequest },
      { when: '返回的载荷不合合同（zod / codec 失败）', code: ELECKOI_FAILURE_CODES.contractInvalidResponse },
      { when: '用户输入不合法', code: ELECKOI_FAILURE_CODES.inputInvalid },
      { when: '乐观并发校验失配', code: ELECKOI_FAILURE_CODES.conflictStaleRevision },
      { when: '目标目录已存在同名目录', code: ELECKOI_FAILURE_CODES.creatorProjectNameTaken },
      { when: '请求的角色不存在', code: ELECKOI_FAILURE_CODES.characterNotFound },
      { when: '请求的创作项目不存在', code: ELECKOI_FAILURE_CODES.creatorProjectNotFound },
      { when: '请求的 Agent 预设不存在', code: ELECKOI_FAILURE_CODES.agentPresetNotFound },
      { when: '文件系统或外部 IO 调用失败', code: ELECKOI_FAILURE_CODES.ioFailed },
      { when: '护栏拒绝执行', code: ELECKOI_FAILURE_CODES.safetyRefused },
      { when: '存储内容损坏、解析不出来', code: ELECKOI_FAILURE_CODES.storageCorrupt },
      { when: '已带契约码的失败', code: null }
    ],
    fallback: ELECKOI_FAILURE_CODES.internal
  },
  {
    id: 'host-remote-exit',
    ordinal: 2,
    title: '宿主 Remote 出口',
    adapter: '@eleckoi/dsh-product-api 的 RemoteErrorDetailsMap 声明合并与 new RemoteError(...)（EH-2）',
    carries: '官方 RemoteError{code,message,details}；网关把任何非 RemoteError 的抛出统一折成 '
      + 'gateway/internal（dsh-api-gateway/lib/index.js:1425-1443），所以领域失败必须在这条边界上变成 RemoteError',
    folds: [
      { when: '已带契约码的失败（DesktopError 或 RemoteError 形状）', code: null },
      {
        when: '入参 codec 失败（网关 gateway/arguments-invalid，或 DSH controller 的 gateway/input-invalid）',
        code: ELECKOI_FAILURE_CODES.contractInvalidRequest
      },
      { when: '出参 codec 失败（网关 gateway/result-invalid）', code: ELECKOI_FAILURE_CODES.contractInvalidResponse },
      {
        when: '网关载体码 gateway/bad-request（DSH controller 的入参 codec 失败，详情就是 { issues }）',
        code: ELECKOI_FAILURE_CODES.contractInvalidRequest
      },
      { when: '网关载体码 gateway/internal 或 gateway/cancelled', code: ELECKOI_FAILURE_CODES.internal },
      { when: '码不在契约码表里（例如更新的宿主发来的码）', code: ELECKOI_FAILURE_CODES.internal }
    ],
    fallback: ELECKOI_FAILURE_CODES.internal
  },
  {
    id: 'host-dsh-subprocess',
    ordinal: 3,
    title: '宿主 ↔ DSH 子进程协议',
    adapter: 'apps/desktop-host/src/hostSessionProtocol.ts 与 desktopPluginHost{,Child}.ts（EH-6）',
    carries: 'fatal 帧从 { message } 扩为 { code?, message, stack?, logPath? }，protocolVersion 升到 2'
      + '（ADR 决定 10 / spec 决定 9）；诊断用 logPath 指针加 stack 承载，不把整段日志塞进消息',
    folds: [
      { when: 'fatal 帧带契约码', code: null },
      { when: 'fatal 帧未带码', code: ELECKOI_FAILURE_CODES.internal },
      { when: '协议版本偏斜或握手失败', code: ELECKOI_FAILURE_CODES.internal },
      { when: '子进程未产出可读诊断（logPath 缺失或读不到）', code: ELECKOI_FAILURE_CODES.internal }
    ],
    fallback: ELECKOI_FAILURE_CODES.internal
  },
  {
    id: 'runtime-plugin',
    ordinal: 4,
    title: 'DSH 运行时插件失败出口',
    adapter: 'apps/desktop/resources/dsh/ 下的 Cordis overlay 插件与观测出口 AppLog（EH-7）',
    carries: '插件内的抛出；出口只要求「产出同一个可记录对象」并落到 logger，不新增通道',
    folds: [
      { when: '插件抛出已带契约码的失败', code: null },
      { when: '插件抛出未分类失败', code: ELECKOI_FAILURE_CODES.internal }
    ],
    fallback: ELECKOI_FAILURE_CODES.internal
  },
  {
    id: 'electron-ipc',
    ordinal: 5,
    title: '主进程 ↔ 渲染层（Electron IPC）',
    adapter: 'apps/desktop/src/preload/preload.ts 与 apps/desktop/src/main/modules/ 的 IPC 处理（EH-5）',
    carries: '结构化克隆的失败对象；发送方不可信，先验身份再看载荷'
      + '（apps/desktop/src/main/platform/electron/validateSender.ts）',
    folds: [
      { when: '发送方不是可信的 ElecKoi 页面或 frame', code: ELECKOI_FAILURE_CODES.senderUntrusted },
      { when: '入参不合合同（zod 失败）', code: ELECKOI_FAILURE_CODES.contractInvalidRequest },
      { when: '通道不存在或调用形态不对', code: ELECKOI_FAILURE_CODES.internal },
      { when: '主进程侧失败已带契约码', code: null }
    ],
    fallback: ELECKOI_FAILURE_CODES.internal
  },
  {
    id: 'renderer',
    ordinal: 6,
    title: '渲染层（apps/web 与 12 个 dsh-client-*）',
    adapter: 'packages/dsh-client-*/src/client.js 的 unwrap（throw result.error）与 apps/web 的失败面（EH-4）',
    carries: '官方 RemoteResult 的 ok:false 分支重建出 RemoteError 实例；这条边界不得再拆信封'
      + '（只留 message）——用户可见文案的解析点就在这里（ADR 决定 4）',
    folds: [
      { when: 'RemoteError 形状（isDSHRemoteError === true 且有 string code）', code: null },
      { when: '结构上不带码的失败', code: ELECKOI_FAILURE_CODES.internal },
      { when: '本层抛出的契约失败', code: null },
      // 第四条折法（EH-11 的 I 项补进来）：`RemoteResult` 的信封本身不成立——`result` 缺失，或 `ok`
      // 不是真而 `error` 缺失 / 不可用。实现在 `packages/dsh-product-api/src/client/invalidResponse.ts`
      // 的 `invalidResponseFailure(what, path)`，由 9 个 `dsh-client-*` 经 `unwrapOrFail` 调用；
      // 详情是 `{ issues: [{ path, message }] }`，`path` 是 `result` 或 `result.error`。
      {
        when: '信封本身不成立（result 缺失，或 ok 不是真而 error 缺失/不可用）',
        code: ELECKOI_FAILURE_CODES.contractInvalidResponse
      }
    ],
    fallback: ELECKOI_FAILURE_CODES.internal
  }
] as const satisfies readonly EleckoiBoundary[]
