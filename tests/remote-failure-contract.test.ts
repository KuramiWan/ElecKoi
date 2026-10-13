/**
 * R2（边界②，宿主 Remote 出口）：`@Remote` 方法抛出**领域失败**时，客户端必须观察到
 * `ok:false`，且**失败码与详情原样保留**。
 *
 * 判据来源：spec-error-handling-interface.md 的「Testing Decisions」R2（"`@Remote` 方法抛出领域失败时，
 * 客户端观察到 `ok:false` 且失败码与详情保留"）；docs/adr/0002-error-handling-interface.md 决定 5（反空转：
 * 红案例按接口规定的路径修好）、决定 8（业务失败抛 `RemoteError`）、决定 14（首批码表：
 * `eleckoi/io/failed` 的详情带 `operation`/`path`）。
 *
 * **EH-0 立这条用例时它是红的**（`AssertionError: expected 'gateway/internal' to be 'eleckoi/io/failed'`）：
 * `DesktopError` 没有 `isDSHRemoteError` 结构标记，`remoteErrorOf` 不认它，`rpcFailure`
 * （`@deepseek-ai/dsh-api-gateway/lib/index.js:1425-1443`）于是把码折成 `gateway/internal`、把 `details`
 * 折成 `{}`。EH-2 在边界② 装上适配器（`packages/dsh-product-api/src/remoteFailure.ts`）之后转绿，
 * **断言一条没改**。
 *
 * 装配照 `tests/dsh-product-remote.test.ts` 的第 5 个用例（`:345-352`），但**不 import
 * `@eleckoi/dsh-product-data`**：`vitest.config.ts:12` 把它别名到 `src/index.ts`，会拉进 better-sqlite3
 * 那条已知的原生崩溃路径（`notes/error-handling-baseline-test-crash.md`）。
 */
import { Context } from '@deepseek-ai/cordis'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry, { type TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { Remote, TypertRemoteService, remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CharacterConfigurationChangeFeed,
  ConversationChangeFeed,
  ElecKoiCharactersApi,
  ElecKoiSystemApi,
  ProductRecordChangeFeed,
  installRemoteFailureTranslation
} from '@eleckoi/dsh-product-api'
import { TYPERT } from '@eleckoi/dsh-product-api/typert'
import { ELECKOI_FAILURE_CODES } from '@eleckoi/product-shared/contracts/errors/codes'
import { DesktopError } from '@eleckoi/product-shared/foundation/DesktopError'

/** `rpcFailure` 产出的线信封（`@deepseek-ai/dsh-api-gateway/lib/index.js:1425-1443`）。 */
interface WireFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/** 一次线调用的结果：成功分支带业务值，失败分支带被折叠后的失败。 */
type WireRpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: WireFailure }

/**
 * `invokeRpc` 是 `rpcFailure` 折叠的唯一入参面（`@deepseek-ai/dsh-api-gateway/lib/index.js:953-960`）。
 * 上游把它在 `.d.ts` 里标成 `private`（`lib/types/index.d.ts:122`），而 `ctx.typertGateway` 的公开类型
 * （`lib/types/types.d.ts:132-135`）只有 `invoke`/`stream`——`invoke` 走 `invokePrepared`、按设计**直接重抛**
 * （`lib/index.js:726-728`；`tests/dsh-product-remote.test.ts:812-817` 已经这么断言过），观察不到 `ok:false`。
 * 所以这里只按运行时形状描述它，不改上游、不碰实现。
 */
interface WireRpcCarrier {
  invokeRpc(endpoint: string, payload: { readonly args: Record<string, unknown> }): Promise<WireRpcResult>
}

/**
 * 从线上那条路观察一次失败：载荷形状由上游 `remoteRequest`（`lib/index.js:1225-1237`）规定——
 * 恰好一个 `args` 字段，且 `args` 是普通对象。
 * @param ctx - 已装配 Registry / 桩依赖 / Gateway 的 Context。
 * @param endpoint - 形如 `<namespace>/<method>` 的规范端点。
 * @returns 线信封（失败时为 `{ ok: false, error }`）。
 */
function invokeWireRpc(ctx: Context, endpoint: string): Promise<WireRpcResult> {
  const carrier = ctx.typertGateway as unknown as WireRpcCarrier
  return carrier.invokeRpc(endpoint, { args: {} })
}

/**
 * 装配「真实 TypertRegistry + 真实 TypertGatewayService + 真实产品服务」，只把注入的领域 store 换成桩。
 * 零产品数据 import（理由见文件头）。
 * @param ctx - 待装配的 Context。
 * @param productData - 桩 `eleckoiProductData`。
 * @returns 注销 TYPERT 注册的函数。
 */
