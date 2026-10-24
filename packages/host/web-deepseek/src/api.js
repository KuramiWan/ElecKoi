import { WebError } from '@deepseek-ai/dsh-web'
import { FAILURE_CODES, webFailure } from './failure.js'

export const DEEPSEEK_API_PROVIDER = 'eleckoi-deepseek-api'
export const DEEPSEEK_WEB_KEY_REF = 'DEEPSEEK_WEB_API_KEY'
export const DEEPSEEK_WEB_NAMESPACE = 'eleckoi-web-deepseek'
const ENDPOINT = 'https://api.deepseek.com/v1/tools/'

/** Only the documented DeepSeek tool endpoints receive the API credential. */
async function request(method, input, apiKey, signal) {
  signal?.throwIfAborted()
  const key = apiKey.trim()
  if (!key) throw webFailure(FAILURE_CODES.modelConfigInvalid, '请先配置 DeepSeek 联网 API Key。', { field: 'DeepSeek 联网 API Key', what: '联网搜索密钥' })
  let response
  let value
  try {
    response = await fetch(`${ENDPOINT}${method}`, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal
    })
    value = await response.json()
  } catch (error) {
    if (signal?.aborted) throw new WebError('DeepSeek 联网请求已取消。', 'WEB_ABORTED')
    if (response) throw webFailure(FAILURE_CODES.contractInvalidResponse, 'DeepSeek 联网接口返回了无效 JSON。', { issues: [{ path: '', message: '响应不是合法 JSON' }] }, { cause: error })
    throw webFailure(FAILURE_CODES.netOperationFailed, 'DeepSeek 联网请求失败，请检查网络连接。', { operation: 'request', what: 'DeepSeek 联网接口' }, { cause: error })
  }
  signal?.throwIfAborted()
  if (!response.ok) {
    const reasons = { 401: 'API Key 无效', 402: '账户余额不足', 403: '网页访问被拒绝', 404: '网页不可用', 408: '请求超时', 429: '请求过于频繁，请稍后重试', 500: '服务内部错误', 504: '下游服务超时' }
    const message = typeof value?.error?.message === 'string' ? value.error.message.split(key).join('[REDACTED]') : ''
    const detail = `DeepSeek ${method} 失败（HTTP ${response.status}）${reasons[response.status] ? `：${reasons[response.status]}` : ''}${message ? ` · ${message}` : ''}`
    // 401 是密钥配置问题，不是网络故障：按模型配置折码，用户句才说得出该改哪里。
    if (response.status === 401) throw webFailure(FAILURE_CODES.modelConfigInvalid, detail, { field: 'DeepSeek 联网 API Key', what: '联网搜索密钥' })
    throw webFailure(FAILURE_CODES.netOperationFailed, detail, { operation: 'request', what: 'DeepSeek 联网接口' })
  }
  return value
}

/** 用户输入不合法：`field` 是出问题的字段（用户可见文案按码生成）。 */
function invalidInput(message, field) { throw webFailure(FAILURE_CODES.inputInvalid, `DeepSeek ${message}`, { field }) }

/** 不支持抓取这种 URL：`expected` 是支持的形态。 */
function unsupportedFetchUrl(message, expected) { throw webFailure(FAILURE_CODES.inputUnsupported, `DeepSeek ${message}`, { what: '抓取 URL', expected }) }

/** 服务返回的载荷不合合同：带 `issues`，`path` 指出哪一层不成立。 */
function invalidResponse(message, path, issue) { throw webFailure(FAILURE_CODES.contractInvalidResponse, `DeepSeek ${message}`, { issues: [{ path, message: issue }] }) }

export function validateFetchUrl(value) {
  if (typeof value !== 'string' || Array.from(value).length > 8192) unsupportedFetchUrl('抓取 URL 必须是长度不超过 8192 的 HTTP(S) 地址。', '长度不超过 8192 的 HTTP(S) 地址')
  let url
  try { url = new URL(value) } catch { unsupportedFetchUrl('抓取 URL 必须是无嵌入凭据的 HTTP(S) 地址。', '无嵌入凭据的 HTTP(S) 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) unsupportedFetchUrl('抓取 URL 必须是无嵌入凭据的 HTTP(S) 地址。', '无嵌入凭据的 HTTP(S) 地址')
  return value
}

/** Preserve every response field, including full body and ranking/site metadata. */
export async function searchDeepSeek(apiKey, input, signal) {
  if (typeof input.query !== 'string' || !input.query.trim() || Array.from(input.query).length > 128) invalidInput('搜索词必须是 1–128 个字符，且不能全为空白。', '搜索词')
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 50) invalidInput('搜索条数必须在 1–50 之间。', '搜索条数')
  const value = await request('search', input, apiKey, signal)
  if (!Array.isArray(value?.results)) invalidResponse('搜索响应缺少 results。', 'results', '搜索结果必须是数组')
  for (const row of value.results) {
    if (!row || !['url', 'title', 'snippet', 'summary', 'content'].every(key => typeof row[key] === 'string')) invalidResponse('搜索响应包含无效条目。', 'results', '每个条目都必须带字符串字段 url、title、snippet、summary、content')
  }
  return {
    content: JSON.stringify(value, null, 2),
    sources: value.results.map(row => ({ url: row.url, title: row.title, snippet: row.snippet, ...(typeof row.date === 'string' ? { publishedAt: row.date } : {}) })),
    truncated: false
  }
}

/** The API does not report the origin HTTP status or final redirect URL. */
export async function fetchDeepSeek(apiKey, input, signal) {
  validateFetchUrl(input.url)
  const value = await request('fetch', { url: input.url }, apiKey, signal)
  if (typeof value?.title !== 'string' || typeof value?.content !== 'string') invalidResponse('抓取响应缺少 title 或 content。', 'title', '抓取响应必须带字符串 title 与 content')
  return {
    url: input.url, statusCode: null,
    body: { kind: 'text', content: value.title ? `# ${value.title}\n\n${value.content}` : value.content },
    truncated: false
  }
}

/** Test both paid capabilities; no credential is persisted here. */
export async function testDeepSeekConnection(apiKey, signal) {
  const timeout = AbortSignal.timeout(30000)
  const controller = new AbortController()
  const combined = AbortSignal.any([timeout, controller.signal, ...(signal ? [signal] : [])])
  let firstFailure
  const settle = promise => promise.catch(error => { if (firstFailure === undefined) firstFailure = error; controller.abort(); throw error })
  try {
    await Promise.allSettled([
      settle(searchDeepSeek(apiKey, { query: 'DeepSeek', count: 1, need_content: false }, combined)),
      settle(fetchDeepSeek(apiKey, { url: 'https://api-docs.deepseek.com/zh-cn/guides/search/' }, combined))
    ])
    if (firstFailure !== undefined) throw firstFailure
    return { ok: true, provider: 'deepseek_api', search: true, fetch: true }
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw webFailure(FAILURE_CODES.timeoutExpired, 'DeepSeek 联网连接测试超时。', { what: 'DeepSeek 联网连接测试' })
    throw error
  }
}
