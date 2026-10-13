/**
 * 用户可见文案的**唯一解析点**（渲染层）。
 *
 * 判据来源：ADR 0002 决定 4/8（契约只给码 + 参数化详情 + 开发者诊断文案；**用户可见文案只有一个
 * 解析点，在渲染层**，宿主侧永不拼用户可见句子）、spec 决定 8、票 EH-4b 第 1 节。
 *
 * 这一层只做三件事，别的什么都不做：
 *
 * 1. **折叠**：交给 EH-1 的 `foldFailure`（`@eleckoi/product-shared` 的纯函数）。**不在这里再写一份码表**
 *    ——码字符串的唯一真相是 `@shared/contracts/errors/codes`；本文件只把码映射成句子。
 * 2. **说人话**：按码给一句用户可见文案（`text`）。认不出的码只给一句通用说法（`foldFailure` 已把它折成
 *    兜底码并把原码放进 `details.what`，所以原码不会被吞）。真正的裸 `Error`（没有码语义）才用它的
 *    `message` 当文案——这是唯一能让用户知道发生了什么的东西。
 * 3. **给出口**：`code` / `details` 原样交给界面展示与复制，`diagnostic` 给日志。
 *
 * 输入可以是任何抛出值：`RemoteError` 形状（`{ isDSHRemoteError: true, code, message, details }`）、
 * `DesktopError`、裸 `Error`、字符串、`null`、普通对象。**永不抛**。
 */
import { ELECKOI_FAILURE_CODES, ELECKOI_FALLBACK_FAILURE_CODE } from "@shared/contracts/errors/codes";
import { foldFailure } from "@shared/foundation/failure";

/** 认不出语义时的通用说法（不是某个码的文案）。 */
export const GENERIC_FAILURE_TEXT = "操作失败，请重试。";

/** 日志里用来检索渲染层失败的标记（不是失败码，故意不带 `eleckoi/` 前缀以免与码表混淆）。 */
export const RENDERER_FAILURE_LOG_MARKER = "eleckoi-renderer-failure";

/** IO 动作 → 用户能懂的说法。只认识 ADR 决定 14 给的 `operation` 取值，其余走通用说法。 */
const IO_OPERATION_TEXTS = {
  read: "读取失败",
  write: "保存失败",
  delete: "删除失败",
  spawn: "启动失败",
};

/**
 * 码 → 用户可见说法。键用 `ELECKOI_FAILURE_CODES` 的常量（**不是**重写的字面量：
 * 码字符串只有契约那一份真相）。兜底码不在表里，它走"开发者诊断"那条分支。
 */
const FAILURE_TEXTS = {
  [ELECKOI_FAILURE_CODES.contractInvalidRequest]: () => "请求内容不符合要求，已拒绝。",
  [ELECKOI_FAILURE_CODES.contractInvalidResponse]: () => "服务返回的内容不符合要求，已拒绝。",
  [ELECKOI_FAILURE_CODES.inputInvalid]: (details) => {
    const field = detailString(details.field);
    return field ? `输入不合法：${field}。` : "输入不合法。";
  },
  [ELECKOI_FAILURE_CODES.conflictStaleRevision]: (details) => {
    const what = detailString(details.what);
    return what ? `${what} 已在别处被修改，请刷新后重试。` : "内容已在别处被修改，请刷新后重试。";
  },
  [ELECKOI_FAILURE_CODES.creatorProjectNameTaken]: (details) => {
    const path = detailString(details.path);
    return path ? `保存位置已存在同名目录：${path}。` : "保存位置已存在同名目录。";
  },
  [ELECKOI_FAILURE_CODES.ioFailed]: (details) => {
    const path = detailString(details.path);
    return `${IO_OPERATION_TEXTS[detailString(details.operation)] || "读写失败"}${path ? `：${path}` : ""}。`;
  },
  [ELECKOI_FAILURE_CODES.safetyRefused]: (details) => {
    const guard = detailString(details.guard);
    return guard ? `操作被拒绝：${guard}。` : "操作被拒绝。";
  },
  [ELECKOI_FAILURE_CODES.storageCorrupt]: (details) => {
    const what = detailString(details.what);
    return what ? `存储内容损坏，无法读取：${what}。` : "存储内容损坏，无法读取。";
  },
  [ELECKOI_FAILURE_CODES.characterNotFound]: () => "角色不存在或已被删除。",
  [ELECKOI_FAILURE_CODES.creatorProjectNotFound]: () => "创作项目不存在或已被删除。",
  [ELECKOI_FAILURE_CODES.agentPresetNotFound]: () => "Agent 预设不存在或已被删除。",
  [ELECKOI_FAILURE_CODES.senderUntrusted]: () => "该操作被拒绝：调用来源不可信。",
};

