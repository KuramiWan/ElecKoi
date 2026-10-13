// @vitest-environment jsdom
/**
 * 边界⑥ 的失败保真：调用方必须观察到 `code` 与 `details`，而不是一句话。
 *
 * 判据来源：ADR 0002 决定 2（边界闭集 ⑥）/ 决定 8（`throw result.error` 保留实例）/
 * 决定 14（`eleckoi/contract/invalid-response` 的详情带 `issues`）；票 EH-4a 第 1 节与验收段。
 *
 * 断言的是**外部行为**：`remote` 返回什么，调用方观察到什么。不断言内部函数被调用。
 * 两条路径各断言一次：
 *
 * 1. 信封**成立**但失败（`ok:false` + 带 `code` 的失败对象）⇒ 码与详情逐字保留（就是那个实例本身）；
 * 2. 信封**不成立**（`ok:false` 却没有可用失败对象）⇒ 折成 `eleckoi/contract/invalid-response`，
 *    详情带 `issues`。这一份折叠只有一份实现，住 `@eleckoi/dsh-product-api/client`。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { remoteFailure } from './helpers/remoteFailure'

/** 契约里「服务返回的载荷不合合同」那条码（`packages/product-shared/src/contracts/errors/codes.ts`）。 */
const INVALID_RESPONSE_CODE = 'eleckoi/contract/invalid-response'

/** 信封不成立的返回：`ok` 不是 true，且没有带 code 的失败对象。 */
const MALFORMED_RESULT = { ok: false, error: { message: '合成的不成形信封' } }

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

/** 在一个包上挂载插件，取它 provide 出来的服务。 */
function mount<T>(feature: string, _service: string, remote: Record<string, unknown>,
  extra: Record<string, unknown> = {}): T {
  const source = readFileSync(resolve(process.cwd(), `packages/dsh-client-${feature}/src/client.js`), 'utf8')
  let registration: { factory: (require: (name: string) => unknown) => { apply: (context: Record<string, unknown>) => unknown } } | undefined
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (item: typeof registration) => { registration = item } } }
  })
  if (registration === undefined) throw new Error(`packages/dsh-client-${feature}/src/client.js 没有注册自己。`)
  let provided: unknown
  dshClientPlugin(registration).apply({
    remote,
    provide: (_key: string, value: unknown) => { provided = value },
    effect: () => {}, on: () => () => {},
    ...extra,
  })
  return provided as T
}

