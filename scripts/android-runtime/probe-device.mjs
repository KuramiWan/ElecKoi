import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, parseArgs, promisify } from 'node:util'
import { deviceHttp } from './device-http.mjs'
import { inspectDeviceWebView } from './device-webview.mjs'

const { values } = parseArgs({ options: {
  adb: { type: 'string' }, serial: { type: 'string' }, install: { type: 'string' },
  'package-id': { type: 'string', default: 'com.eleckoi.app.dev' },
  variant: { type: 'string', default: 'standard' },
  'business-probe': { type: 'boolean', default: false }, help: { type: 'boolean' }
} })
if (values.help) {
  console.log('node scripts/android-runtime/probe-device.mjs [--adb PATH] [--serial SERIAL] [--package-id ID] [--variant standard] [--install APK] [--business-probe]')
  console.log('Default: start the installed debug Android app and verify its actual ARM64 Host, authenticated Remote and rendered WebView.')
  console.log('--business-probe requires an empty conversation list; temporarily selects a synthetic model, tests send/cancel/process restart, then removes its test data and restores the original selection.')
  console.log('WebView startup and authentication are inspected through its actual debugger. Touch interactions require separate checks. No desktop Host is launched.')
  process.exit(0)
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
const adbPath = values.adb || (sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb')
const runFile = promisify(execFile)
const invokeAdb = async args => (await runFile(adbPath, args, { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 })).stdout.trim()
const devices = (await invokeAdb(['devices', '-l'])).split(/\r?\n/).filter(line => /^\S+\s+(device|offline|unauthorized)\b/.test(line))
  .map(line => { const [serial, state] = line.split(/\s+/); return { serial, state } })
let target
if (values.serial) target = devices.find(device => device.serial === values.serial)
else {
  if (devices.length !== 1) throw new Error(devices.length === 0 ? 'No Android device is connected; device validation has not run.' : 'Multiple Android devices are present; pass --serial explicitly.')
  target = devices[0]
}
assert(target, 'The specified Android device is absent')
assert.equal(target.state, 'device', 'The selected Android device must be online and USB debugging authorized')
const adb = args => invokeAdb(['-s', target.serial, ...args])
const abis = (await adb(['shell', 'getprop', 'ro.product.cpu.abilist'])).split(',')
assert(abis.includes('arm64-v8a'), 'Device must support arm64-v8a; no emulator or desktop runtime is substituted')
const packageId = values['package-id']
assert(['com.eleckoi.app', 'com.eleckoi.app.dev'].includes(packageId), 'Unsupported Android application ID')
assert.equal(values.variant, 'standard', 'This probe requires the system WebView debugging protocol; GeckoView needs its browser integration checks')
const component = `${packageId}/com.eleckoi.app.MainActivity`
if (values.install) {
  const apk = resolve(values.install)
  const checked = await runFile(process.env.PYTHON || 'python', [join(repo, 'scripts/android-runtime/check-apk.py'), apk, '--variant', values.variant], { windowsHide: true, timeout: 120_000 })
  console.log(checked.stdout.trim())
  assert.match(await adb(['install', '-r', apk]), /(?:^|\r?\n)Success$/, 'APK installation did not complete successfully')
}
assert.match(await adb(['shell', 'pm', 'path', packageId]), /^package:/, 'The Android development app is not installed')
// run-as must succeed before starting the app or changing any device data.
await adb(['shell', 'run-as', packageId, 'pwd'])
let forwardPort, reversePort, modelServer, client, conversationId, originalSelection, providerAdded = false, keyAdded = false, selectionChanged = false
let generationPending = false, creationUncertain = false
const id = randomUUID().replaceAll('-', '')
const provider = `android-probe-${id}`, keyRef = `ELECKOI_ANDROID_PROBE_${id.toUpperCase()}`
const selection = { provider, model: 'example-model' }
const report = { schemaVersion: 1, actualDeviceHostValidated: false, businessProbePassed: false, webViewInspected: false }
const reportDirectory = join(repo, 'build/android-runtime/device-probe')
mkdirSync(reportDirectory, { recursive: true })
const reportPath = join(reportDirectory, `${id}.json`)
const pause = ms => new Promise(done => setTimeout(done, ms))
const bounded = async (promise, message) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 30_000) })]) }
  finally { clearTimeout(timer) }
}
async function start(previous) {
  assert.match(await adb(['shell', 'am', 'start', '-W', '-f', '0x20000000', '-n', component]), /Status: ok/, 'Android Activity did not start')
  const deadline = Date.now() + 300_000
  let lastPhase
  while (Date.now() < deadline) {
    const stateText = await adb(['shell', 'run-as', packageId, 'sh', '-c', "'if [ -f no_backup/unified-runtime/host-state.json ]; then cat no_backup/unified-runtime/host-state.json; fi'"])
    if (stateText) {
      const state = JSON.parse(stateText)
      assert.equal(state.schemaVersion, 1); assert.equal(state.protocolVersion, 1)
      if (state.phase !== lastPhase) { console.log(`Android Host: ${state.phase}`); lastPhase = state.phase }
      const pid = await adb(['shell', 'pidof', packageId])
      if (pid === String(state.androidPid)) {
        if (state.phase === 'failed') throw new Error(`Android Host failed: ${state.message}; inspect the app's runtime details for its logs`)
        if (state.phase === 'ready' && (!previous || state.hostPid !== previous.hostPid)) return state
      }
    }
    await pause(800)
  }
  throw new Error('Android Host did not publish a fresh ready state within five minutes; inspect runtime details on the device')
}
async function connect(state) {
  if (forwardPort) { await adb(['forward', '--remove', `tcp:${forwardPort}`]); forwardPort = undefined }
  const origin = new URL(state.url), healthUrl = new URL(state.healthUrl)
  assert.equal(origin.protocol, 'http:'); assert.equal(origin.hostname, '127.0.0.1')
  assert(Number(origin.port) > 0); assert.equal(healthUrl.origin, origin.origin)
  forwardPort = await adb(['forward', 'tcp:0', `tcp:${origin.port}`])
  assert.match(forwardPort, /^[1-9][0-9]*$/)
  const local = `http://127.0.0.1:${forwardPort}`
  const request = (path, options = {}) => deviceHttp(`${local}${path}`, { ...options,
    headers: { host: origin.host, ...options.headers } })
  const healthResponse = await request(healthUrl.pathname + healthUrl.search)
  assert.equal(healthResponse.status, 200)
  const health = await healthResponse.json()
  assert.equal(health.status, 'ready'); assert.equal(health.architecture, 'dsh-remote'); assert.equal(health.protocolVersion, 1)
  assert.equal(health.platform, 'linux'); assert.equal(health.arch, 'arm64'); assert.equal(health.pid, state.hostPid)
  assert.equal((await request('/_eleckoi/health')).status, 401)
  const handshake = await request(origin.pathname + origin.search, { redirect: 'manual' })
  assert.equal(handshake.status, 303)
  const cookie = handshake.headers.get('set-cookie')?.split(';', 1)[0]
  assert(cookie, 'Authenticated Host did not issue a Client cookie')
  await handshake.body?.cancel()
  const page = await request('/', { headers: { cookie } })
  assert.equal(page.status, 200); assert.match(await page.text(), /__ELECKOI_CLIENT_ASSETS__/)
  return {
    async call(method, args) {
      const rpcId = randomUUID()
      const response = await request(`/api/${method}`, { method: 'POST',
        headers: { cookie, origin: origin.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) })
      assert.equal(response.status, 200, `${method} HTTP failure`)
      const envelope = await response.json()
      assert.equal(envelope.type, 'server-response'); assert.equal(envelope.rpcId, rpcId)
      if (envelope.result?.ok === false) throw new Error(`${method}: ${envelope.result.error?.code}: ${envelope.result.error?.message}`)
      assert.equal(envelope.result?.ok, true, `${method} returned an unrecognized result`)
      return envelope.result.value
    }
  }
}
async function namespace(ns) {
  const { namespaces } = await client.call('settings/describe', {})
  const candidates = namespaces.filter(row => row.ns === ns)
  assert.equal(candidates.length, 1, `Settings namespace ${ns} must be unique`)
  return candidates[0]
}
async function mutate(ns, ops) {
  const row = await namespace(ns)
  return client.call('settings/mutate', { ns, ops, expectedRevision: row.revision })
}
async function events() {
  const projection = await client.call('session/projections', { request: { sessionId: conversationId } })
  const page = await client.call('session/page', { request: { address: { kind: 'session', sessionId: conversationId }, throughSeq: projection.asOfSeq, maxMessages: 100 } })
  return page.records.map(record => record.event)
}
async function settled(count) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const value = await events()
    if (value.filter(event => event.type === 'turn/end').length === count) return value
    await pause(300)
  }
  throw new Error(`Android Session did not settle turn ${count}`)
}
let declaredProfile, ownedProfile, primaryError
try {
  let state = await start()
  client = await connect(state)
  assert.equal((await client.call('eleckoiSystem/status', {})).architecture, 'dsh-remote')
  report.actualDeviceHostValidated = true
  report.webView = await inspectDeviceWebView(adb, state)
  report.webViewInspected = true
  if (values['business-probe']) {
    assert.deepEqual(await client.call('eleckoiConversations/list', {}), [], 'Business probe only runs against an empty Android conversation list; existing data is retained')
    const piAi = await namespace('llm-pi-ai')
    assert.equal(piAi.value?.providers?.[provider], undefined)
    assert.equal((await client.call('credentials/describe', { refs: [keyRef] }))[keyRef].configured, false)
    const held = Promise.withResolvers(), cancelled = Promise.withResolvers()
    let requests = 0
    modelServer = createServer(async (request, response) => {
      try {
        assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses')
        let body = ''; for await (const chunk of request) { body += chunk; assert(body.length < 1024 * 1024) }
        assert.equal(JSON.parse(body).model, 'example-model')
        assert.equal(request.headers.authorization, 'Bearer synthetic-probe-key')
        assert(++requests <= 2, 'Unexpected extra model request')
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
          output: [{ ...item, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]))
      } catch (error) { response.destroy(error); held.reject(error); held.promise.catch(() => {}) }
    })
    await new Promise(done => modelServer.listen(0, '127.0.0.1', done))
    const port = modelServer.address().port
    await adb(['reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`]); reversePort = port
    declaredProfile = { api: 'openai-responses', baseURL: `http://127.0.0.1:${port}/v1`, apiKeyEnv: keyRef,
      models: [{ id: 'example-model', contextWindow: 65536, maxTokens: 8192, input: ['text'] }] }
    providerAdded = true
    const changed = await mutate('llm-pi-ai', [{ op: 'set', path: ['providers', provider], value: declaredProfile }])
    ownedProfile = structuredClone(changed.value.providers[provider])
    for (const field of Object.keys(declaredProfile).filter(field => field !== 'models')) assert.deepEqual(ownedProfile[field], declaredProfile[field])
    assert.equal(ownedProfile.models.length, declaredProfile.models.length)
    for (const model of declaredProfile.models) {
      const matches = ownedProfile.models.filter(value => value.id === model.id)
      assert.equal(matches.length, 1)
      for (const field of Object.keys(model)) assert.deepEqual(matches[0][field], model[field])
    }
    keyAdded = true; await client.call('credentials/set', { ref: keyRef, value: 'synthetic-probe-key' })
    // The product's model selection is global. Preserve the exact original selection,
    // and restore it only while the probe still owns the current selection.
    originalSelection = await client.call('eleckoiConversationModels/current', { conversationId: '' })
    assert(typeof originalSelection.provider === 'string' && typeof originalSelection.model === 'string')
    creationUncertain = true
    const created = await client.call('eleckoiConversations/create', { input: { title: 'Synthetic Android probe' } })
    conversationId = created.conversation.id
    creationUncertain = false
    selectionChanged = true; await client.call('eleckoiConversationModels/select', { conversationId, selection })
    const prompt = async text => {
      const prepared = await client.call('eleckoiConversations/preparePrompt', { conversationId, text })
      assert.equal(prepared.runtimeSessionId, conversationId)
      generationPending = true
      await client.call('session/prompt', { request: { requestId: randomUUID(), sessionId: conversationId, mode: 'queue', content: [{ type: 'text', text }] } })
      return prepared.operationId
    }
    const firstOperation = await prompt('Synthetic Android input')
    const completed = await settled(1)
    assert(completed.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed'))
    assert(completed.some(event => event.type === 'assistant/message' && event.data.message.content.some(part => part.type === 'text' && part.text === 'Synthetic Android reply')))
    await client.call('eleckoiConversations/waitForGeneration', { conversationId, operationId: firstOperation })
    generationPending = false
    const secondOperation = await prompt('Synthetic cancellation input')
    await bounded(held.promise, 'No second model request arrived from the phone')
    await client.call('session/cancel', { request: { sessionId: conversationId } })
    await bounded(cancelled.promise, 'The phone did not close the cancelled model stream')
    const stopped = await settled(2)
    assert(stopped.some(event => event.type === 'turn/end' && event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'user'))
    await client.call('eleckoiConversations/waitForGeneration', { conversationId, operationId: secondOperation })
    generationPending = false
    await adb(['shell', 'am', 'force-stop', packageId])
    const restarted = await start(state)
    assert.notEqual(restarted.androidPid, state.androidPid)
    state = restarted; client = await connect(state)
    report.restartedWebView = await inspectDeviceWebView(adb, state)
    assert.deepEqual(await client.call('eleckoiConversationModels/current', { conversationId }), selection)
    assert((await client.call('eleckoiConversations/list', {})).some(row => row.id === conversationId))
    const restored = await events()
    assert(restored.some(event => event.type === 'assistant/message' && event.data.message.content.some(part => part.type === 'text' && part.text === 'Synthetic Android reply')))
    assert(restored.some(event => event.type === 'turn/end' && event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'user'))
    report.businessProbePassed = true
  }
} catch (error) {
  primaryError = error
  throw error
} finally {
  const failures = []
  const cleanup = async (name, action) => { try { await action() } catch (error) { failures.push(`${name}: ${error.message}`) } }
  if (selectionChanged) await cleanup('restore original model', async () => {
    const current = await client.call('eleckoiConversationModels/current', { conversationId })
    if (isDeepStrictEqual(current, originalSelection)) { selectionChanged = false; return }
    assert.deepEqual(current, selection, 'Model selection changed concurrently; the probe will not overwrite it')
    const row = await namespace('agent-default-model')
    // Restore the captured settings verbatim: selecting again would materialize
    // the adapter's default reasoning effort instead of preserving omission.
    await client.call('settings/replace', { ns: 'agent-default-model', section: originalSelection, expectedRevision: row.revision })
    assert.deepEqual(await client.call('eleckoiConversationModels/current', { conversationId }), originalSelection)
    selectionChanged = false
  })
  if (conversationId) await cleanup('remove synthetic conversation', async () => {
    if (generationPending) await client.call('session/cancel', { request: { sessionId: conversationId } })
    await client.call('eleckoiConversations/delete', { conversationId })
  })
  if (providerAdded && !selectionChanged) await cleanup('remove synthetic provider', async () => {
    const row = await namespace('llm-pi-ai')
    if (row.value?.providers?.[provider] === undefined) { providerAdded = false; return }
    assert(ownedProfile, 'The provider write did not return its settings; retain it for diagnosis')
    assert.deepEqual(row.value.providers[provider], ownedProfile, 'Synthetic provider was changed concurrently; the probe will not remove it')
    await client.call('settings/mutate', { ns: 'llm-pi-ai', expectedRevision: row.revision, ops: [{ op: 'unset', path: ['providers', provider] }] })
    providerAdded = false
  })
  if (keyAdded && !providerAdded) await cleanup('remove synthetic credential', () => client.call('credentials/unset', { ref: keyRef }))
  if (forwardPort) await cleanup('remove adb forward', () => adb(['forward', '--remove', `tcp:${forwardPort}`]))
  if (reversePort) await cleanup('remove adb reverse', () => adb(['reverse', '--remove', `tcp:${reversePort}`]))
  if (modelServer) { modelServer.closeAllConnections(); await new Promise(done => modelServer.close(done)) }
  if (providerAdded || selectionChanged) failures.push('Synthetic model settings are retained until their ownership or original selection can be verified')
  if (creationUncertain && client) await cleanup('verify failed conversation creation rolled back', async () => {
    const remaining = await client.call('eleckoiConversations/list', {})
    if (remaining.items.length === 0) creationUncertain = false
  })
  if (creationUncertain) failures.push('Conversation creation returned no usable identity; its outcome must be diagnosed without guessing a conversation to delete')
  report.cleanupPassed = failures.length === 0
  if (failures.length) report.retainedProbe = { provider, credentialRef: keyRef, conversationId, creationUncertain }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  if (failures.length) {
    const error = new Error(`Device probe cleanup requires attention: ${failures.join('; ')}. Probe identities are recorded at ${reportPath}`)
    throw primaryError ? new AggregateError([primaryError, error], 'Android device validation and cleanup failed') : error
  }
}
console.log(`Actual Android Linux ARM64 Host, authenticated Remote and rendered WebView passed${report.businessProbePassed ? '; send, cancellation and process restart passed' : ''}.`)
console.log(`Local result: ${reportPath}`)