/**
 * 把一个失败解析成界面与日志都能用的形状。
 *
 * - `text`：给用户的一句话（按码给；见文件头）；
 * - `code` / `details`：契约形态，原样给出供界面展示与复制；
 * - `diagnostic`：给日志的一行（可检索标记 + 码 + 开发者诊断 + 参数化详情）。
 *
 * `options.fallback` 是调用方对这次操作的称法（如「保存失败」），只在**给不出任何说法**时使用。
 */
export function resolveFailure(failure, options = {}) {
  const folded = foldFailure(failure);
  return {
    text: userText(failure, folded, fallbackText(options.fallback)),
    code: folded.code,
    details: folded.details,
    diagnostic: `${RENDERER_FAILURE_LOG_MARKER} [${folded.code}] ${folded.message}${detailSuffix(folded.details)}`,
  };
}

/**
 * 只要一句话时的入口（原三份分叉 `errorMessage` / `getErrorMessage` 的收口点）。
 * 行为差异逐条对照 `notes/eh-explore-renderer.md` §7.2 的表格；测试在 `tests/failure-text.test.js`。
 */
export function failureMessage(failure, fallback = "") {
  return resolveFailure(failure, { fallback }).text;
}

/**
 * 详情 → `[{ key, label, value }]`，供界面逐条展示与复制。
 * `label` 就是契约的参数名（`operation` / `path` / …）：维护者要的就是这些原始键。
 */
export function failureDetailLines(details) {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return [];
  return Object.keys(details)
    .filter((key) => details[key] !== undefined && details[key] !== null)
    .map((key) => ({ key, label: key, value: detailValueText(details[key]) }));
}

/** 详情 → 一行可复制的文本。 */
export function formatFailureDetails(details) {
  return failureDetailLines(details).map(({ label, value }) => `${label}: ${value}`).join("；");
}

/**
 * 给**没有界面出口**的失败留落点：把诊断串交给 `console.error`。
 * Electron 的主窗口会把这个 console 消息转发进主进程日志（`mainWindowPlugin.ts` 的
 * `webContents.on('console-message')`），所以不需要为它新建 IPC 通道（ADR 0017 决定 7）。
 */
export function reportFailure(failure, context = "") {
  const resolved = resolveFailure(failure);
  console.error(`${context ? `[${context}] ` : ""}${resolved.diagnostic}`);
  return resolved;
}

/**
 * 渲染层未处理拒绝的落点（ADR 0002 决定 12 最后一条 / spec 决定 10）。
 * 只报告、不 `preventDefault`：开发者工具里仍然看得到原始栈。
 */
export function installUnhandledFailureReporting(target = window) {
  target.addEventListener("unhandledRejection", (event) => {
    reportFailure(event ? event.reason : undefined, "渲染层未处理的拒绝");
  });
}

function userText(failure, folded, fallback) {
  const describe = FAILURE_TEXTS[folded.code];
  if (describe) return describe(folded.details);
  // 兜底码带 details.what = 有一个码被折掉了（`foldFailure` 的未知码路径）。不猜它的语义，
  // 只给通用说法；原码由 `code`/`details` 带出去。
  if (detailString(folded.details.what)) return fallback;
  // 真正的裸失败（没有码语义）：它的 message 是唯一能让用户知道发生了什么的东西。
  return developerMessage(failure) || fallback;
}

/**
 * 从抛出值里取**开发者写明的** message。三种形态认得：字符串、`Error`、带 string `message` 的对象
 * （`RemoteError` 形状 / DSH 的错误对象）。
 *
 * 故意**不**用 `foldFailure` 的 `message`：那种 message 对非 `Error` 输入是 `String(value)`，
 * 会把 `null` / `[object Object]` 这类东西当文案给用户（契约要求 `message` 非空，但那是给开发者诊断的）。
 */
function developerMessage(failure) {
  if (typeof failure === "string") return failure.trim();
  if (failure instanceof Error) return failure.message.trim();
  if (typeof failure === "object" && failure !== null && typeof failure.message === "string") {
    return failure.message.trim();
  }
  return "";
}

function fallbackText(fallback) {
  const text = typeof fallback === "string" ? fallback.trim() : "";
  return text || GENERIC_FAILURE_TEXT;
}

function detailSuffix(details) {
  const formatted = formatFailureDetails(details);
  return formatted ? `（${formatted}）` : "";
}

function detailString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function detailValueText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}
