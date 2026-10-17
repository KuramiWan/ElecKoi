/**
 * 边界④（DSH 运行时插件失败出口）的统一出口。
 *
 * 判据来源：`packages/shared/src/contracts/errors/boundaries.ts` 的 `runtime-plugin` 条目——
 * 「插件内的抛出；出口只要求『产出同一个可记录对象』并落到 logger，不新增通道」。
 * 折法只有两条：**已带契约码的失败原样保留**，**未分类失败折成兜底码 `internal`**。
 *
 * ## 这个出口做三件事
 *
 * 1. **折叠**：任意抛出 → 一条带码失败（`isDSHRemoteError` + `code` + `message` + `details`，
 *    与 `@eleckoi/dsh-product-api` 的 `productFailure` 同形）。
 * 2. **落一行日志**：`ctx.logger.warn(...)` 写一行可检索的诊断（标记 + 码 + 开发者文案 +
 *    参数化详情 + 操作名 + 插件名），见 {@link runtimePluginFailureLine}。
 * 3. **仍然抛出**：出口不是吞掉——记录完把同一个失败对象抛出去，cordis / DSH 工具调度照旧看到失败。
 *
 * ## 为什么码表是本地副本
 *
 * 运行时插件由宿主的 Node 直接 import，不经 tsdown/tsc 打包，所以取不到契约包
 * （`@eleckoi/product-shared` 的 exports 指向 `.ts` 源码）。`@eleckoi/dsh-product-api`
 * 虽已在 `apps/desktop/package.json` 里，但它的包根（`lib/types/index.js`，`tsc` 直出）
 * 只转出 `src/index.ts` 的东西——`productFailure` 与码表只在 `/client` 子路径
 * （`lib/client.js`，浏览器 bundle，Node 里 import 会报 `window is not defined`）。
 * 所以这里放一份本地码表，逐字照抄 `packages/shared/src/contracts/errors/codes.ts`
 * （product-api 的 `errorCodes.generated.ts` 是同一份生成物）。守卫在
 * `packages/client/features/dsh-client-roleplay/tests/host/setting-library-runtime-tools.test.js`
 * 的「统一失败出口」用例：两边逐字相等，改码表不改这里会红。
 *
 * ## 为什么抛的是 Error 子类（而不是纯对象）
 *
 * 1. 插件 `apply()` 的抛出会经过 cordis 的 `composeError`/`handleError`
 *    （`@deepseek-ai/cordis/lib/index.js:171-207`）：没有 string `stack` 的抛出会被
 *    `new Error(reason)` 包一层，码和文案都变成 `[object Object]`。Error 子类保住 message 与 stack。
 * 2. 这些文件里已有 `error instanceof Error` 的判定与 `error.message` 的读取
 *    （例如 `patchTool` 的 catch），Error 子类让它们不用改语义。
 * 3. 契约形状照样满足：`isDSHRemoteError` + 字符串码 + `details` 一个不少。
 *
 * ## 它不是 Cordis 插件
 *
 * 文件里没有 `name` / `inject` / `apply`（对比同目录的插件 wrapper）。它是普通 ESM 助手模块，
 * 由本目录两个工具插件 import。登记在 `runtime-manifest.json` 的 `localModules`
 * （`check:dsh-runtime` 会查它在不在）。
 */

/** 诊断行标记。日志里按它检索运行时插件失败；故意不带 `eleckoi/…` 码形态，免得跟码表混淆。 */
export const RUNTIME_PLUGIN_FAILURE_EVENT = 'eleckoi/runtime-plugin-failure'

/**
 * 契约码表的本地副本。
 *
 * 键是 ASCII 名（给代码读），值是线上码字符串；顺序与 `codes.ts` 的声明顺序一致。
 * 不要在这里加码——先改 `packages/shared/src/contracts/errors/codes.ts` 再照抄。
 */
