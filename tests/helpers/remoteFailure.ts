/**
 * 造一个**真实形态**的 Remote 失败：官方 `RemoteError` 是 `Error` 的子类，
 * 带结构标记 `isDSHRemoteError`、`code` 与 `details`（`@deepseek-ai/dsh-typert-protocol`）。
 *
 * 用例里给它普通对象会失真：客户端读 `error.message` 走的是 `error instanceof Error ? … : String(error)`，
 * 普通对象会被 `String()` 成 `[object Object]`。所以这里给**真的 `Error` 实例**加那两个属性。
 */
export function remoteFailure(code: string, message: string, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { isDSHRemoteError: true as const, code, details })
}
