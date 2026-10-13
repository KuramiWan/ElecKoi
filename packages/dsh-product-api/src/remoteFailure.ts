/**
 * 边界②：宿主的 **Remote 出口**——把领域失败翻译成网关认得的 `RemoteError`。
 *
 * 判据来源：ADR 0002 决定 5/7/8/9、spec 决定 4/5；规则表是
 * `@eleckoi/product-shared/contracts/errors/boundaries.ts` 里 `host-remote-exit` 那一条，
 * 折叠本身复用 `@eleckoi/product-shared/foundation/failure.ts` 的 `foldFailure`——
 * **折叠规则是契约的一部分，这条边界只放薄适配器，不实现第二份。**
 *
 * ## 为什么必须在这条边界上翻译
 *
 * 网关的折叠函数 `rpcFailure`（`@deepseek-ai/dsh-api-gateway/lib/index.js:1425-1443`）是模块私有的、
 * 不导出；`TypertGatewayService.Config` 只有两个数字字段、没有错误映射钩子；`/api` 每个通道只准一个
 * interceptor 而那一个已经被网关自己占了（`dsh-client-connection/lib/index.js:665`）。⇒ 产品侧没有
 * "在出口处拦截"的位置。唯一的绕过路径是**结构标记**：`remoteErrorOf` 认
 * `{ isDSHRemoteError: true, code: string }`，命中则 `code`/`message`/`details` 线上**原样透传**；
 * 其它一切（`DesktopError`、`ZodError`、裸 `Error`、字符串）都被换成
 * `{ code: 'gateway/internal', message: <原文案>, details: {} }`——**码与详情不是被改写，是被丢掉**。
 * 证据：`notes/eh-explore-remote.md` §1、§2、§3。
 *
 * 所以翻译只能发生在**抛出方法自己身上**：网关每次调用都重新
 * `const method = Reflect.get(callReceiver, implementation)`（`lib/index.js:986-988`），
 * "服务实例在调用时暴露什么方法"是产品可以决定的。
 *
 * ## 形态：`installRemoteFailureTranslation(instance)`，11 个服务类在构造函数里各调一次
 *
 * ⚠️ **票里推荐的"基类"形态做不到**（实测）。Typert 描述符生成器要求带 `@Remote` 的类**自己的
 * heritage 子句**解析到上游的 `TypertRemoteService`，且该符号的声明必须在
 * `node_modules/@deepseek-ai/dsh-typert-protocol/` 里（`gatewayServiceBinding` +
 * `isTypeMetaSymbol`，`@deepseek-ai/dsh-typert-generator/lib/index.js:812-824`、`1395-1407`）——
 * 本地基类（哪怕同名）一律被判
 * `Remote methods require TypertRemoteService or readonly typertRemote = bindTypertRemote(...)`。
 * 生成器还接受 `readonly typertRemote = bindTypertRemote(this, serviceKey, options)` 那条路径，但用它
 * 就得把服务键在每个类里**写两遍**（`super()` 与字段），不一致时是运行期 `binding-invalid`——
 * 正是本线要消灭的"起不来且门禁抓不到"的失败形态，不改判据也不制造它。
 * 结论：11 个类保持 `extends TypertRemoteService`，在构造函数里各调一次本函数。
 * 证据与取舍见 `tickets/EH-2.status.md`。
 *
 * 包装**装在实例上**，不装在原型上：网关的 SRC 模式用 `methodParameterNames`
 * 读**原型上**那个方法的源码文本取形参名（`lib/index.js:1466-1494`），把原型方法换成
 * `(...args)` 的包装会让它判 `gateway/signature-invalid`；实例自有属性不在那条路径上。
 *
 * ⚠️ **调用点必须在派生类的构造函数体里，不能在（假想的）基类构造函数里。** 实测（wt/eh-2，
 * 探针跑完已删）：标准方法装饰器的 `addInitializer` 在**派生类实例字段初始化**阶段才跑——
 * 基类构造函数体里 `remoteMethods(this)` 得到 `[]`，派生类构造函数体里才得到 `["ping","changes"]`；
 * 标记落在"最派生那个原型"上。派生类的构造函数体在字段初始化**之后**执行，所以那时标记已经齐了，
 * 可以**立即装**，不需要惰性访问器。
 *
 * ## 已知边界
 *
 * `@Remote({ mode: 'stream' })` 的方法（本包 6 个）返回异步流：包装只覆盖**调用那一刻**的抛出，
 * **迭代过程中**的失败不在本票范围（那 6 个方法不产生领域失败）。{@link translateRejection}
 * 只认 thenable（`async` 方法的返回值），不碰 AsyncIterable。
 *
 * ## 前置条件：`@eleckoi/product-shared` 必须已构建
 *
 * 本文件**在运行时** import 契约包的 `foldFailure`。契约包的 `exports` 因此带两个条件：
 * `types` → 产出的 `.d.ts`、`default` → 产出的 `.js`（源码里 `.js` 后缀的相对 import 只有产出
 * 之后才有对应文件——这也正是它能被 Node 加载的原因）。本包 host 面是 `tsc` 直出、不打包
 * （`build:host`；`scripts/generate-dsh-product-remote.mjs` 还专门删掉了旧的 bundle 入口），
 * 而打包后的应用就是按包名直接 import 这些文件（`scripts/verify-packaged-dsh-runtime.mjs:75-84`），
 * 所以 `build:workspace-runtime` 必须先 `pnpm --filter @eleckoi/product-shared build`。
 * 证据与复现命令见 `tickets/EH-2.status.md`。
 *
 * 另一条同源理由：`foldFailure` 用**形状**（`name === 'DesktopError'`）而不是 `instanceof` 识别产品失败，
 * 因为 `dsh-product-data` 的产物把契约包内联成了自己那一份类，跨副本 `instanceof` 必为 false。
 */