export const ELECKOI_FAILURE_CODES = {
  internal: 'eleckoi/internal',

  contractInvalidRequest: 'eleckoi/contract/invalid-request',
  contractInvalidResponse: 'eleckoi/contract/invalid-response',
  dataShapeInvalid: 'eleckoi/data/shape-invalid',
  dataLegacyMismatch: 'eleckoi/data/legacy-mismatch',

  inputInvalid: 'eleckoi/input/invalid',
  inputUnsupported: 'eleckoi/input/unsupported',

  lookupNotFound: 'eleckoi/lookup/not-found',
  lookupDuplicate: 'eleckoi/lookup/duplicate',
  characterNotFound: 'eleckoi/character/not-found',
  creatorProjectNotFound: 'eleckoi/creator-project/not-found',
  agentPresetNotFound: 'eleckoi/agent-preset/not-found',
  creatorProjectNameTaken: 'eleckoi/creator-project/name-taken',

  conflictStaleRevision: 'eleckoi/conflict/stale-revision',
  stateMismatch: 'eleckoi/state/mismatch',
  statePrecondition: 'eleckoi/state/precondition',

  safetyRefused: 'eleckoi/safety/refused',
  securityDenied: 'eleckoi/security/denied',
  senderUntrusted: 'eleckoi/sender/untrusted',

  lifecycleNotReady: 'eleckoi/lifecycle/not-ready',
  lifecycleDisposed: 'eleckoi/lifecycle/disposed',
  pluginLoadFailed: 'eleckoi/plugin/load-failed',

  ioFailed: 'eleckoi/io/failed',
  netOperationFailed: 'eleckoi/net/operation-failed',
  timeoutExpired: 'eleckoi/timeout/expired',
  storageCorrupt: 'eleckoi/storage/corrupt',
  dbSchemaMismatch: 'eleckoi/db/schema-mismatch',
  modelConfigInvalid: 'eleckoi/model/config-invalid',
  mediaInvalid: 'eleckoi/media/invalid',

  ipcCallFailed: 'eleckoi/ipc/call-failed'
}

const FAILURE_CODE_SET = new Set(Object.values(ELECKOI_FAILURE_CODES))

/** 一条带码失败：与 `productFailure` 同形，但**是** Error（理由见文件头）。 */
export class RuntimePluginFailure extends Error {
  /**
   * @param {string} code - 契约码（只用 {@link ELECKOI_FAILURE_CODES} 里的值）。
   * @param {string} message - 开发者诊断：保留原来那句中文，别删掉——日志靠它定位。
   * @param {object} [details] - 参数化详情，键只用闭集里的八个（契约 `details.ts`）。
   * @param {ErrorOptions} [options] - 传给 `Error` 的 `cause` 等选项。
   */
  constructor(code, message, details = {}, options) {
    super(message, options)
    this.name = 'RuntimePluginFailure'
    /** 线上码字符串。 */
    this.code = code
    /** 参数化详情（扁平 JSON 对象）。 */
    this.details = details
    /** 网关与渲染层认的载体标记（与 `productFailure` 同一个字段）。 */
    this.isDSHRemoteError = true
  }
}

/**
 * 造一条带码失败。
 *
 * @param {string} code - 契约码。
 * @param {string} message - 开发者诊断（原中文句）。
 * @param {object} [details] - 参数化详情。
 * @returns {RuntimePluginFailure} 可直接 `throw` 的失败。
 */
export function runtimePluginFailure(code, message, details = {}) {
  return new RuntimePluginFailure(code, message, details)
}

/** 任意抛出 → 一句开发者诊断（非 Error 的普通对象也认 `message`，与 DSH 的 `errorMessage` 同规则）。 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

/**
 * 是不是一条带码失败：本模块造的实例，或任何契约载体形状（`isDSHRemoteError` + 码表里的字符串码）。
 *
 * @param {unknown} error - 任意抛出。
 * @returns {boolean} 带码时为 true。
 */
export function isCodedFailure(error) {
  if (error instanceof RuntimePluginFailure) return true
  return error !== null && typeof error === 'object' && error.isDSHRemoteError === true
    && typeof error.code === 'string' && FAILURE_CODE_SET.has(error.code)
}

/**
 * 折叠规则（边界④的那两条）：带码的保留码与详情；未分类的折成 `internal`，
 * 若原抛出带着不在码表里的 `code`，把它放进 `details.what`（契约：`what` 记被折叠掉的原码）。
 *
 * @param {unknown} error - 任意抛出。
 * @returns {RuntimePluginFailure} 带码失败。
 */
export function foldRuntimePluginFailure(error) {
  if (error instanceof RuntimePluginFailure) return error
  if (isCodedFailure(error)) {
    return runtimePluginFailure(error.code, messageOf(error), error.details && typeof error.details === 'object' ? error.details : {})
  }
  const foldedCode = error !== null && typeof error === 'object' && typeof error.code === 'string' && !FAILURE_CODE_SET.has(error.code)
    ? { what: error.code }
    : {}
  return runtimePluginFailure(ELECKOI_FAILURE_CODES.internal, messageOf(error), foldedCode)
}