async function mountCharactersApi(ctx: Context, productData: unknown): Promise<() => void> {
  await ctx.plugin(TypertRegistry)
  const unregister = ctx.typert.register(TYPERT as TypertContribution)
  await ctx.plugin({
    name: 'test-product-data',
    provide: 'eleckoiProductData',
    apply(owner) {
      owner.provide('eleckoiProductData', productData as never)
    }
  })
  await ctx.plugin({
    name: 'test-change-feeds',
    provide: [
      'eleckoiProductRecordChanges',
      'eleckoiConversationChanges',
      'eleckoiCharacterConfigurationChanges'
    ],
    apply(owner) {
      owner.provide('eleckoiProductRecordChanges', new ProductRecordChangeFeed())
      owner.provide('eleckoiConversationChanges', new ConversationChangeFeed())
      owner.provide('eleckoiCharacterConfigurationChanges', new CharacterConfigurationChangeFeed())
    }
  })
  await ctx.plugin({
    name: 'test-unused-injects',
    provide: ['eleckoiRoleplaySessions', 'eleckoiSessionEditor'],
    apply(owner) {
      // 这批用例走的方法都不经过这两个服务；它们只为满足 ElecKoiCharactersApi 的 static inject 存在。
      owner.provide('eleckoiRoleplaySessions', {} as never)
      owner.provide('eleckoiSessionEditor', {} as never)
    }
  })
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(ElecKoiCharactersApi)
  return unregister
}

/**
 * 领域侧的失败形态：契约码的 `DesktopError`（ADR 0002 决定 14 的码表 + EH-1 的 `ELECKOI_FAILURE_CODES`）。
 * @param message - 开发者诊断文案。
 * @param details - 该码声明的结构化详情。
 * @returns 领域失败。
 */
function domainFailure(message: string, details: unknown): DesktopError {
  return new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, message, details)
}

/**
 * **覆盖代理判据**（不是行为判据）：`src/index.ts` 里每一个 `extends TypertRemoteService` 的服务类，都必须
 * 在构造函数里装边界② 的失败翻译。读源文本做断言的先例在本仓库有两条
 * （`tests/dsh-client-*.test.ts` 读 `src/client.js`、`tests/docs-check.test.mjs` 读文档）。
 *
 * ⚠️ 为什么要它：票里原本的代理判据是「`grep -rn "extends TypertRemoteService" packages/dsh-product-api/src`
 * 期望为空」，但 Typert 描述符生成器**硬性要求**服务类自己的 heritage 命中上游那个符号
 * （`isTypeMetaSymbol` 还要求声明文件在上游包里，理由与证据见 `remoteFailure.ts` 文件头）⇒ 那个判据
 * 导向"把服务键在每类里写两遍"的更差形态。所以改判据为"11 个类都装了适配器"：本常量 + 下面那条用例
 * 保证**装配覆盖**，行为面由另外三条用例担保（真实服务逐方法翻译、顺利路径、幂等）。
 */
const productApiSource = readFileSync(new URL('../packages/dsh-product-api/src/index.ts', import.meta.url), 'utf8')

