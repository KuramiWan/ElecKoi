import { afterEach, describe, expect, it, vi } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { foldFailure } from '@shared/foundation/failure'
import { FAILURE_CODES } from '../src/failure.js'
import { apply } from '../src/index.js'

afterEach(() => { vi.unstubAllGlobals() })

const respond = (value, status = 200) => new Response(JSON.stringify(value), { status })

function provider(apiKey = 'synthetic-key') {
  let registered
  apply({ web: { registerSearchProvider(value) { registered = value } }, get: () => ({ resolve: async () => ({ value: apiKey }) }) },
    { apiKeyEnv: { get: () => 'TAVILY_API_KEY' }, maxResults: { get: () => 5 } })
  return registered
}

describe('Tavily 搜索失败的契约码', () => {
  it('本地码常量与契约码表逐字一致', () => {
    const contract = Object.values(ELECKOI_FAILURE_CODES)
    for (const code of Object.values(FAILURE_CODES)) expect(contract).toContain(code)
  })

  it('缺密钥给出 model/config-invalid', async () => {
    await expect(provider('').search({ query: 'a' })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.modelConfigInvalid,
      details: { field: 'Tavily API Key', what: '联网搜索密钥' }
    })
  })

  it('网络失败给出 net/operation-failed，并在折叠后保留码与详情', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const failure = await provider().search({ query: 'a' }).catch(error => error)
    expect(failure).toMatchObject({
      code: ELECKOI_FAILURE_CODES.netOperationFailed,
      details: { operation: 'request', what: 'Tavily 搜索接口' }
    })
    expect(foldFailure(failure)).toMatchObject({
      code: ELECKOI_FAILURE_CODES.netOperationFailed,
      message: 'Tavily 搜索请求失败，请检查网络连接。',
      details: { operation: 'request', what: 'Tavily 搜索接口' }
    })
  })

  it('HTTP 401 按密钥配置折码，其余状态按网络失败折码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({}, 401)))
    await expect(provider().search({ query: 'a' })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.modelConfigInvalid,
      details: { field: 'Tavily API Key' }
    })
    vi.stubGlobal('fetch', vi.fn(async () => respond({}, 429)))
    await expect(provider().search({ query: 'a' })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.netOperationFailed
    })
  })

  it('响应不是 JSON 给出 contract/invalid-response 与 issues', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(provider().search({ query: 'a' })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.contractInvalidResponse,
      details: { issues: [{ path: '', message: '响应不是合法 JSON' }] }
    })
  })
})
