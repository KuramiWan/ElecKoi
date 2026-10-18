import { afterEach, describe, expect, it, vi } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { foldFailure } from '@shared/foundation/failure'
import { FAILURE_CODES } from '../src/failure.js'
import { fetchDeepSeek, searchDeepSeek } from '../src/api.js'

afterEach(() => { vi.unstubAllGlobals() })

const respond = (value, status = 200) => new Response(JSON.stringify(value), { status })

describe('DeepSeek 联网失败的契约码', () => {
  it('本地码常量与契约码表逐字一致', () => {
    const contract = Object.values(ELECKOI_FAILURE_CODES)
    for (const code of Object.values(FAILURE_CODES)) expect(contract).toContain(code)
  })

  it('缺密钥给出 model/config-invalid，并在折叠后保留码与详情', async () => {
    const failure = await searchDeepSeek('', { query: 'a', count: 1 }).catch(error => error)
    expect(failure).toMatchObject({
      code: ELECKOI_FAILURE_CODES.modelConfigInvalid,
      details: { field: 'DeepSeek 联网 API Key', what: '联网搜索密钥' }
    })
    expect(foldFailure(failure)).toMatchObject({
      code: ELECKOI_FAILURE_CODES.modelConfigInvalid,
      message: '请先配置 DeepSeek 联网 API Key。',
      details: { field: 'DeepSeek 联网 API Key', what: '联网搜索密钥' }
    })
  })

  it('网络失败给出 net/operation-failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(searchDeepSeek('synthetic', { query: 'a', count: 1 })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.netOperationFailed,
      details: { operation: 'request', what: 'DeepSeek 联网接口' }
    })
  })

  it('HTTP 401 按密钥配置折码，其余状态按网络失败折码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ error: { message: 'invalid key' } }, 401)))
    await expect(fetchDeepSeek('synthetic', { url: 'https://example.com' })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.modelConfigInvalid,
      details: { field: 'DeepSeek 联网 API Key' }
    })
    vi.stubGlobal('fetch', vi.fn(async () => respond({ error: { message: 'busy' } }, 429)))
    await expect(fetchDeepSeek('synthetic', { url: 'https://example.com' })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.netOperationFailed
    })
  })

  it('响应不是 JSON 或形状不对给出 contract/invalid-response 与 issues', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(searchDeepSeek('synthetic', { query: 'a', count: 1 })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.contractInvalidResponse,
      details: { issues: [{ path: '', message: '响应不是合法 JSON' }] }
    })
    vi.stubGlobal('fetch', vi.fn(async () => respond({})))
    await expect(searchDeepSeek('synthetic', { query: 'a', count: 1 })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.contractInvalidResponse,
      details: { issues: [{ path: 'results', message: '搜索结果必须是数组' }] }
    })
  })

  it('用户输入不合法给出 input/invalid，不支持的 URL 给出 input/unsupported', async () => {
    await expect(searchDeepSeek('synthetic', { query: '', count: 1 })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.inputInvalid,
      details: { field: '搜索词' }
    })
    await expect(fetchDeepSeek('synthetic', { url: 'file:///private' })).rejects.toMatchObject({
      code: ELECKOI_FAILURE_CODES.inputUnsupported,
      details: { what: '抓取 URL', expected: '无嵌入凭据的 HTTP(S) 地址' }
    })
  })
})
