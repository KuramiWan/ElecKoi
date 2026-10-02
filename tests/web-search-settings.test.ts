import { afterEach, describe, expect, it, vi } from 'vitest'
import { testTavilyConnection } from '../packages/dsh-product-api/lib/types/tavily.js'

afterEach(() => vi.unstubAllGlobals())

describe('Tavily Host connection test', () => {
  it('uses the usage endpoint and returns only account information', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      key: { usage: 12, limit: 100 }, account: { current_plan: 'Project' }
    }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    await expect(testTavilyConnection('synthetic-key')).resolves.toEqual({
      ok: true, plan: 'Project', used: 12, limit: 100
    })
    expect(request).toHaveBeenCalledWith('https://api.tavily.com/usage', expect.objectContaining({
      method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-key' })
    }))
  })

  it('rejects missing credentials without a request and redacts credentials from errors', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('failed synthetic-key', { status: 500 }))
    vi.stubGlobal('fetch', request)
    await expect(testTavilyConnection('')).rejects.toThrow('请先填写')
    expect(request).not.toHaveBeenCalled()
    await expect(testTavilyConnection('synthetic-key')).rejects.toThrow('[REDACTED]')
  })

  it('rejects oversized responses and propagates cancellation', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', {
      status: 200, headers: { 'content-length': String(3 * 1024 * 1024) }
    }))
    vi.stubGlobal('fetch', request)
    await expect(testTavilyConnection('synthetic-key')).rejects.toThrow('超过安全上限')
    const abort = new AbortController()
    abort.abort()
    request.mockImplementation(async (_input, init) => { init?.signal?.throwIfAborted(); throw new Error('unreachable') })
    await expect(testTavilyConnection('synthetic-key', abort.signal)).rejects.toThrow('已取消')
  })
})
