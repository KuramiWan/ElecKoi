/**
 * 装载 `@eleckoi/dsh-product-api` 的 **client 半边**，供用例取它的公开导出。
 *
 * 判据来源：ADR 0002 决定 8 与票 EH-4a 第 1 节要求「信封不成立」的折叠**只有一份**，
 * 且这一份住 `@eleckoi/dsh-product-api/client` 的导出里。12 个 `dsh-client-*` 的
 * `src/client.js` 是运行时用 `window.__ModuleLoader__` 装载的独立 bundle，跨 bundle 取共享代码
 * 就是 `require` 这个包的 client 半边（`dsh-client-shell/src/client.js:11` 是同一个形态）。
 *
 * 用例必须断言**真实产物**，所以这里读构建出来的 `lib/client.js`——它是
 * `window.__ModuleLoader__.load({ id, factory })` 形态，没有 Node 可 import 的导出。
 * 于是用 `vm` 跑它、抓住注册项、按真 `factory(require)` 物化，再把导出交回用例。
 *
 * ⚠️ 产物由 `pretest` 的 `build:workspace-runtime` 现做，所以这里读到的就是本次源码的产物。
 * 文件缺失时给出显式报错（不静默跳过——跳过会让用例变成恒真）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

/** 注册项的形状：`window.__ModuleLoader__.load` 收到的那个对象。 */
interface ClientModuleRegistration {
  readonly id: string
  readonly factory: (require: (name: string) => unknown) => unknown
}

// 用 process.cwd() 而不是 import.meta.url：本助手要能在 jsdom 环境的用例里也读得到文件
// （jsdom 下 import.meta.url 不是 file: 协议）。vitest 的 cwd 是仓库根。
const CLIENT_BUNDLE_PATH = resolve(process.cwd(), 'packages/dsh-product-api/lib/client.js')
const CLIENT_MODULE_ID = '@eleckoi/dsh-product-api'

/**
 * 物化一个 client bundle（`window.__ModuleLoader__.load({ id, factory })` 形态）的导出。
 *
 * 给 `factory` 的 `require` 只认显式给定的依赖；遇到别的名字直接报错——
 * 这样「产物开始 require 新东西」不会被静默吞掉（`dsh-product-api` 的 client 产物今天
 * 一个 `require` 都不发；变多时会在用例里红，而不是在装出来的应用里崩）。
 *
 * @param source - bundle 源码。
 * @param filename - 报错里用的文件名。
 * @param deps - `factory` 允许 `require` 到的名字。
 * @returns `id` → 该 bundle 的导出。
 */
export function evaluateClientBundle<T>(
  source: string,
  filename: string,
  deps: Readonly<Record<string, unknown>> = {}
): Map<string, T> {
  const registrations: ClientModuleRegistration[] = []
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: (registration: ClientModuleRegistration) => { registrations.push(registration) }
      }
    }
  }, { filename })
  const loaded = new Map<string, T>()
  for (const registration of registrations) {
    loaded.set(registration.id, registration.factory((name: string) => {
      if (Object.hasOwn(deps, name)) return deps[name]
      throw new Error(`${filename} 的 client 半边 require 了未登记的依赖：${name}`)
    }) as T)
  }
  return loaded
}

/** 读并物化 `@eleckoi/dsh-product-api` 的 client 半边。 */
export function loadProductApiClient<T>(): T {
  let source: string
  try {
    source = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')
  } catch (error) {
    throw new Error(
      `读不到 @eleckoi/dsh-product-api 的 client 产物（${CLIENT_BUNDLE_PATH}）：`
      + `${error instanceof Error ? error.message : String(error)}。`
      + 'artifact 缺失时用例必须红，不能静默跳过——请先跑 pnpm build:workspace-runtime。'
    )
  }
  const loaded = evaluateClientBundle<T>(source, 'packages/dsh-product-api/lib/client.js')
  const exports = loaded.get(CLIENT_MODULE_ID)
  if (exports === undefined) {
    throw new Error(`产物没有以 id "${CLIENT_MODULE_ID}" 注册自己。`)
  }
  return exports
}
