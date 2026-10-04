import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, BlockAssembler } from '@deepseek-ai/dsh-llm'
import * as deepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import { describe, expect, it } from 'vitest'
import { requestSnapshot } from '../packages/dsh-client-roleplay/src/host/session-runtime.mjs'

describe('model request parameters', () => {
  it('carries saved sampling and compaction parameters into main and subagent request snapshots', () => {
    const ctx = { settings: { describe: () => [{ ns: 'eleckoi-client-models', value: { entries: {
      'example-provider': { parameters: { 'example-model': { temperature: 0, topP: 0.96, autoCompactTokenLimit: 32000, reasoningEffort: 'high' } } },
    } } }] } }
    expect(requestSnapshot(ctx, { provider: 'example-provider', model: 'example-model' }, { contextWindow: 65536, defaultMaxTokens: 8192 }))
      .toMatchObject({ temperature: 0, topP: 0.96, autoCompactTokenLimit: 32000, maxTokens: 8192, contextWindow: 65536, reasoningEffort: 'high' })
    expect(requestSnapshot(ctx, { provider: 'example-provider', model: 'example-model', reasoningEffort: 'low' },
      { contextWindow: 65536, defaultMaxTokens: 8192 })).toMatchObject({ reasoningEffort: 'high' })
  })

  it.each(['deepseek_messages', 'openai-completions', 'openai-responses'])('sends Top P through the official %s serializer', async api => {
    const requests = []
    const server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Synthetic request captured.' } }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: 'synthetic-probe-value', source: 'test' }) })
    try {
      await ctx.plugin(LlmRuntime)
      const baseURL = `http://127.0.0.1:${server.address().port}/v1`
      const provider = api === 'deepseek_messages' ? 'deepseek-official' : 'example-provider'
      const retryPolicy = { mode: 'normal', maxRetries: 0 }
      if (api === 'deepseek_messages') await ctx.plugin(deepSeek, { baseURL, retryPolicy, models: [{ id: 'example-model' }] })
      else await ctx.plugin(piAi, { providers: { [provider]: { baseURL, api, apiKeyEnv: 'SYNTHETIC_KEY', retryPolicy, models: [{ id: 'example-model' }] } } })
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({ provider, model: 'example-model', topP: 0.96, temperature: 0.4,
        maxTokens: 128, messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic input.' }] }], signal: AbortSignal.timeout(5000) })) assembler.push(chunk)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ top_p: 0.96, temperature: 0.4 })
      expect(assembler.finish.kind).toBe('error')
    } finally {
      await ctx.fiber.dispose()
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }, 15_000)

  it('sends a custom profile reasoning effort through the official Responses serializer', async () => {
    const requests = []
    const server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Synthetic request captured.' } }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: 'synthetic-probe-value', source: 'test' }) })
    try {
      await ctx.plugin(LlmRuntime)
      const baseURL = `http://127.0.0.1:${server.address().port}/v1`
      await ctx.plugin(piAi, { providers: { 'example-provider': {
        baseURL,
        api: 'openai-responses',
        apiKeyEnv: 'SYNTHETIC_KEY',
        retryPolicy: { mode: 'normal', maxRetries: 0 },
        models: [{ id: 'example-model', reasoningEfforts: { off: null, low: 'low', high: 'high' } }],
      } } })
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({
        provider: 'example-provider',
        model: 'example-model',
        reasoningEffort: 'high',
        maxTokens: 128,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic input.' }] }],
        signal: AbortSignal.timeout(5000),
      })) assembler.push(chunk)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ reasoning: { effort: 'high' } })
      expect(assembler.finish.kind).toBe('error')
    } finally {
      await ctx.fiber.dispose()
      server.closeAllConnections()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }, 15_000)
})
