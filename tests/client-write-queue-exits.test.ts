// @vitest-environment jsdom
/**
 * 三个写队列的失败出口（ADR 0002 决定 12；票 EH-4a 第 2 节）。
 *
 * 队列的 `.catch(() => {})` 是为了让后面的写继续排队，不是为了把失败丢掉。
 * 用例断言的是**订阅者/调用方观察到 `code` 与 `details`**（不是内部函数被调用）：
 *
 * | 队列 | 出口 |
 * | --- | --- |
 * | `dsh-client-models` 的 `enqueue` | 快照带 `failure`（订阅者经 `getSnapshot`/`subscribe` 读到） |
 * | `dsh-client-conversations` 的 `saveSelection` → `selectionWriteQueue` | `getSelectionWriteSnapshot()` + `subscribeSelectionWrite`，且调用方仍拿到拒绝 |
 * | `dsh-client-display-preferences` 的 `enqueue` | `status:'error'` 快照带 `failure` |
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { dshClientPlugin } from './helpers/dshClientPlugin'
import { remoteFailure } from './helpers/remoteFailure'

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

/** 在一个包上挂载插件并取它 provide 出来的服务。 */
function mount<T>(feature: string, _service: string, remote: Record<string, unknown>): T {
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
  })
  return provided as T
}

describe('写队列的失败有出口（ADR 决定 12）', () => {
  it('models：写失败带上实例进快照，订阅者读到 code 与 details', async () => {
    const failure = remoteFailure('eleckoi/io/failed', '写设置失败', { operation: 'write', path: '/tmp/s.json' })
    let publishes = 0
    const catalog = mount<{
      deleteConfig: (id: string) => Promise<unknown>
      getSnapshot: () => { failure?: unknown }
      subscribe: (listener: () => void) => () => void
      adopt: (configs: unknown[]) => void
    }>('models', 'eleckoiModels', {
      settings: {
        describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'llm-pi-ai', value: { providers: {} }, revision: 1 }] } }),
        mutate: async () => ({ ok: false, error: failure }),
      },
      credentials: { unset: async () => ({ ok: true }) },
    })
    catalog.adopt([{ id: 'config-a', name: 'A', provider: 'custom', settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'config-a'], credentialRef: 'A_API_KEY' }])
    const stop = catalog.subscribe(() => { publishes += 1 })
    await expect(catalog.deleteConfig('config-a')).rejects.toMatchObject({
      code: 'eleckoi/io/failed', details: { operation: 'write', path: '/tmp/s.json' }
    })
    await settle()
    stop()
    expect(publishes).toBeGreaterThan(0)
    expect(catalog.getSnapshot().failure).toMatchObject({
      code: 'eleckoi/io/failed', details: { operation: 'write', path: '/tmp/s.json' }
    })
  })

  it('conversations：saveSelection 的写队列失败进选择快照，调用方也拿到实例', async () => {
    const failure = remoteFailure('eleckoi/conflict/stale-revision', '选择状态已在别处更新', { what: 'selection' })
    const catalog = mount<{
      saveSelection: (value: unknown) => Promise<unknown>
      getSelectionWriteSnapshot: () => { status?: string; failure?: unknown }
      subscribeSelectionWrite: (listener: () => void) => () => void
    }>('conversations', 'eleckoiConversations', {
      settings: {
        describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'eleckoi-client-conversations', value: { selection: {} }, revision: 4 }] } }),
        mutate: async () => ({ ok: false, error: failure }),
      },
    })
    let notified = 0
    const stop = catalog.subscribeSelectionWrite(() => { notified += 1 })
    await expect(catalog.saveSelection({ active_conversation_id: 'chat-1' })).rejects.toMatchObject({
      code: 'eleckoi/conflict/stale-revision', details: { what: 'selection' }
    })
    await settle()
    stop()
    expect(notified).toBeGreaterThan(0)
    expect(catalog.getSelectionWriteSnapshot()).toMatchObject({
      status: 'error',
      failure: { code: 'eleckoi/conflict/stale-revision', details: { what: 'selection' } }
    })
  })

  it('display-preferences：写失败进 status:error 快照并带上实例', async () => {
    const failure = remoteFailure('eleckoi/io/failed', '写显示偏好失败', { operation: 'write', path: '/tmp/display.json' })
    const model = mount<{
      updateUi: (update: unknown) => Promise<unknown>
      getSnapshot: () => { status?: string; failure?: unknown }
      subscribe: (listener: () => void) => () => void
    }>('display-preferences', 'eleckoiDisplayPreferences', {
      eleckoiDisplayPreferences: { updateUi: async () => ({ ok: false, error: failure }) },
    })
    let publishes = 0
    const stop = model.subscribe(() => { publishes += 1 })
    await expect(model.updateUi({})).rejects.toMatchObject({
      code: 'eleckoi/io/failed', details: { operation: 'write', path: '/tmp/display.json' }
    })
    await settle()
    stop()
    expect(publishes).toBeGreaterThan(0)
    expect(model.getSnapshot()).toMatchObject({
      status: 'error',
      failure: { code: 'eleckoi/io/failed', details: { operation: 'write', path: '/tmp/display.json' } }
    })
  })
})