/**
 * 一行可检索的诊断：标记 + 码 + 开发者文案 + 参数化详情 + 操作名 + 插件名，堆栈有就带上。
 *
 * 用 JSON 是刻意的：一行内既能人读（`code` / `message` 挨着），又能被 `grep` 与脚本切成字段。
 *
 * @param {string} plugin - 插件 id（`name` 导出）。
 * @param {string} operation - 失败时正在做的操作（工具名，或补丁里的文件操作名）。
 * @param {RuntimePluginFailure} failure - 折叠后的带码失败。
 * @param {unknown} error - 原始抛出（用来取 stack）。
 * @returns {string} 一行诊断。
 */
export function runtimePluginFailureLine(plugin, operation, failure, error) {
  const stack = error instanceof Error ? error.stack : undefined
  return `${RUNTIME_PLUGIN_FAILURE_EVENT} ${JSON.stringify({
    plugin,
    operation,
    code: failure.code,
    message: failure.message,
    details: failure.details,
    ...(stack === undefined ? {} : { stack })
  })}`
}

/**
 * 折成带码失败、写一行日志、把失败对象返回给调用方（**不在这里抛**）。
 *
 * 记录点统一用插件上下文里的 logger（`ctx.logger.warn`，与同目录其它插件一致）；
 * 没有 logger（例如单测里的假 ctx）时跳过记录，但折叠结果照旧返回。
 *
 * @param {unknown} ctx - 插件上下文（只用到 `ctx.logger`）。
 * @param {string} plugin - 插件 id。
 * @param {string} operation - 操作名。
 * @param {unknown} error - 原始抛出。
 * @returns {RuntimePluginFailure} 折叠后的带码失败。
 */
export function recordRuntimePluginFailure(ctx, plugin, operation, error) {
  const failure = foldRuntimePluginFailure(error)
  ctx?.logger?.warn?.(runtimePluginFailureLine(plugin, operation, failure, error))
  return failure
}

/**
 * 失败出口：记录一行日志后把同一个失败抛出去（出口不是吞掉）。
 *
 * @param {unknown} ctx - 插件上下文。
 * @param {string} plugin - 插件 id。
 * @param {string} operation - 操作名。
 * @param {unknown} error - 原始抛出。
 * @returns {never} 总是抛出。
 */
export function throwRuntimePluginFailure(ctx, plugin, operation, error) {
  throw recordRuntimePluginFailure(ctx, plugin, operation, error)
}

/**
 * 包住插件的 `apply(ctx)`：同步返回**原样透传**（disposer 不能变成 Promise），
 * 同步抛出与 thenable 拒绝都走统一出口。
 *
 * @template T
 * @param {unknown} ctx - 插件上下文。
 * @param {string} plugin - 插件 id。
 * @param {() => T} run - 插件入口体。
 * @returns {T} 入口体的返回值（同步路径）。
 */
export function runRuntimePluginApply(ctx, plugin, run) {
  let returned
  try {
    returned = run()
  } catch (error) {
    throwRuntimePluginFailure(ctx, plugin, 'apply', error)
  }
  if (returned !== null && typeof returned === 'object' && typeof returned.then === 'function') {
    return returned.catch((error) => {
      throwRuntimePluginFailure(ctx, plugin, 'apply', error)
    })
  }
  return returned
}

/**
 * 包住一个工具定义的 `execute`：工具执行期间的任何抛出都走统一出口。
 *
 * 取消不是失败：`exec.signal` 已中止时原样抛出，交给 DSH 的取消出口（它会产出 `ABORTED` 结果），
 * 不记成 `internal`。
 *
 * @template {{ name: string, execute: Function }} T
 * @param {unknown} ctx - 插件上下文。
 * @param {string} plugin - 插件 id。
 * @param {T} definition - `defineTool(...)` 的工具定义。
 * @returns {T} 同一个定义（只换掉 `execute`）。
 */
export function withRuntimePluginExit(ctx, plugin, definition) {
  const execute = definition.execute
  return {
    ...definition,
    async execute(args, exec) {
      try {
        return await execute(args, exec)
      } catch (error) {
        if (exec?.signal?.aborted) throw error
        throwRuntimePluginFailure(ctx, plugin, definition.name, error)
      }
    }
  }
}
