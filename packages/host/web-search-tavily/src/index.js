import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import { FAILURE_CODES, webFailure } from './failure.js'

export const name = 'eleckoi-web-search-tavily'
export const inject = ['web']
export const TAVILY_API_KEY_REF = 'TAVILY_API_KEY'

export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(TAVILY_API_KEY_REF).volatile(),
  maxResults: z.number().step(1).min(1).max(8).default(5).volatile()
})

const BASE_URL = 'https://api.tavily.com'
const RESPONSE_LIMIT = 2 * 1024 * 1024
const ERROR_LIMIT = 32 * 1024

export function apply(ctx, config) {
  ctx.web.registerSearchProvider({
    id: 'tavily',
    available() {
      return ctx.get('credentials') !== undefined
    },
    async search(request, signal) {
      const apiKeyRef = credentialRef(config.apiKeyEnv.get())
      const maxResults = config.maxResults.get()
      const apiKey = (await ctx.get('credentials')?.resolve(apiKeyRef))?.value?.trim() ?? ''
      if (!apiKey) throw webFailure(FAILURE_CODES.modelConfigInvalid, 'Tavily API Key 尚未配置', { field: 'Tavily API Key', what: '联网搜索密钥' })
      let response
      try {
        response = await fetch(`${BASE_URL}/search`, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Project-ID': 'eleckoi',
            'User-Agent': 'ElecKoi-Desktop/0.1'
          },
          body: JSON.stringify({
            query: String(request.query ?? ''),
            topic: 'general',
            search_depth: 'basic',
            max_results: Math.min(
              integerInRange(request.maxResults, 1, 8, maxResults),
              maxResults
            ),
            include_answer: false,
            include_raw_content: false,
            include_images: false,
            include_favicon: false,
            include_usage: true
          }),
          ...(signal ? { signal } : {})
        })
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
        }
        throw webFailure(FAILURE_CODES.netOperationFailed, 'Tavily 搜索请求失败，请检查网络连接。', { operation: 'request', what: 'Tavily 搜索接口' }, { cause: error })
      }

      const body = await readBoundedBody(response, response.ok ? RESPONSE_LIMIT : ERROR_LIMIT)
      if (!response.ok) throw httpFailure(response.status, body, apiKey)
      let payload
      try {
        payload = JSON.parse(body)
      } catch (error) {
        throw webFailure(FAILURE_CODES.contractInvalidResponse, 'Tavily 返回了无效 JSON。', { issues: [{ path: '', message: '响应不是合法 JSON' }] }, { cause: error })
      }
      return {
        sources: Array.isArray(payload?.results) ? payload.results.map(normalizeResult).filter(Boolean) : [],
        truncated: false
      }
    }
  })
}

function normalizeResult(result) {
  if (!result || typeof result !== 'object') return undefined
  const url = safeUrl(result.url)
  if (!url) return undefined
  const title = typeof result.title === 'string' ? result.title : ''
  const snippet = typeof result.content === 'string' ? result.content : ''
  return { url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) }
}

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return ''
    return url.toString()
  } catch {
    return ''
  }
}

async function readBoundedBody(response, limit) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > limit) {
    throw webFailure(FAILURE_CODES.netOperationFailed, 'Tavily 响应超过安全上限。', { operation: 'request', what: 'Tavily 搜索响应' })
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let bytes = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > limit) {
      await reader.cancel()
      throw webFailure(FAILURE_CODES.netOperationFailed, 'Tavily 响应超过安全上限。', { operation: 'request', what: 'Tavily 搜索响应' })
    }
    body += decoder.decode(part.value, { stream: true })
  }
  return body + decoder.decode()
}

function httpFailure(status, body, apiKey) {
  // 401 是密钥配置问题，不是网络故障：按模型配置折码，用户句才说得出该改哪里。
  if (status === 401) return webFailure(FAILURE_CODES.modelConfigInvalid, 'Tavily API Key 无效。', { field: 'Tavily API Key', what: '联网搜索密钥' })
  return webFailure(FAILURE_CODES.netOperationFailed, publicHttpError(status, body, apiKey), { operation: 'request', what: 'Tavily 搜索接口' })
}

function publicHttpError(status, body, apiKey) {
  if (status === 429) return 'Tavily 请求过于频繁，请稍后重试。'
  if (status === 432 || status === 433) return 'Tavily 可用额度已耗尽。'
  const detail = String(body).split(apiKey).join('[REDACTED]').replace(/\s+/g, ' ').trim().slice(0, 600)
  return `Tavily API error (HTTP ${status})${detail ? `: ${detail}` : ''}`
}

function integerInRange(value, min, max, fallback) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}
