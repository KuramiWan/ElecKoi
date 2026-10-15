import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as deepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import { createServer } from 'node:http'
import { expect } from 'vitest'

export async function captureSerializedRequest(api, request) {
  const captured = []
  const server = createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    captured.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Synthetic request captured.' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const ctx = new Context()
  ctx.provide('credentials', { resolve: async () => ({ value: 'synthetic-wire-value', source: 'test' }) })
  try {
    await ctx.plugin(LlmRuntime)
    const baseURL = `http://127.0.0.1:${server.address().port}/v1`
    const retryPolicy = { mode: 'normal', maxRetries: 0 }
    const provider = api === 'deepseek_messages' ? 'deepseek-official' : 'synthetic-wire-provider'
    if (api === 'deepseek_messages') await ctx.plugin(deepSeek, { baseURL, retryPolicy, models: [{ id: 'synthetic-wire-model' }] })
    else await ctx.plugin(piAi, { providers: { [provider]: { baseURL, api, apiKeyEnv: 'SYNTHETIC_KEY', retryPolicy, models: [{ id: 'synthetic-wire-model' }] } } })
    await Array.fromAsync(ctx.llm.stream({ provider, model: 'synthetic-wire-model', messages: request.messages, tools: request.tools,
      maxTokens: 128, signal: AbortSignal.timeout(10_000) }))
    expect(captured, api).toHaveLength(1)
    return captured[0]
  } finally {
    await ctx.fiber.dispose()
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}
