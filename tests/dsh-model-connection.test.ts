import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { discoverDraftModels, testModelConnection, readModelApiKey } from '@eleckoi/dsh-product-api'

describe('DSH model connection probe', () => {
  it('reveals only the saved credential belonging to an existing visible configuration', async () => {
    const resolve = vi.fn(async () => ({ value: 'synthetic-stored-value' }));
    const owner = { settings: { describe: () => [
      { ns: 'eleckoi-client-models', value: { entries: {
        'config-test': { credentialRef: 'SYNTHETIC_REF' }, hidden: { hidden: true, credentialRef: 'HIDDEN_REF' },
      } } },
      { ns: 'llm-pi-ai', value: { providers: { profile: { apiKeyEnv: 'PROFILE_REF' } } } },
      { ns: 'llm-deepseek', value: { apiKeyEnv: 'DEDICATED_REF' } },
    ] }, credentials: { resolve } } as unknown as Context;
    for (const [id, ref] of [['config-test', 'SYNTHETIC_REF'], ['profile', 'PROFILE_REF'], ['deepseek-official', 'DEDICATED_REF']]) {
      await expect(readModelApiKey(owner, id!)).resolves.toBe('synthetic-stored-value');
      expect(resolve).toHaveBeenLastCalledWith(ref);
    }
    for (const id of ['hidden', 'unknown']) await expect(readModelApiKey(owner, id)).rejects.toThrow('模型配置不存在');
    expect(resolve).toHaveBeenCalledTimes(3);
    resolve.mockResolvedValueOnce(undefined as never);
    await expect(readModelApiKey(owner, 'config-test')).rejects.toThrow('没有已保存');
  });
  it('reads the official dedicated directory without credentials, network calls, or settings writes', async () => {
    const mutate = vi.fn()
    const set = vi.fn()
    const owner = { settings: { describe: () => [{ ns: 'llm-deepseek', value: { thinking: 'disabled', models: [] } }], mutate },
      credentials: { resolve: async () => undefined, set } } as unknown as Context
    const models = await discoverDraftModels(owner, { configId: 'deepseek-official', api: 'deepseek_messages', baseURL: 'http://127.0.0.1:1' })
    expect(models.length).toBeGreaterThan(0)
    expect(models.every(model => model.contextWindow && model.maxTokens)).toBe(true)
    expect(models.every(model => Object.keys(model.reasoningEfforts || {}).join() === 'off')).toBe(true)
    expect(set).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it.each([true, false])('discovers with draft endpoint, headers and credential isolation (typed key: %s)', async typed => {
    const requests: any[] = []
    const server = createServer((request, response) => {
      requests.push({ path: request.url, headers: request.headers })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'example-discovered-model' }] }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const mutate = vi.fn()
    const set = vi.fn()
    const resolveKey = vi.fn(async () => ({ value: 'synthetic-stored-value' }))
    const owner = { settings: { describe: () => [{ ns: 'eleckoi-client-models', value: { entries: { 'config-test': { credentialRef: 'SYNTHETIC_REF' } } } }], mutate },
      credentials: { resolve: resolveKey, set } } as unknown as Context
    try {
      const models = await discoverDraftModels(owner, { configId: 'config-test', api: 'openai-completions',
        baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        ...(typed ? { apiKey: 'synthetic-draft-value' } : {}), headers: { 'x-model-probe': 'synthetic-header' } })
      expect(models).toEqual([{ id: 'example-discovered-model', name: 'example-discovered-model' }])
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ path: '/v1/models', headers: {
        authorization: `Bearer ${typed ? 'synthetic-draft-value' : 'synthetic-stored-value'}`, 'x-model-probe': 'synthetic-header' } })
      expect(set).not.toHaveBeenCalled()
      expect(mutate).not.toHaveBeenCalled()
      if (typed) expect(resolveKey).not.toHaveBeenCalled()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }, 15_000)

  it.each(['{"nonce":"eleckoi-tool-probe"}', '{invalid'])('uses the official adapter and never writes settings or credentials (%s)', async argumentsText => {
    const requests: any[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'probe-response', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'probe-call', type: 'function',
          function: { name: 'eleckoi_connection_probe', arguments: argumentsText } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const set = vi.fn()
    const mutate = vi.fn()
    const owner = { settings: { describe: () => [], mutate }, credentials: { resolve: async () => undefined, set } } as unknown as Context
    try {
      const operation = testModelConnection(owner, { configId: 'config-test', model: 'example-model', api: 'openai-completions',
        baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: 'synthetic-probe-value' })
      if (argumentsText === '{invalid') await expect(operation).rejects.toThrow('参数')
      else await expect(operation).resolves.toEqual({ supported: true })
      expect(requests).toHaveLength(1)
      expect(requests[0].tools[0].function.name).toBe('eleckoi_connection_probe')
      expect(set).not.toHaveBeenCalled()
      expect(mutate).not.toHaveBeenCalled()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }, 15_000)
})
