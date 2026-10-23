export class AuthorApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AuthorApiError'
  }
}

/**
 * 产品契约失败：与 `@eleckoi/dsh-product-api` 的 `productFailure` 同形。
 *
 * 本 SDK 没有运行期依赖（tsdown 打包），取不到契约包，所以在这里造同形对象：
 * `Error` 实例（调用方仍能按 `instanceof Error` 取诊断）加官方 `RemoteError` 的结构标记
 * `isDSHRemoteError`，`foldFailure` 的 remote 分支按标记保真码与详情。码字符串由调用点
 * 从契约照抄，用例断言与码表一致。
 */
export function contractFailure(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { isDSHRemoteError: true as const, code, details })
}