import {
  RemoteError,
  remoteErrorOf,
  remoteMethods
} from '@deepseek-ai/dsh-typert-protocol'
import { foldFailure } from '@eleckoi/product-shared/foundation/failure'

/**
 * 把任意抛出翻译成网关会**原样透传**的失败。
 *
 * 1. 已经满足 `remoteErrorOf` 的**结构标记**（`isDSHRemoteError === true` 且有 string `code`）⇒
 *    原样返回。它本来就骑在官方载体上、网关会原样透传，这条边界不对它做二次翻译；跨 realm / 跨 bundle
 *    的副本没有同一个原型，所以只认结构。
 * 2. 其余交给契约包的 `foldFailure`（桌面失败按形状识别、legacy 6 码走防御映射、未知一律兜底），
 *    再把折出来的 `{ code, message, details }` 包成官方 `RemoteError`——**只包这一层**，
 *    码与参数化详情逐字保留（`details` 是必填参数，没有详情时 `foldFailure` 给 `{}`）。
 *
 * @param error - 被捕获的任意抛出。
 * @returns 带契约码与参数化详情的官方 `RemoteError`。
 */
export function remoteErrorFrom(error: unknown): RemoteError {
  const carried = remoteErrorOf(error)
  if (carried !== undefined) return carried
  const failure = foldFailure(error)
  return new RemoteError(failure.code, failure.message, failure.details)
}

/** 实例上「翻译已装过」的标记（幂等判据）。 */
const TRANSLATION_INSTALLED: unique symbol = Symbol('eleckoi.remote-failure.installed')

/** 每个类原型上「哪些方法是 `@Remote`」的缓存（标记落盘后不再变）。 */
const REMOTE_METHOD_NAMES = new WeakMap<object, ReadonlySet<string>>()

/**
 * 在这个实例上装边界② 的失败翻译：把该类**每一个** `@Remote` 方法包一层
 * `try/catch` → {@link remoteErrorFrom}（`async` 方法的拒绝由 {@link translateRejection} 接住）。
 *
 * **调用点**：11 个服务类各自的构造函数体里（`super(...)` 之后一行）。标记在**实例字段初始化**
 * 阶段就已落到原型上，而构造函数体在字段初始化之后才跑，所以这里读到的 `remoteMethods` 是完整的——
 * 实测见 `tickets/EH-2.status.md`。安装只读原型上的方法与标记，不碰任何字段，所以放在 `super()`
 * 之后、字段赋值之前是安全的。
 *
 * **幂等**：同一实例重复调用不会叠第二层包装（`TRANSLATION_INSTALLED` 落在实例上）；
 * 每个类原型只算一次"哪些方法是 `@Remote`"（`REMOTE_METHOD_NAMES` 缓存）。
 * 包装装在**实例**上而不是原型上：网关的 SRC 模式用 `methodParameterNames` 读**原型上**那个方法的
 * 源码文本取形参名（`lib/index.js:1466-1494`），把原型方法换成 `(...args)` 的包装会让它判
 * `gateway/signature-invalid`；实例自有属性不在那条路径上。
 *
 * @param instance - 刚建好的服务实例。
 */
export function installRemoteFailureTranslation(instance: object): void {
  if (Object.hasOwn(instance, TRANSLATION_INSTALLED)) return
  Object.defineProperty(instance, TRANSLATION_INSTALLED, { value: true, enumerable: false, configurable: true })
  const prototype = Object.getPrototypeOf(instance)
  if (prototype === null) return
  let names = REMOTE_METHOD_NAMES.get(prototype)
  if (names === undefined) {
    names = new Set(remoteMethods(instance).map((marker) => marker.method))
    REMOTE_METHOD_NAMES.set(prototype, names)
  }
  for (const name of names) {
    const implementation: unknown = Object.getOwnPropertyDescriptor(prototype, name)?.value
    if (typeof implementation !== 'function') continue
    defineTranslatingMethod(instance, name, implementation)
  }
}

/**
 * 一个带翻译的实例方法：同步抛出与 `async` 拒绝都走 {@link remoteErrorFrom}。
 * @param instance - 服务实例。
 * @param name - 方法名。
 * @param implementation - 原型上那个方法。
 */
function defineTranslatingMethod(instance: object, name: string, implementation: Function): void {
  Object.defineProperty(instance, name, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function (this: object, ...args: readonly unknown[]): unknown {
      try {
        return translateRejection(Reflect.apply(implementation, this, args))
      } catch (error) {
        throw remoteErrorFrom(error)
      }
    }
  })
}

/**
 * `async` 方法的失败是**被拒绝的 Promise**，同步 `try`/`catch` 接不到——所以 thenable 要接一层。
 * AsyncIterable（`@Remote({ mode: 'stream' })` 的返回）没有 `then`，原样返回：迭代过程中的失败
 * 不在本票范围（见文件头「已知边界」）。
 * @param outcome - `@Remote` 方法这次调用的返回值。
 * @returns 翻译过拒绝的返回值。
 */
function translateRejection(outcome: unknown): unknown {
  if (typeof outcome !== 'object' || outcome === null) return outcome
  if (typeof (outcome as { readonly then?: unknown }).then !== 'function') return outcome
  return (outcome as Promise<unknown>).then(undefined, (error: unknown) => {
    throw remoteErrorFrom(error)
  })
}
