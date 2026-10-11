'use strict'

// Runs inside the actual Android application process, with wholly synthetic data.
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { createServer, request } = require('node:http')
const path = require('node:path')
const { createInterface } = require('node:readline')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const http = (url, options = {}) => new Promise((resolve, reject) => {
  const outgoing = request(url, { method: options.method ?? 'GET', headers: options.headers,
    agent: false, signal: AbortSignal.timeout(15000) }, incoming => {
    const chunks = []; let bytes = 0
    incoming.on('data', chunk => {
      bytes += chunk.length
      if (bytes > 8 * 1024 * 1024) incoming.destroy(new Error('Synthetic response exceeds its bound'))
      else chunks.push(chunk)
    })
    incoming.on('error', reject)
    incoming.on('end', () => {
      const headers = new Headers()
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
      resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers }))
    })
  })
  outgoing.on('error', reject); outgoing.end(options.body)
})
const bounded = async (promise, label, ms = 7000) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })]) }
  finally { clearTimeout(timer) }
}

async function main() {
  const rootfs = path.resolve(path.dirname(process.argv[3]), '../..')
  const app = path.join(path.dirname(rootfs), 'app')
  const temporary = path.resolve(rootfs, '../../../tmp/glibc-probe')
  const root = fs.mkdtempSync(path.join(temporary, 'synthetic-business-'))
  const config = path.join(root, 'host.json')
  fs.writeFileSync(config, JSON.stringify({ schemaVersion: 1, runtimeDataRoot: path.join(root, 'data'),
    homeRoot: path.join(root, 'home'), workspaceRoot: path.join(root, 'workspace'),
    productDatabasePath: path.join(root, 'data/probe.db'), productMediaRoot: path.join(root, 'media'),
    resourceRoot: path.join(app, 'resources/dsh') }))
  let host, exit, client, conversationId, primaryError, passed = false, requests = 0
  const phase = name => console.log(JSON.stringify({ phase: name, time: Date.now() }))
  const held = Promise.withResolvers(), cancelled = Promise.withResolvers()
  const modelServer = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses')
      let body = ''; for await (const chunk of request) { body += chunk; assert(body.length < 1024 * 1024) }
      assert.equal(JSON.parse(body).model, 'example-model')
      assert.equal(request.headers.authorization, 'Bearer synthetic-key')
      assert(++requests <= 2)
      const text = requests === 1 ? 'Synthetic Android reply' : 'Synthetic unfinished reply'
      const item = { id: `synthetic-message-${requests}`, type: 'message', role: 'assistant', content: [] }
      const wire = rows => rows.map(row => `event: ${row.type}\ndata: ${JSON.stringify(row)}\n\n`).join('')
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(wire([
        { type: 'response.created', response: { id: 'synthetic-response', model: 'example-model', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: item.id, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text }
      ]))
      if (requests === 2) { response.once('close', () => cancelled.resolve()); held.resolve(); return }
      response.end(wire([{ type: 'response.completed', response: { id: 'synthetic-response', model: 'example-model', status: 'completed',
        output: [{ ...item, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]))
    } catch (error) { response.destroy(); held.reject(error); held.promise.catch(() => {}) }
  })
  const stop = async () => {
    if (!host) return
    const current = host
    current.stdin.end('{"type":"shutdown"}\n')
    try { assert.equal(await bounded(exit, 'Synthetic Host failed to close'), 0) }
    finally { if (current.exitCode === null) current.kill('SIGKILL'); host = undefined }
  }
  const start = async () => {
    const ready = Promise.withResolvers()
    const log = fs.createWriteStream(path.join(root, 'host.log'), { flags: 'a' })
    host = spawn(process.execPath, [path.join(app, 'bin/eleckoi-host.mjs'), '--config', config],
      { env: { ...process.env, HOME: path.join(root, 'home'), DSH_HOME: path.join(root, 'home'), DSH_TELEMETRY_DISABLED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'] })
    exit = new Promise((resolve, reject) => {
      host.once('error', error => { ready.reject(error); reject(error) })
      host.once('exit', code => { log.end(); ready.reject(new Error(`Synthetic Host exited ${code}`)); resolve(code) })
    })
    host.stdout.on('data', value => log.write(value)); host.stderr.on('data', value => log.write(value))
    const lines = createInterface({ input: host.stdout })
    lines.on('line', line => {
      if (!line.startsWith('ELECKOI_HOST\t')) return
      const message = JSON.parse(line.slice('ELECKOI_HOST\t'.length))
      if (message.type === 'ready') ready.resolve(message)
      if (message.type === 'fatal') ready.reject(new Error(message.message))
    })
    const state = await bounded(ready.promise, 'Synthetic Host never became ready')
    phase('host-ready')
    const origin = new URL(state.url)
    assert.equal(origin.hostname, '127.0.0.1')
    assert.equal((await http(state.healthUrl)).status, 200)
    phase('health')
    const handshake = await http(state.url)
    assert.equal(handshake.status, 303)
    const cookie = handshake.headers.get('set-cookie')?.split(';', 1)[0]
    assert(cookie); await handshake.body?.cancel()
    phase('authenticated')
    client = async (method, args) => {
      const rpcId = randomUUID()
      phase(`remote-start:${method}`)
      const response = await http(new URL(`/api/${method}`, origin), { method: 'POST',
        headers: { cookie, origin: origin.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) })
      assert.equal(response.status, 200, method)
      const envelope = await response.json()
      assert.equal(envelope.type, 'server-response'); assert.equal(envelope.rpcId, rpcId)
      assert.equal(envelope.result.ok, true, `${method}: ${JSON.stringify(envelope.result.error)}`)
      phase(`remote-complete:${method}`)
      return envelope.result.value
    }
  }
  const events = async () => {
    const projection = await client('session/projections', { request: { sessionId: conversationId } })
    const page = await client('session/page', { request: { address: { kind: 'session', sessionId: conversationId }, throughSeq: projection.asOfSeq, maxMessages: 100 } })
    return page.records.map(record => record.event)
  }
  const settled = async count => {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      const value = await events()
      if (value.filter(event => event.type === 'turn/end').length === count) return value
      await pause(100)
    }
    throw new Error(`Synthetic turn ${count} never settled`)
  }
  try {
    await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve))
    await start()
    assert.deepEqual(await client('eleckoiConversations/list', {}), [])
    const namespaces = (await client('settings/describe', {})).namespaces.filter(row => row.ns === 'llm-pi-ai')
    assert.equal(namespaces.length, 1)
    await client('settings/mutate', { ns: 'llm-pi-ai', expectedRevision: namespaces[0].revision,
      ops: [{ op: 'set', path: ['providers', 'synthetic-android'], value: { api: 'openai-responses',
        baseURL: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKeyEnv: 'SYNTHETIC_ANDROID_KEY',
        models: [{ id: 'example-model', contextWindow: 65536, maxTokens: 8192, input: ['text'] }] } }] })
    await client('credentials/set', { ref: 'SYNTHETIC_ANDROID_KEY', value: 'synthetic-key' })
    conversationId = (await client('eleckoiConversations/create', { input: { title: 'Synthetic Android probe' } })).conversation.id
    phase('conversation-created')
    const selection = { provider: 'synthetic-android', model: 'example-model' }
    await client('eleckoiConversationModels/select', { conversationId, selection })
    const prompt = async text => {
      const prepared = await client('eleckoiConversations/preparePrompt', { conversationId, text })
      assert.equal(prepared.runtimeSessionId, conversationId)
      await client('session/prompt', { request: { requestId: randomUUID(), sessionId: conversationId, mode: 'queue', content: [{ type: 'text', text }] } })
      return prepared.operationId
    }
    const first = await prompt('Synthetic input')
    const completed = await settled(1)
    assert(completed.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed'))
    assert(completed.some(event => event.type === 'assistant/message' && event.data.message.content.some(part => part.type === 'text' && part.text === 'Synthetic Android reply')))
    await client('eleckoiConversations/waitForGeneration', { conversationId, operationId: first })
    phase('first-turn-completed')
    const second = await prompt('Synthetic cancellation')
    await bounded(held.promise, 'Synthetic second request did not arrive')
    await client('session/cancel', { request: { sessionId: conversationId } })
    await bounded(cancelled.promise, 'Synthetic cancellation did not close the connection')
    const stopped = await settled(2)
    assert(stopped.some(event => event.type === 'turn/end' && event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'user'))
    await client('eleckoiConversations/waitForGeneration', { conversationId, operationId: second })
    phase('second-turn-cancelled')
    await stop(); await start()
    assert.deepEqual(await client('eleckoiConversationModels/current', { conversationId }), selection)
    assert((await client('eleckoiConversations/list', {})).some(row => row.id === conversationId))
    assert.deepEqual(await events(), stopped)
    passed = true
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      try { await stop() }
      catch (error) {
        if (primaryError) throw new Error(`${primaryError.stack}\nCleanup: ${error.stack}`)
        throw error
      }
    }
    finally { modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve)) }
  }
  if (passed) fs.rmSync(root, { recursive: true, force: true })
  console.log(JSON.stringify({ test: 'isolated-host-send-cancel-reopen', ok: true, requests }))
}
main().catch(error => { console.log(JSON.stringify({ test: 'isolated-host-send-cancel-reopen', ok: false, error: error.stack })); process.exitCode = 1 })
