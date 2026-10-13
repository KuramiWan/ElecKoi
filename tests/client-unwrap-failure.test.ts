/**
 * `unwrapOrFail`（票 EH-11 的 E 项）：9 个 `dsh-client-*` 抄了 23 份的那条拆信封三元式，行为逐条钉住。
 *
 * 判据来源：ADR 0002 决定 8（`throw result.error` 保留实例，不重新包成裸 `Error`）、
 * 决定 14（`eleckoi/contract/invalid-response` 的详情带 `issues`）；票 EH-4a 第 1 节。
 *
 * 断言的是**真产物**：用例读到的是 `packages/dsh-product-api/lib/client.js`
 * （`pretest` 的 `build:workspace-runtime` 现做），不是用例里另写的一份实现。
 * 三条分支与旧的三元式逐字等价：**成立但不 ok → 抛那个实例**；**不成立 → 抛契约失败带 issues**；
 * **ok → 给值**。
 */
import { describe, expect, it } from 'vitest'
import { productApiClientModule } from './helpers/dshClientPlugin'
import { remoteFailure } from './helpers/remoteFailure'

const INVALID_RESPONSE_CODE = 'eleckoi/contract/invalid-response'

describe('unwrapOrFail：信封拆解只有一份（边界⑥）', () => {
  it('ok 为真时给值，什么也不抛', () => {
    const value = { id: 'character-1' }

    expect(productApiClientModule().unwrapOrFail({ ok: true, value }, '不该走到这里')).toBe(value)
  })

  it('信封成立但失败时抛出**那个实例本身**，码与详情逐字保留', () => {
    const failure = remoteFailure('eleckoi/conflict/stale-revision', '角色已在别处更新', { what: 'characters' })

    expect(() => productApiClientModule().unwrapOrFail({ ok: false, error: failure }, '角色列表')).toThrow()
    try {
      productApiClientModule().unwrapOrFail({ ok: false, error: failure }, '角色列表')
    } catch (error) {
      expect(error).toBe(failure)
      expect(error).toMatchObject({ code: 'eleckoi/conflict/stale-revision', details: { what: 'characters' } })
    }
  })

  it('信封不成立时折成 contract/invalid-response，issues 带上 path 与 message', () => {
    const thrown: unknown = (() => {
      try {
        productApiClientModule().unwrapOrFail({ ok: false, error: { message: '没有码' } }, '模型目录调用')
      } catch (error) {
        return error
      }
      return undefined
    })()

    expect(thrown).toMatchObject({
      code: INVALID_RESPONSE_CODE,
      message: '模型目录调用',
      details: { issues: [{ path: 'result.error', message: '模型目录调用' }] }
    })
  })

  it('连 result 都没有时折的也是那条码（path 用默认的 result.error，与旧三元式一致）', () => {
    const thrown: unknown = (() => {
      try {
        productApiClientModule().unwrapOrFail(undefined, '会话目录调用')
      } catch (error) {
        return error
      }
      return undefined
    })()

    expect(thrown).toMatchObject({
      code: INVALID_RESPONSE_CODE,
      details: { issues: [{ path: 'result.error', message: '会话目录调用' }] }
    })
  })

  it('空的 code 与 truthy 的 code 分得开（与旧三元式的真值判定一致）', () => {
    const module = productApiClientModule()

    for (const error of [{ code: '' }, { code: 0 }, { code: null }, 'boom']) {
      expect(module.failureOrInvalidResponse(error, '诊断')).toMatchObject({ code: INVALID_RESPONSE_CODE })
    }
    const carried = { code: 'eleckoi/internal', message: '失败' }
    expect(module.failureOrInvalidResponse(carried, '诊断')).toBe(carried)
  })
})
