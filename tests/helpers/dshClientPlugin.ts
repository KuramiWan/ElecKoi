/**
 * 装载一个 `dsh-client-*` 的 `src/client.js`（`window.__ModuleLoader__.load` 形态），
 * 并把 `factory(require)` 里允许解析的模块交给它。
 *
 * `@eleckoi/dsh-product-api/client` 是**必须**给的那一个：`dsh-client-*` 里凡有 unwrap 的都从那里
 * 取「信封拆解」与「信封不成立」的折叠函数（ADR 0002 决定 8；票 EH-4a，票 EH-11 的 E 项）。它在真实
 * 页面里已经是 desktop profile 的 bundle 成员、每个插件又都 inject 了它，所以 `require` 解析得到；
 * 用例里由本助手从**构建产物**物化后交给它——这样断言的是真产物里的那一份实现，不是用例里另写的一份。
 */
import { loadProductApiClient } from './productApiClientBundle'

/** 真实产物里的公开导出（形状见 `packages/dsh-product-api/src/client/`）。 */
export interface ProductApiClientModule {
  invalidResponseFailure: (what: string, path?: string) => {
    readonly isDSHRemoteError: true
    readonly code: string
    readonly message: string
    readonly details: Readonly<Record<string, unknown>>
  }
  /** 信封拆解（票 EH-11 的 E 项）：成功给值，失败抛 `result.error` 或折出的契约失败。 */
  unwrapOrFail: (
    result: { readonly ok?: boolean; readonly value?: unknown; readonly error?: unknown } | null | undefined,
    what: string
  ) => unknown
  /** 上面那条拆解的失败分支（用例直接验它抛的是什么）。 */
  failureOrInvalidResponse: (error: unknown, what: string) => unknown
}

/** 产物里那个模块在整个测试进程里只需物化一次。 */
let productApiClient: ProductApiClientModule | undefined

/** 取出 `@eleckoi/dsh-product-api/client` 的公开导出（首次调用时从产物物化）。 */
export function productApiClientModule(): ProductApiClientModule {
  productApiClient ??= loadProductApiClient<ProductApiClientModule>()
  return productApiClient
}

/** `window.__ModuleLoader__.load` 收到的注册项。 */
interface ClientPluginRegistration {
  readonly factory: (require: (name: string) => unknown) => {
    readonly apply: (context: Record<string, unknown>) => unknown
  }
}

/** `factory(require)` 认得的名字 → 模块。 */
function clientModules(): Readonly<Record<string, unknown>> {
  return {
    react: { createElement: () => null, lazy: () => () => null },
    '@eleckoi/dsh-product-api/client': productApiClientModule()
  }
}

export function dshClientPlugin(registration: ClientPluginRegistration) {
  const modules = clientModules()
  const plugin = registration.factory((name: string) => {
    if (Object.hasOwn(modules, name)) return modules[name]
    throw new Error(`Unexpected client module ${name}`)
  })
  return {
    apply: (context: Record<string, unknown>) => plugin.apply({
      slots: { inject: () => {} },
      ...context,
    }),
  }
}