describe('渲染层客户端不丢失败码（边界⑥）', () => {
  it('models：信封成立时抛出那个失败实例，码与详情逐字保留', async () => {
    const failure = remoteFailure('eleckoi/internal', '模型目录读取失败', { what: 'catalog' })
    const catalog = mount<{ refresh: () => Promise<unknown>; getSnapshot: () => { failure?: unknown } }>(
      'models', 'eleckoiModels', { session: { modelCatalog: async () => ({ ok: false, error: failure }) } }
    )
    await expect(catalog.refresh()).rejects.toMatchObject({
      code: 'eleckoi/internal', details: { what: 'catalog' }
    })
    expect(catalog.getSnapshot().failure).toMatchObject({
      code: 'eleckoi/internal', details: { what: 'catalog' }
    })
  })

  it('models：信封不成立时折成 contract/invalid-response，详情带 issues', async () => {
    const catalog = mount<{ refresh: () => Promise<unknown> }>(
      'models', 'eleckoiModels', { session: { modelCatalog: async () => MALFORMED_RESULT } }
    )
    await expect(catalog.refresh()).rejects.toMatchObject({
      code: INVALID_RESPONSE_CODE, details: { issues: [{ path: 'result.error' }] }
    })
  })

  it('characters：列表读取与分组写入都保留失败实例', async () => {
    const listFailure = remoteFailure('eleckoi/character/not-found', '找不到角色', { what: 'card-1' })
    const writeFailure = remoteFailure('eleckoi/conflict/stale-revision', '角色已在别处更新', { what: 'characters' })
    const catalog = mount<{
      refresh: () => Promise<unknown>; saveGroups: (groups: unknown, assignments?: unknown) => Promise<unknown>
    }>('characters', 'eleckoiCharacters', { eleckoiCharacters: {
      list: async () => ({ ok: false, error: listFailure }),
      saveGroups: async () => ({ ok: false, error: writeFailure }),
    } })
    await expect(catalog.refresh()).rejects.toMatchObject({
      code: 'eleckoi/character/not-found', details: { what: 'card-1' }
    })
    await expect(catalog.saveGroups([], [])).rejects.toMatchObject({
      code: 'eleckoi/conflict/stale-revision', details: { what: 'characters' }
    })
  })

  it('characters：导出信封不成立时折成 contract/invalid-response', async () => {
    const catalog = mount<{ exportCharacters: (ids: string[], format: string) => Promise<unknown> }>(
      'characters', 'eleckoiCharacters', { eleckoiCharacters: { export: async () => MALFORMED_RESULT } }
    )
    const outcome = await catalog.exportCharacters(['card-1'], 'json')
    // 导出把每个角色的失败收进 failures；这里断言聚合里保留了可判别的失败。
    expect(outcome).toMatchObject({ failures: [{ characterId: 'card-1' }] })
  })

  it('character-configuration：helper request 服务了 10+ 调用点，失败实例照样透出', async () => {
    const failure = remoteFailure('eleckoi/input/invalid', '入参不合法', { field: 'name' })
    const regexRules = mount<{ save: (id: string, collection: unknown) => Promise<unknown> }>(
      'character-configuration', 'eleckoiRegexRules', {
        eleckoiCharacterConfiguration: { saveRegexRules: async () => ({ ok: false, error: failure }) },
      }
    )
    await expect(regexRules.save('character-1', { revision: 3 })).rejects.toMatchObject({
      code: 'eleckoi/input/invalid', details: { field: 'name' }
    })
  })

  it('persona：读取与保存都保留失败实例', async () => {
    const failure = remoteFailure('eleckoi/storage/corrupt', '资料文件损坏', { what: 'persona' })
    const profileShape = { user_name: 'a', user_avatar: 'b', user_square: 'c', user_portrait: 'd' }
    const profile = mount<{ refresh: () => Promise<unknown>; save: (input: unknown) => Promise<unknown> }>(
      'persona', 'eleckoiPersona', { eleckoiPersona: {
        read: async () => ({ ok: false, error: failure }),
        save: async () => ({ ok: false, error: failure }),
      } }
    )
    await expect(profile.refresh()).rejects.toMatchObject({ code: 'eleckoi/storage/corrupt', details: { what: 'persona' } })
    await expect(profile.save(profileShape)).rejects.toMatchObject({ code: 'eleckoi/storage/corrupt' })
  })

  it('creator-studio：列表与创建都保留失败实例', async () => {
    const failure = remoteFailure('eleckoi/creator-project/name-taken', '同名目录已存在', { path: '/tmp/x' })
    const projects = mount<{ refresh: () => Promise<unknown>; create: (input: unknown) => Promise<unknown> }>(
      'creator-studio', 'eleckoiCreatorStudio', { eleckoiCreatorStudio: {
        list: async () => ({ ok: false, error: failure }),
        create: async () => ({ ok: false, error: failure }),
      } }
    )
    await expect(projects.refresh()).rejects.toMatchObject({
      code: 'eleckoi/creator-project/name-taken', details: { path: '/tmp/x' }
    })
    await expect(projects.create({})).rejects.toMatchObject({ code: 'eleckoi/creator-project/name-taken' })
  })

  it('presets：helper call 服务 12 个调用点，失败实例照样透出', async () => {
    const failure = remoteFailure('eleckoi/agent-preset/not-found', '找不到预设', { what: 'preset-1' })
    const catalog = mount<{ read: (id: string) => Promise<unknown> }>(
      'presets', 'eleckoiPresets', { eleckoiAgentPresets: { read: async () => ({ ok: false, error: failure }) } }
    )
    await expect(catalog.read('preset-1')).rejects.toMatchObject({
      code: 'eleckoi/agent-preset/not-found', details: { what: 'preset-1' }
    })
  })

  it('presets：信封不成立时折成 contract/invalid-response', async () => {
    const catalog = mount<{ read: (id: string) => Promise<unknown> }>(
      'presets', 'eleckoiPresets', { eleckoiAgentPresets: { read: async () => MALFORMED_RESULT } }
    )
    await expect(catalog.read('preset-1')).rejects.toMatchObject({ code: INVALID_RESPONSE_CODE })
  })

  it('display-preferences：helper unwrap 服务读取与写入', async () => {
    const failure = remoteFailure('eleckoi/io/failed', '写配置失败', { operation: 'write', path: '/tmp/p.json' })
    const model = mount<{ refresh: () => Promise<unknown>; updateUi: (update: unknown) => Promise<unknown> }>(
      'display-preferences', 'eleckoiDisplayPreferences', { eleckoiDisplayPreferences: {
        read: async () => ({ ok: false, error: failure }),
        updateUi: async () => ({ ok: false, error: failure }),
      } }
    )
    await expect(model.refresh()).rejects.toMatchObject({
      code: 'eleckoi/io/failed', details: { operation: 'write', path: '/tmp/p.json' }
    })
    await expect(model.updateUi({})).rejects.toMatchObject({ code: 'eleckoi/io/failed' })
  })

  it('web-search：helper unwrap 服务 9 个调用点', async () => {
    const failure = remoteFailure('eleckoi/internal', '搜索方式读取失败', { what: 'selection' })
    const settings = mount<{ refresh: () => Promise<unknown> }>(
      'web-search', 'eleckoiWebSearch', {
        eleckoiWebSearch: { selection: async () => ({ ok: false, error: failure }) },
        settings: { describe: async () => ({ ok: true, value: { namespaces: [] } }) },
        credentials: { describe: async () => ({ ok: true, value: {} }) },
      }
    )
    await expect(settings.refresh()).rejects.toMatchObject({
      code: 'eleckoi/internal', details: { what: 'selection' }
    })
  })

  it('conversations：helper unwrap 服务约 30 个调用点', async () => {
    const failure = remoteFailure('eleckoi/creator-project/not-found', '找不到聊天存档', { what: 'chat-1' })
    const catalog = mount<{ refresh: () => Promise<unknown> }>('conversations', 'eleckoiConversations', {
      eleckoiConversations: { list: async () => ({ ok: false, error: failure }) },
    })
    await expect(catalog.refresh()).rejects.toMatchObject({
      code: 'eleckoi/creator-project/not-found', details: { what: 'chat-1' }
    })
  })

  it('conversations：信封不成立时折成 contract/invalid-response', async () => {
    const catalog = mount<{ refresh: () => Promise<unknown> }>(
      'conversations', 'eleckoiConversations', { eleckoiConversations: { list: async () => MALFORMED_RESULT } }
    )
    await expect(catalog.refresh()).rejects.toMatchObject({ code: INVALID_RESPONSE_CODE })
  })

  it('conversations：session.prompt 的 RemoteResult 失败也保留实例（变量名不是 result）', async () => {
    const failure = remoteFailure('eleckoi/internal', '生成请求未被接受', { what: 'prompt' })
    const details = { conversation: { id: 'chat-1' }, runtimeSessionId: 'runtime-1', messages: [] }
    const session = {
      getSnapshot: () => ({ running: false }),
      subscribe: () => () => {},
      prompt: async () => ({ ok: false, error: failure }),
      cancel: async () => ({ ok: true }),
    }
    const binding = {
      session,
      eventSource: { getSnapshot: () => ({ entries: [], hasMore: false }), subscribe: () => () => {} },
    }
    const catalog = mount<{ open: (id: string) => Promise<unknown>; send: (input: unknown) => Promise<unknown> }>(
      'conversations', 'eleckoiConversations', {
        session: {},
        eleckoiConversations: {
          list: async () => ({ ok: true, value: [{ id: 'chat-1', runtimeSessionId: 'runtime-1' }] }),
          details: async () => ({ ok: true, value: details }),
          preparePrompt: async () => ({ ok: true, value: { runtimeSessionId: 'runtime-1' } }),
        },
      }, {
        sessions: {
          list: { getSnapshot: () => ({ byId: { 'runtime-1': {} } }) },
          refresh: async () => {}, reloadHistory: async () => {},
          retain: () => ({ sessionId: 'runtime-1', binding, ready: Promise.resolve(binding), release() {} }),
        },
        uiConversation: { binding: () => ({ target: () => ({
          getSnapshot: () => ({ legacy: { nodes: [], partial: null } }), subscribe: () => () => {},
        }) }) },
      }
    )
    await settle()
    await catalog.open('chat-1')
    await expect(catalog.send({ conversationId: 'chat-1', requestId: 'request-1', text: '合成输入' }))
      .rejects.toMatchObject({ code: 'eleckoi/internal', details: { what: 'prompt' } })
  })

  it('折叠函数只有一份实现：用例用的就是契约包 client 产物里的那一个', async () => {
    // 9 个含 unwrap 的包都从同一个地方取它；这里断言每个包的源码里没有第二份码表字面量，
    // 且都 `require` 契约包的 client 半边（不是自己折一份）。
    //
    // ⚠️ 覆盖代理，不是行为判据（判据来源：ADR 0002 决定 8 的「折叠只有一份」）。下面这条断言钉的是
    // **调用形状**：票 EH-11 的 E 项把 23 份抄写的三元式收进 `unwrapOrFail(result, what)`，
    // 所以它从 `.invalidResponseFailure` 改成 `.unwrapOrFail`。**码表字面量那一条没动**，
    // 行为等价由本文件的行为用例与 `tests/client-unwrap-failure.test.ts` 保证。
    const { productApiClientModule } = await import('./helpers/dshClientPlugin')
    const folded = productApiClientModule().invalidResponseFailure('合成的诊断')
    expect(folded).toMatchObject({
      isDSHRemoteError: true, code: INVALID_RESPONSE_CODE, details: { issues: [{ path: 'result.error' }] }
    })
    const packages = ['characters', 'character-configuration', 'conversations', 'creator-studio',
      'display-preferences', 'models', 'persona', 'presets', 'web-search']
    for (const feature of packages) {
      const source = readFileSync(resolve(process.cwd(), `packages/dsh-client-${feature}/src/client.js`), 'utf8')
      expect(source).toContain("require('@eleckoi/dsh-product-api/client').unwrapOrFail")
      expect(source).not.toContain(INVALID_RESPONSE_CODE)
    }
    await settle()
  })
})