describe('Remote 失败契约（边界②）', () => {
  it('keeps the failure code and details when a Remote method throws a domain failure', async () => {
    // 只可能出现在详情里的字符串：它进 details.path，不进 message。任何"把 details 拍平进 message"
    // 的实现都不会让它出现在 details 里，所以断言 3 挡得住那种蒙混。
    const characterListPath = '/tmp/eleckoi/eh-0-r2/characters.json'
    const ctx = new Context()
    let unregister: (() => void) | undefined
    try {
      unregister = await mountCharactersApi(ctx, {
        // 桩抛的是**领域失败**（DesktopError），不是 RemoteError：测的是"出口能否翻译领域失败"，
        // 不是"我抛了个 RemoteError"。
        readCharacters() {
          throw domainFailure('读取角色列表失败：ENOENT', { operation: 'read', path: characterListPath })
        }
      })

      const result = await invokeWireRpc(ctx, 'eleckoiCharacters/list')

      // 断言顺序固定：先"客户端确实看见失败"，再"失败码没被折叠"，最后"详情还在"。
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Remote 调用返回了成功分支：R2 要求观察到失败分支 ok:false')
      // EH-0 时红在这里：读失败被折成 gateway/internal，原因（契约码）到不了调用方。
      expect(result.error.code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
      // EH-0 时也红在这里：details 被折成 {}，operation 与 path 一起丢失。
      expect(result.error.details).toEqual({ operation: 'read', path: characterListPath })
    } finally {
      unregister?.()
      await ctx.fiber.dispose()
    }
  }, 15_000)

  it('translates every unary Remote method of a real product service, not just the throwing one', async () => {
    // 「11 个服务类、80 个 @Remote 方法全部要被覆盖」这条判据里，"全部"不能只靠"有一条用例抛过一次"来担保。
    // 这里用**真实服务类**（ElecKoiCharactersApi）的真实方法列表（装饰器标记）逐个驱动：注入的 store
    // 任何属性访问都抛同一个领域失败，所以每个方法只要执行到那句 `this.productData.*` 就必须翻成契约码。
    // 任何**方法调用**都抛同一个领域失败。symbol 键与 `then` 要放行：Cordis 在 `ctx.provide` 时会探
    // `symbols.shadow` / `symbols.tracker`，`then` 是 thenable 判据——一个"任何属性访问都抛"的 Proxy
    // 会在服务**构造**时就炸。
    const productData = new Proxy({}, {
      get(_target, property) {
        if (typeof property !== 'string' || property === 'then') return undefined
        return () => {
          throw domainFailure('桩 store 拒绝一切访问', { operation: 'read' })
        }
      }
    })
    const ctx = new Context()
    let unregister: (() => void) | undefined
    try {
      unregister = await mountCharactersApi(ctx, productData)
      const instance = ctx.get('eleckoiCharactersApi')
      if (instance === undefined) throw new Error('eleckoiCharactersApi 没有被挂上')
      const markers = remoteMethods(instance)
      // 6 个 stream 方法不在本票范围（迭代过程中的失败，见 remoteFailure.ts 的「已知边界」）。
      const unary = markers.filter((marker) => marker.mode !== 'stream')
      expect(unary.length).toBeGreaterThan(0)
      for (const marker of unary) {
        const method: unknown = Reflect.get(instance, marker.method)
        if (typeof method !== 'function') throw new Error(`${marker.method} 在实例上取不到可调用方法`)
        let observed: unknown
        try {
          observed = await Reflect.apply(method, instance, [])
        } catch (error) {
          observed = error
        }
        expect(remoteErrorOf(observed)?.code, `${marker.method} 的领域失败没有翻成契约码`).toBe(
          ELECKOI_FAILURE_CODES.ioFailed
        )
      }
    } finally {
      unregister?.()
      await ctx.fiber.dispose()
    }
  }, 15_000)

  it('still returns the business value on the success branch of a real product service', async () => {
    // 适配器装在实例上、拦在每次调用外面，所以"顺利路径有没有被弄坏"必须也验一次：这条走**真实服务**
    // （ElecKoiSystemApi，只需要 typert 一个注入）并断言 ok:true 与逐字相同的返回值。
    const ctx = new Context()
    try {
      await ctx.plugin(TypertRegistry)
      await ctx.plugin(TypertGatewayService)
      await ctx.plugin(ElecKoiSystemApi)

      const result = await invokeWireRpc(ctx, 'eleckoiSystem/status')

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(`成功分支被折成了失败：${result.error.code}`)
      expect(result.value).toEqual({ architecture: 'dsh-remote', protocolVersion: 1 })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 15_000)

  it('installs the boundary-② translation in every product Remote service class', () => {
    const declarations = productApiSource.split('export class ').slice(1)
    const services = declarations.filter((declaration) => declaration.includes('extends TypertRemoteService {'))
    // 改动前就是 11 个；数字动了这条断言会红，提醒把新类也接上。
    expect(services.length).toBe(11)
    for (const declaration of services) {
      const name = declaration.slice(0, declaration.indexOf(' '))
      expect(declaration, `${name} 没有在构造函数里装边界② 的失败翻译`).toContain(
        'installRemoteFailureTranslation(this)'
      )
    }
  })

  it('does not wrap a second time when the translation is installed again', async () => {
    // 幂等是**运行期行为**判据：重复安装只能拿到同一个包装函数。不幂等时会静默叠两层——那种缺陷不会
    // 被别的用例发现（外层包装会原样放行内层抛出的 RemoteError，结果照样正确），所以必须单独钉住。
    //
    // 这里用**合成服务**而不是 `ctx.get(...)` 取真实服务：Cordis 给 `ctx.get` 的结果套了一层
    // "让方法调用看到调用方 context"的代理，它每次读函数属性都返回一个新的包装函数
    // （实测：同一个实例连读两次 `list` 就不相等），因此函数同一性只能在**自己持有的实例**上断言。
    class ProbeService extends TypertRemoteService {
      constructor(ctx: Context) {
        super(ctx, 'eleckoiProbeService')
        installRemoteFailureTranslation(this)
      }

      @Remote
      ping(): string {
        return 'pong'
      }

      @Remote
      boom(): string {
        throw domainFailure('探测用领域失败', { operation: 'read' })
      }
    }

    const ctx = new Context()
    try {
      const instance = new ProbeService(ctx)
      // 机制先成立：装了包装（不是原型上那个方法本身），且领域失败翻成契约码。
      const wrapped: unknown = Reflect.get(instance, 'ping')
      expect(wrapped).not.toBe(Object.getOwnPropertyDescriptor(ProbeService.prototype, 'ping')?.value)
      expect(Reflect.get(instance, 'ping')).toBe(wrapped)

      installRemoteFailureTranslation(instance)
      installRemoteFailureTranslation(instance)
      expect(Reflect.get(instance, 'ping')).toBe(wrapped)

      let observed: unknown
      try {
        Reflect.apply(Reflect.get(instance, 'boom'), instance, [])
      } catch (error) {
        observed = error
      }
      expect(remoteErrorOf(observed)?.code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 15_000)
})
