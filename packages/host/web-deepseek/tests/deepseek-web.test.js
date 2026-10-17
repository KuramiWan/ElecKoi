import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as webTools from '@deepseek-ai/dsh-tool-web'
import * as provider from '../src/index.js'
import { searchDeepSeek, fetchDeepSeek, testDeepSeekConnection } from '../src/api.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
const cleanups = []
afterEach(async () => { vi.unstubAllGlobals(); for (const stop of cleanups.splice(0).reverse()) await stop() })
const row = (i, content = '') => ({ title: `标题-${i}`, url: `https://example.com/${i}`, snippet: `片段-${i}`, summary: `摘要-${i}`, content,
  site_name: '合成来源', site_icon: null, date: '2026-10-17T00:00:00Z', rerank_score: 3, authority: 4 })
const response = value => new Response(JSON.stringify(value), { status: 200 })
async function fixture() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  let key = 'synthetic-first-key'
  ctx.provide('credentials', { resolve: async () => ({ value: key }) })
  await ctx.plugin(WebRuntime, { searchProvider: 'eleckoi-deepseek-api', fetchProvider: 'eleckoi-deepseek-api' })
  const fiber = await ctx.plugin(provider, { count: 50, needContent: true })
  await ctx.plugin(Tools)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(webTools, { searchMaxResults: 0, fetchMaxOutputChars: 0 })
  return { ctx, fiber, rotateKey: value => { key = value } }
}
describe('DeepSeek standalone Web provider', () => {
  it('preserves all 50 results and long first/middle/last bodies through the official tools', async () => {
    const f = await fixture()
    const rows = Array.from({ length: 50 }, (_, i) => row(i, `${'合成正文𠮷😀'.repeat([0, 25, 49].includes(i) ? 25001 : 1)}尾部-${i}`))
    const request = vi.fn(async () => response({ results: rows }))
    vi.stubGlobal('fetch', request)
    const tool = f.ctx.tools.get('web_search')
    const value = await tool.execute({ queries: ['完整搜索'] }, { signal: new AbortController().signal })
    expect(value.sources).toHaveLength(50)
    expect(value.truncated).toBe(false)
    expect(JSON.parse(value.content).results).toEqual(rows)
    const rendered = tool.output.render({ queries: ['完整搜索'] }, value)[0].text
    for (const index of [0, 25, 49]) expect(rendered).toContain(`尾部-${index}`)
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ query: '完整搜索', count: 50, need_content: true, localization: '' })
    expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/tools/search')
    f.rotateKey('synthetic-second-key'); await f.ctx.web.search({ query: '新密钥' })
    expect(request.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic-second-key')
  })
  it('preserves full Markdown beyond the former cap without inventing an origin status or redirect', async () => {
    const { ctx } = await fixture(), content = `${'完整 Markdown𠮷😀'.repeat(30001)}抓取末尾`
    vi.stubGlobal('fetch', vi.fn(async () => response({ title: '页面标题', content })))
    const tool = ctx.tools.get('web_fetch'), args = { url: 'https://example.com/requested' }
    const value = await tool.execute(args, { signal: new AbortController().signal })
    expect(value).toMatchObject({ url: args.url, statusCode: null, truncated: false })
    expect(value.body.content).toBe(`# 页面标题\n\n${content}`)
    const output = tool.output.render(args, value)[0].text
    expect(output).toContain('源站 HTTP 状态未提供')
    expect(output).not.toContain('HTTP 200')
    expect(output).toContain('抓取末尾')
    expect(tool.output.presentationMeta(args, value).truncated).toBe(false)
    expect(tool.presentResult(args, { meta: tool.output.presentationMeta(args, value) })).toBeUndefined()
    expect(tool.presentResult(args, { meta: { url: args.url, statusCode: 200, truncated: false } })).toMatchObject({ card: 'web', kind: 'fetch', statusCode: 200 })
  })
  it('keeps all sources across multiple queries', async () => {
    const { ctx } = await fixture()
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => response({ results: Array.from({ length: 50 }, (_, i) => row(`${JSON.parse(init.body).query}-${i}`)) })))
    const value = await ctx.tools.get('web_search').execute({ queries: ['甲', '乙'] }, { signal: new AbortController().signal })
    expect(value.sources).toHaveLength(100); expect(value.truncated).toBe(false)
  })
  it('enforces documented Unicode query and URL constraints without rewriting input', async () => {
    const request = vi.fn(async () => response({ results: [] })); vi.stubGlobal('fetch', request)
    await searchDeepSeek('synthetic', { query: '𠮷'.repeat(128), count: 1 })
    for (const query of ['', '   ', '𠮷'.repeat(129)]) await expect(searchDeepSeek('synthetic', { query, count: 1 })).rejects.toThrow('1–128')
    for (const count of [0, 51, 1.5]) await expect(searchDeepSeek('synthetic', { query: 'a', count })).rejects.toThrow('1–50')
    for (const url of ['file:///private', 'https://key:secret@example.com', 'https://example.com/' + 'x'.repeat(8192)]) await expect(fetchDeepSeek('synthetic', { url })).rejects.toThrow('URL')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([401, 402, 403, 404, 408, 429, 500, 504])('reports API HTTP %i and redacts credentials without retries', async status => {
    const request = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'failed synthetic-secret' } }), { status })); vi.stubGlobal('fetch', request)
    await expect(fetchDeepSeek('synthetic-secret', { url: 'https://example.com' })).rejects.toThrow(`HTTP ${status}`)
    await expect(fetchDeepSeek('synthetic-secret', { url: 'https://example.com' })).rejects.toThrow('[REDACTED]')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('distinguishes empty results from malformed data and missing credentials', async () => {
    const request = vi.fn(async () => response({ results: [] })); vi.stubGlobal('fetch', request)
    await expect(searchDeepSeek('', { query: 'a', count: 1 })).rejects.toThrow('API Key'); expect(request).not.toHaveBeenCalled()
    await expect(searchDeepSeek('synthetic', { query: 'a', count: 1 })).resolves.toMatchObject({ sources: [], truncated: false })
    request.mockImplementation(async () => response({}))
    await expect(searchDeepSeek('synthetic', { query: 'a', count: 1 })).rejects.toThrow('缺少 results')
    await expect(fetchDeepSeek('synthetic', { url: 'https://example.com' })).rejects.toThrow('title 或 content')
  })
  it('aborts in-flight calls and unregisters providers on disposal', async () => {
    const { ctx, fiber } = await fixture()
    let started; const ready = new Promise(resolve => { started = resolve })
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => { started(); init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }) })))
    const pending = ctx.web.fetch({ url: 'https://example.com' }), rejection = expect(pending).rejects.toThrow('已取消')
    await ready; await fiber.dispose(); await rejection
    await expect(ctx.web.search({ query: 'a' })).rejects.toThrow()
    await expect(ctx.web.fetch({ url: 'https://example.com' })).rejects.toThrow()
  })
  it('tests both capabilities without returning credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/search') ? response({ results: [row(0)] }) : response({ title: '', content: '正文' })))
    await expect(testDeepSeekConnection('synthetic-secret')).resolves.toEqual({ ok: true, provider: 'deepseek_api', search: true, fetch: true })
  })
})
