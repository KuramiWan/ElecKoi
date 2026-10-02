import type { TavilyConnection } from './types.js'

const BASE_URL = 'https://api.tavily.com'
const RESPONSE_LIMIT = 2 * 1024 * 1024
const ERROR_LIMIT = 32 * 1024

export async function testTavilyConnection(apiKey: string, signal?: AbortSignal): Promise<TavilyConnection> {
  const key = validateApiKey(apiKey)
  const timeout = AbortSignal.timeout(15_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    return await testUsage(key, requestSignal)
  } catch (error) {
    if (signal?.aborted) throw new Error('Tavily 连接测试已取消。')
    if (timeout.aborted) throw new Error('Tavily 连接测试超时，请检查网络连接。')
    throw error
  }
}

async function testUsage(key: string, signal: AbortSignal): Promise<TavilyConnection> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}/usage`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Project-ID': 'eleckoi'
      },
      signal
    })
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw new Error('Tavily 连接测试已取消。', { cause: error })
    throw new Error('Tavily 连接测试失败，请检查网络连接。', { cause: error })
  }
  const body = await readBoundedBody(response, response.ok ? RESPONSE_LIMIT : ERROR_LIMIT)
  if (!response.ok) throw new Error(publicHttpError(response.status, body, key))
  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    payload = parsed as Record<string, unknown>
  } catch (error) {
    throw new Error('Tavily 连接测试返回了无效 JSON。', { cause: error })
  }
  const keyUsage = objectValue(payload.key)
  const account = objectValue(payload.account)
  return {
    ok: true,
    plan: stringValue(account?.current_plan) || 'Unknown',
    used: integerValue(keyUsage?.usage) ?? integerValue(account?.plan_usage) ?? 0,
    limit: integerValue(keyUsage?.limit) ?? integerValue(account?.plan_limit) ?? 0
  }
}

function validateApiKey(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('请先填写 Tavily API Key。')
  if (normalized.length > 2_048) throw new Error('Tavily API Key 长度无效。')
  return normalized
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > limit) throw new Error('Tavily 响应超过安全上限。')
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
      throw new Error('Tavily 响应超过安全上限。')
    }
    body += decoder.decode(part.value, { stream: true })
  }
  return body + decoder.decode()
}

function publicHttpError(status: number, body: string, apiKey: string): string {
  if (status === 401) return 'Tavily API Key 无效。'
  if (status === 429) return 'Tavily 请求过于频繁，请稍后重试。'
  if (status === 432 || status === 433) return 'Tavily 可用额度已耗尽。'
  const detail = body.split(apiKey).join('[REDACTED]').replace(/\s+/g, ' ').trim().slice(0, 600)
  return `Tavily API error (HTTP ${status})${detail ? `: ${detail}` : ''}`
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
