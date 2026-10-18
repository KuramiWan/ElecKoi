import { WebError } from '@deepseek-ai/dsh-web'

export const DEEPSEEK_API_PROVIDER = 'eleckoi-deepseek-api'
export const DEEPSEEK_WEB_KEY_REF = 'DEEPSEEK_WEB_API_KEY'
export const DEEPSEEK_WEB_NAMESPACE = 'eleckoi-web-deepseek'
const ENDPOINT = 'https://api.deepseek.com/v1/tools/'

/** Only the documented DeepSeek tool endpoints receive the API credential. */
async function request(method, input, apiKey, signal) {
  signal?.throwIfAborted()
  const key = apiKey.trim()
  if (!key) throw new WebError('请先配置 DeepSeek 联网 API Key。', 'WEB_PROVIDER_CREDENTIAL_MISSING')
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
    throw new WebError(response ? 'DeepSeek 联网接口返回了无效 JSON。' : 'DeepSeek 联网请求失败，请检查网络连接。', 'WEB_PROVIDER_ERROR')
  }
  signal?.throwIfAborted()
  if (!response.ok) {
    const reasons = { 401: 'API Key 无效', 402: '账户余额不足', 403: '网页访问被拒绝', 404: '网页不可用', 408: '请求超时', 429: '请求过于频繁，请稍后重试', 500: '服务内部错误', 504: '下游服务超时' }
    const message = typeof value?.error?.message === 'string' ? value.error.message.split(key).join('[REDACTED]') : ''
    throw new WebError(`DeepSeek ${method} 失败（HTTP ${response.status}）${reasons[response.status] ? `：${reasons[response.status]}` : ''}${message ? ` · ${message}` : ''}`, 'WEB_PROVIDER_ERROR')
  }
  return value
}

function invalid(message) { throw new WebError(`DeepSeek ${message}`, 'WEB_PROVIDER_ERROR') }

export function validateFetchUrl(value) {
  if (typeof value !== 'string' || Array.from(value).length > 8192) invalid('抓取 URL 必须是长度不超过 8192 的 HTTP(S) 地址。')
  let url
  try { url = new URL(value) } catch { invalid('抓取 URL 必须是无嵌入凭据的 HTTP(S) 地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid('抓取 URL 必须是无嵌入凭据的 HTTP(S) 地址。')
  return value
}

/** Preserve every response field, including full body and ranking/site metadata. */
export async function searchDeepSeek(apiKey, input, signal) {
  if (typeof input.query !== 'string' || !input.query.trim() || Array.from(input.query).length > 128) invalid('搜索词必须是 1–128 个字符，且不能全为空白。')
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 50) invalid('搜索条数必须在 1–50 之间。')
  const value = await request('search', input, apiKey, signal)
  if (!Array.isArray(value?.results)) invalid('搜索响应缺少 results。')
  for (const row of value.results) {
    if (!row || !['url', 'title', 'snippet', 'summary', 'content'].every(key => typeof row[key] === 'string')) invalid('搜索响应包含无效条目。')
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
  if (typeof value?.title !== 'string' || typeof value?.content !== 'string') invalid('抓取响应缺少 title 或 content。')
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
    if (timeout.aborted && !signal?.aborted) throw new WebError('DeepSeek 联网连接测试超时。', 'WEB_TIMEOUT')
    throw error
  }
}
