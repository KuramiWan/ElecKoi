const { app, BrowserWindow, ipcMain, protocol, session, webFrameMain } = require('electron')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const Module = require('node:module')
const { transformSync } = Module.createRequire(require.resolve('vite'))('esbuild')
app.on('window-all-closed', () => {})

const documentPath = resolve('apps/desktop/src/main/platform/electron/dshClientDocument.ts')
const documentModule = new Module(documentPath, module)
documentModule.paths = module.paths
documentModule._compile(transformSync(readFileSync(documentPath, 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'es2024',
}).code, documentPath)
const document = documentModule.exports
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }])
const root = mkdtempSync(join(tmpdir(), 'eleckoi-client-probe-'))
app.setPath('userData', root)
const errors = []
let host
let window
let failed = false
let modelServer
let modelRequests = 0
const modelBodies = []
const nativeAuthorMode = process.argv.includes('--native-author')
const chatOnlyMode = process.argv.includes('--chat-only')
async function main() {
  const { DshDesktopPluginHost, resolveDshWebFrontendDirectory, ELECKOI_DESKTOP_BUNDLES, registerDesktopBundles } = await import('@eleckoi/desktop-host')
  const { OPTIONAL_BUNDLES, initProfile, PROFILE_TEMPLATES, readProfileManifest, writeProfileBundles } = await import('@deepseek-ai/dsh-app-boot')
  await app.whenReady()
  modelServer = createServer((_request, response) => {
    if (nativeAuthorMode) {
      let body = ''
      _request.setEncoding('utf8')
      _request.on('data', chunk => { body += chunk })
      _request.on('end', () => { modelBodies.push(JSON.parse(body)) })
    }
    modelRequests += 1
    if (nativeAuthorMode || modelRequests > 1) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      let text = nativeAuthorMode ? 'Synthetic native reply' : modelRequests === 2 ? 'Synthetic recovered reply' : `Synthetic regenerated reply ${modelRequests}`
      if (chatOnlyMode && process.argv.includes('--handoff-check')) {
        text += '\n\n```html\n<!doctype html><html><body style="margin:0"><section style="height:240px;background:#123456;color:white">Synthetic rich card</section></body></html>\n```'
      }
      const item = { id: 'synthetic-message', type: 'message', role: 'assistant', content: [] }
      const events = [
        { type: 'response.created', response: { id: 'synthetic-response', model: 'example-model', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: item.id, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text },
        { type: 'response.completed', response: { id: 'synthetic-response', model: 'example-model', status: 'completed',
          output: [{ ...item, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ]
      const payload = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
      if (modelRequests > 2) setTimeout(() => response.end(payload), 600)
      else response.end(payload)
      return
    }
    response.writeHead(402, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'Synthetic payment rejection' } }))
  })
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${modelServer.address().port}/v1`
  if (nativeAuthorMode || chatOnlyMode) {
    const profile = join(root, 'home', 'profiles', 'desktop')
    initProfile(profile, [...PROFILE_TEMPLATES.web.bundles, ...ELECKOI_DESKTOP_BUNDLES])
    registerDesktopBundles(profile)
    const manifest = readProfileManifest('dsh', profile)
    writeProfileBundles(profile, manifest, manifest.dsh.profile.bundles.filter(name =>
      !nativeAuthorMode || name !== '@eleckoi/dsh-client-html-resources'))
    writeFileSync(join(profile, 'cordis.patch.yml'), JSON.stringify([
      { id: 'llm-pi-ai', config: { providers: { 'synthetic-native': { api: 'openai-responses', baseURL: endpoint,
        apiKeyEnv: 'ELECKOI_SYNTHETIC_PROBE_KEY', models: [{ id: 'example-model', contextWindow: 65536, maxTokens: 8192 }] } } } },
      { id: 'agent-default-model', config: { provider: 'synthetic-native', model: 'example-model' } },
    ]))
    process.env.ELECKOI_SYNTHETIC_PROBE_KEY = 'synthetic-probe-key'
  }
  const hostOptions = { runtimeDataRoot: root, workspaceRoot: join(root, 'workspace'),
    productDatabasePath: join(root, 'product.sqlite'), productMediaRoot: join(root, 'media'),
    presetTemplatePath: resolve('apps/desktop/resources/dsh/agent-preset-template/agent.cordis.yml'),
    agentPatchPath: resolve('apps/desktop/resources/dsh/desktop-agent.patch.yml'), executablePath: process.execPath,
    packageManager: { entryPath: join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'), nodeBinPath: resolve('apps/desktop/resources/dsh/node-bin') },
    onDiagnostic: message => { if (message.includes('ERROR')) errors.push(message) },
  }
  host = new DshDesktopPluginHost(hostOptions)
  let ready = await host.start()
  let cookie = await document.authenticateDshClientHost(ready.url)
  const renderer = resolve('apps/web/dist')
  const assets = await document.resolveElecKoiClientAssets(renderer)
  protocol.handle('dsh-app', async request => {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/eleckoi/assets/')) return document.serveElecKoiClientAsset(request, renderer)
    if (document.isDshClientAsset(url.pathname)) return document.serveDshClientAsset(request, resolveDshWebFrontendDirectory())
    return document.forwardDshClientRequest(request, ready.url, cookie)
  })
  ipcMain.handle('eleckoi:dsh-client-boot', () => ({ injections: [...ready.injections,
    { kind: 'global', name: '__ELECKOI_CLIENT_ASSETS__', value: assets }], streamBaseUrl: new URL(ready.url).origin }))
  ipcMain.handle('eleckoi:dsh-client-boot-failed', (_event, error) => errors.push(error))
  ipcMain.handle('dsh-desktop:updates-status', () => ({ phase: 'disabled', currentVersion: app.getVersion(), availableVersion: null, releaseName: null, releaseNotes: null, releaseDate: null, downloadSizeBytes: null, progress: null, message: null }))
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([key, value]) => [key.toLowerCase(), value]))
    callback({ requestHeaders: { ...headers, origin: new URL(ready.url).origin, cookie, 'sec-fetch-site': 'same-origin' } })
  })
  window = new BrowserWindow({ show: false, width: 1440, height: 1000,
    webPreferences: { preload: resolve('apps/desktop/out/preload/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } })
  window.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error' || message.includes('initial Session restoration failed:')) errors.push(message)
  })
  const executeJavaScript = window.webContents.executeJavaScript.bind(window.webContents)
  window.webContents.executeJavaScript = async (source, ...args) => {
    try { return await executeJavaScript(source, ...args) }
    catch (error) {
      throw new Error(`Renderer probe expression failed:\n${source}\n${errors.join('\n')}`, { cause: error })
    }
  }
  window.webContents.on('did-fail-load', (_event, code, message, url, isMainFrame, processId, routingId) => {
    setImmediate(() => {
      const frame = webFrameMain.fromId(processId, routingId)
      // Removed authored frames can report their canceled navigation after unmount.
      if (code === -3 && !isMainFrame && url === 'about:srcdoc' && !frame) return
      errors.push(`${code}: ${message}; url=${url}; mainFrame=${isMainFrame}; frame=${JSON.stringify(frame ? { detached: frame.detached, url: frame.url, name: frame.name } : null)}`)
    })
  })
  await window.loadURL('dsh-app://app/')
  const waitFor = async (expression, label) => {
    const deadline = Date.now() + 35_000
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression)) return
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error(`${label}: ${(await window.webContents.executeJavaScript('document.body.innerText')).slice(0, 1600)}\n${errors.join('\n')}`)
  }
  await waitFor(`document.querySelector('.side-panel-brand .eleckoi-wordmark')`, 'ElecKoi shell did not render')
  const remoteCall = async (method, args) => {
    const response = await fetch(new URL(`/api/${method}`, ready.url), {
      method: 'POST', headers: { cookie, origin: new URL(ready.url).origin,
        'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'eleckoi-client-probe', method, payload: { args } }),
    })
    const result = (await response.json()).result
    if (!response.ok || result.ok === false) throw new Error(`${method}: ${JSON.stringify(result)}`)
    return result.value ?? result
  }
  if (process.argv.includes('--startup-only')) {
    await new Promise(resolve => setTimeout(resolve, 500))
    const initial = await remoteCall('session/list', { _request: {} })
    if (initial.items.length !== 0) throw new Error('Product startup created an unrequested Session')
    mkdirSync(hostOptions.workspaceRoot, { recursive: true })
    await remoteCall('workspace/create', { request: { path: hostOptions.workspaceRoot } })
    await new Promise(resolve => setTimeout(resolve, 500))
    if ((await remoteCall('session/list', { _request: {} })).items.length !== 0) throw new Error('Workspace list updates created an unrequested Session')
    await window.loadURL('about:blank')
    await host.close()
    host = new DshDesktopPluginHost(hostOptions)
    ready = await host.start()
    cookie = await document.authenticateDshClientHost(ready.url)
    await window.loadURL('dsh-app://app/')
    await waitFor(`document.querySelector('.side-panel-brand .eleckoi-wordmark')`, 'Product shell did not restore')
    await new Promise(resolve => setTimeout(resolve, 500))
    if ((await remoteCall('session/list', { _request: {} })).items.length !== 0) throw new Error('Cold startup selected or created a Workspace Session')
    if (modelRequests !== 0) throw new Error('Startup unexpectedly requested a model')
    if (errors.length) throw new Error(errors.join('\n'))
    process.stdout.write('Product startup, Workspace list updates and cold restart created no unsolicited Sessions.\n')
    return
  }
  if (nativeAuthorMode) {
    const { runNativeAuthorScenario } = require('./probe-eleckoi-native-author-scenario.cjs')
    await runNativeAuthorScenario({ window, ready, cookie, waitFor, requests: () => modelRequests, modelBodies, errors, productDataRoot: root })
    return
  }
  const checkOptionalPluginCards = async (expectedEnabled = false) => {
    await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('button[aria-label="插件"]')
      if (!button) throw new Error('Plugin navigation did not render')
      button.click()
    })()`)
    await waitFor(`${JSON.stringify(OPTIONAL_BUNDLES)}.every(name => {
      const card = document.querySelector('[data-plugin-package="' + name + '"]')
      return card?.getAttribute('data-plugin-status') === ${JSON.stringify(expectedEnabled ? 'running' : 'disabled')}
        && card.querySelector('[role="switch"]')?.getAttribute('aria-checked') === ${JSON.stringify(String(expectedEnabled))}
    })`, 'Official optional plugin cards or saved switches did not render')
  }
  if (process.argv.includes('--plugins-only')) {
    await checkOptionalPluginCards()
    for (const name of OPTIONAL_BUNDLES) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-plugin-package="' + ${JSON.stringify(name)} + '"] [role="switch"]').click()`)
      await waitFor(`document.querySelector('[data-plugin-package="' + ${JSON.stringify(name)} + '"]')?.getAttribute('data-plugin-status') === 'running'`, 'Official plugin switch did not enable ' + name)
    }
    await window.loadURL('about:blank')
    await host.close()
    host = new DshDesktopPluginHost(hostOptions)
    ready = await host.start()
    cookie = await document.authenticateDshClientHost(ready.url)
    await window.loadURL('dsh-app://app/')
    await waitFor(`document.querySelector('button[aria-label="插件"]') !== null`, 'Plugin navigation did not restore')
    await checkOptionalPluginCards(true)
    for (const name of OPTIONAL_BUNDLES) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-plugin-package="' + ${JSON.stringify(name)} + '"] [role="switch"]').click()`)
      await waitFor(`document.querySelector('[data-plugin-package="' + ${JSON.stringify(name)} + '"]')?.getAttribute('data-plugin-status') === 'disabled'`, 'Official plugin switch did not disable ' + name)
    }
    if (process.env.ELECKOI_CLIENT_PROBE_SCREENSHOT) writeFileSync(process.env.ELECKOI_CLIENT_PROBE_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
    process.stdout.write('All four official optional plugin cards, UI switches and cold restart selection passed.\n')
    return
  }
  if (!chatOnlyMode) {
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === '模型配置')?.click()`)
  await waitFor(`document.querySelector('.model-provider-sidebar') !== null || document.body.innerText.includes('基础配置')`, 'Custom model page did not render')
  await waitFor(`document.body.innerText.includes('基础配置') && document.body.innerText.includes('模型参数')`, 'Model editor did not render')
  const dedicatedFormat = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.model-api-format-control select')
    return { disabled: select.disabled, value: select.value,
      options: Array.from(select.options).map(option => ({ value: option.value, label: option.textContent })) }
  })()`)
  if (!dedicatedFormat.disabled || dedicatedFormat.value !== 'anthropic_messages'
    || JSON.stringify(dedicatedFormat.options) !== JSON.stringify([{ value: 'anthropic_messages', label: 'Messages API' }])) {
    throw new Error(`Dedicated model format contract failed: ${JSON.stringify(dedicatedFormat)}`)
  }
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '添加模型')?.click()`)
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[aria-label="模型名"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'example-model')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '添加并使用')?.click()`)
  await waitFor(`document.querySelector('.model-parameter-grid input[max="1"]')?.disabled === false`, 'Model parameters did not enable')
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.model-parameter-grid input[max="1"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '0.96')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitFor(`Array.from(document.querySelectorAll('.model-save-actions button')).some(button => button.innerText === '保存配置' && !button.disabled)`, 'Dedicated parameters did not become savable')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.model-save-actions button')).find(button => button.innerText === '保存配置').click()`)
  await waitFor(`document.querySelector('.model-parameter-grid input[max="1"]')?.value === '0.96' && Array.from(document.querySelectorAll('.model-save-actions button')).some(button => button.innerText === '保存配置' && button.disabled)`, 'Dedicated parameters did not save through Remote')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.model-config-sidebar button')).find(button => button.innerText.includes('自定义模型提供商'))?.click()`)
  await waitFor(`document.querySelector('.model-hero-copy h3')?.innerText === '自定义模型提供商'`, 'Custom provider did not open')
  const customFormats = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.model-api-format-control select')
    return { disabled: select.disabled, values: Array.from(select.options).map(option => option.value) }
  })()`)
  if (customFormats.disabled || JSON.stringify(customFormats.values) !== JSON.stringify([
    'responses', 'chat_completions', 'anthropic_messages', 'google_gemini'
  ])) throw new Error(`Custom model format contract failed: ${JSON.stringify(customFormats)}`)
  await window.webContents.executeJavaScript(`(() => {
    const set = (selector, value) => {
      const input = document.querySelector(selector)
      if (!input) throw new Error('Missing model input: ' + selector)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('.model-detail-form input[placeholder="待命名"]', 'Example configuration')
    set('.model-detail-form input[placeholder="填写模型提供商 API 地址"]', ${JSON.stringify(endpoint)})
    set('.model-api-key-control input', 'synthetic-probe-value')
  })()`)
  await waitFor(`document.querySelector('.model-detail-form input[placeholder="填写模型提供商 API 地址"]')?.value === ${JSON.stringify(endpoint)}`, 'Model endpoint draft was not updated')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '添加模型')?.click()`)
  await waitFor(`document.querySelector('.model-manual-add input') !== null`, 'Manual model input did not open')
  await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('.model-manual-add input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'example-model'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.model-manual-add button')).find(button => button.innerText.trim() === '添加并使用')?.click()`)
  await waitFor(`document.querySelector('.model-picker-value')?.innerText === 'example-model'`, 'Manual model was not selected')
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.model-parameter-grid input[max="1"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '0.95')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitFor(`Array.from(document.querySelectorAll('.model-save-actions button')).some(button => button.innerText === '保存配置' && !button.disabled)`, 'Save remained disabled')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.model-save-actions button')).find(button => button.innerText === '保存配置').click()`)
  await waitFor(`document.querySelector('.model-api-key-control input')?.placeholder === '已保存，留空保留'`, 'Model profile or credential save failed')
  await window.reload()
  await waitFor(`document.querySelector('.side-panel-brand .eleckoi-wordmark')`, 'Shell did not reload')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === '模型配置')?.click()`)
  await waitFor(`document.body.innerText.includes('基础配置')`, 'Model page did not reload')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.model-config-sidebar button')).find(button => button.innerText.includes('自定义模型提供商'))?.click()`)
  await waitFor(`document.querySelector('.model-detail-form input[placeholder="待命名"]')?.value === 'Example configuration' && document.querySelector('.model-api-key-control input')?.placeholder === '已保存，留空保留' && document.querySelector('.model-detail-form input[placeholder="填写模型提供商 API 地址"]')?.value === ${JSON.stringify(endpoint)}`, 'Saved model configuration was not restored through Remote')
  await waitFor(`document.querySelector('.model-parameter-grid input[max="1"]')?.value === '0.95'`, 'Saved Top P was not restored through Remote')
  if (errors.length) throw new Error(errors.join('\n'))
  const runtimeError = await window.webContents.executeJavaScript(`document.body.innerText.includes('运行错误') ? document.body.innerText : ''`)
  if (runtimeError) throw new Error(runtimeError)
  await window.webContents.executeJavaScript(`document.querySelector('.model-api-key-control button').click()`)
  await waitFor(`document.querySelector('.model-api-key-control input')?.value === 'synthetic-probe-value' && document.querySelector('.model-api-key-control input')?.type === 'text'`, 'Saved credential did not reveal through Remote')
  await window.webContents.executeJavaScript(`document.querySelector('.model-api-key-control button').click()`)
  await waitFor(`document.querySelector('.model-api-key-control input')?.value === '' && document.querySelector('.model-api-key-control input')?.type === 'password'`, 'Hidden credential was retained in the input')
  if (!await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.model-save-actions button')).some(button => button.innerText === '保存配置' && button.disabled)`)) throw new Error('Revealing a credential dirtied the configuration')
  }
  const settings = await remoteCall('settings/describe', {})
  const providers = settings.namespaces.find(row => row.ns === 'llm-pi-ai').value.providers
  const provider = Object.keys(providers).find(id => providers[id].baseURL === endpoint)
  if (!provider) throw new Error('Synthetic model profile is missing')
  const characterId = 'synthetic-chat-character'
  if (chatOnlyMode) await remoteCall('eleckoiCharacters/create', { character: { id: characterId, name: 'Synthetic character' } })
  const created = await remoteCall('eleckoiConversations/create', { input: { title: 'Example chat',
    ...(chatOnlyMode ? { metadata: { characterId } } : {}) } })
  await remoteCall('eleckoiConversationModels/select', { conversationId: created.conversation.id,
    selection: { provider, model: 'example-model' } })
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === '消息')?.click()`)
  const conversationLabel = chatOnlyMode ? 'Synthetic character' : 'Example chat'
  await waitFor(`Array.from(document.querySelectorAll('.conversation-main b')).some(node => node.innerText === ${JSON.stringify(conversationLabel)})`, 'Synthetic conversation did not appear')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.conversation-main b')).find(node => node.innerText === ${JSON.stringify(conversationLabel)}).click()`)
  await waitFor(`document.querySelector('[data-composer-input][contenteditable="true"]') !== null`, 'Synthetic conversation did not open')
  await window.webContents.executeJavaScript(`document.querySelector('[data-composer-input]').focus()`)
  await window.webContents.insertText('Synthetic input')
  await waitFor(`document.querySelector('button[aria-label="发送消息"]')?.disabled === false`, 'Send did not enable')
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="发送消息"]').click()`)
  await waitFor(`document.body.innerText.includes('Synthetic payment rejection') && !document.querySelector('button[aria-label="停止生成"]') && !document.body.innerText.includes('深度求索中')`, 'Failed model request left the composer running')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '关闭')?.click()`)
  await window.webContents.executeJavaScript(`document.querySelector('[data-composer-input]').focus()`)
  await window.webContents.insertText('Synthetic retry')
  await waitFor(`document.querySelector('button[aria-label="发送消息"]')?.disabled === false`, 'Retry did not enable')
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="发送消息"]').click()`)
  await waitFor(`document.body.innerText.includes('Synthetic recovered reply') && !document.querySelector('button[aria-label="停止生成"]') && !document.body.innerText.includes('深度求索中')`, 'Retry did not complete in the original conversation')
  const current = await remoteCall('eleckoiConversations/details', { conversationId: created.conversation.id })
  if (current.runtimeSessionId !== created.runtimeSessionId || modelRequests !== 2) throw new Error('Failure recovery changed Session identity or duplicated a request')
  await window.loadURL('about:blank')
  await host.close()
  host = new DshDesktopPluginHost(hostOptions)
  ready = await host.start()
  cookie = await document.authenticateDshClientHost(ready.url)
  await window.loadURL('dsh-app://app/')
  await waitFor(`document.body.innerText.includes('Synthetic recovered reply')`, 'Cold restart did not restore the conversation')
  await waitFor(`document.querySelector('.chat-model-trigger-label')?.innerText === 'example-model'`, 'Cold restart did not restore the model selection')
  await waitFor(`document.querySelector('[data-composer-stats]') !== null`, 'Cold restart did not restore official composer statistics')
  await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-composer-stats]')
    const failures = []
    const inspect = () => {
      const current = document.querySelector('[data-composer-stats]')
      if (!current) failures.push('Statistics disappeared')
      else if (current !== root) failures.push('Statistics row was replaced')
      else if (!current.textContent.trim()) failures.push('Statistics became empty')
    }
    const observer = new MutationObserver(inspect)
    const composer = document.querySelector('[data-composer-card]')?.parentElement
    if (!composer?.contains(root)) throw new Error('Composer statistics are outside the resident input surface')
    observer.observe(composer, { childList: true, subtree: true, characterData: true })
    window.__eleckoiStatsProbe = { failures, observer }
  })()`)
  if (process.argv.includes('--regeneration-check')) await window.webContents.executeJavaScript(`(() => {
    const failures = [];
    const inspect = () => {
      const current = document.querySelector('.chat-panel');
      if (!current) failures.push('Conversation disappeared');
      else if (!current.querySelector('[data-composer-input]')) failures.push('Composer disappeared');
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.querySelector('#eleckoi-root'), { childList:true, subtree:true });
    window.__eleckoiRegenerationProbe = { failures, observer };
  })()`)
  const regenerate = async () => {
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="扮演菜单"]').click()`)
    await waitFor(`Array.from(document.querySelectorAll('.composer-more-menu button')).some(button => button.innerText.trim() === '重新生成' && !button.disabled)`, 'Regeneration did not enable')
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.composer-more-menu button')).find(button => button.innerText.trim() === '重新生成').click()`)
  }
  await regenerate()
  await waitFor(`document.body.innerText.includes('运行错误') || (document.body.innerText.includes('Synthetic regenerated reply 3') && !document.querySelector('button[aria-label="停止生成"]'))`, 'Cold regeneration did not settle')
  if (await window.webContents.executeJavaScript(`document.body.innerText.includes('运行错误')`)) throw new Error(await window.webContents.executeJavaScript('document.body.innerText'))
  await regenerate()
  await waitFor(`document.body.innerText.includes('运行错误') || (document.body.innerText.includes('Synthetic regenerated reply 4') && !document.querySelector('button[aria-label="停止生成"]'))`, 'Repeated regeneration did not settle')
  if (await window.webContents.executeJavaScript(`document.body.innerText.includes('运行错误')`)) throw new Error(await window.webContents.executeJavaScript('document.body.innerText'))
  const regenerated = await remoteCall('eleckoiConversations/details', { conversationId: created.conversation.id })
  if (regenerated.runtimeSessionId !== created.runtimeSessionId || modelRequests !== 4) throw new Error('Regeneration changed Session identity or duplicated a request')
  await new Promise(resolve => setTimeout(resolve, 300))
  const statsFailures = await window.webContents.executeJavaScript(`(() => {
    window.__eleckoiStatsProbe.observer.disconnect()
    return window.__eleckoiStatsProbe.failures
  })()`)
  if (statsFailures.length) throw new Error(`Regeneration composer statistics flickered: ${statsFailures.join(', ')}`)
  if (process.argv.includes('--regeneration-check')) {
    const failures = await window.webContents.executeJavaScript(`(() => {
      window.__eleckoiRegenerationProbe.observer.disconnect();
      return [...new Set(window.__eleckoiRegenerationProbe.failures)];
    })()`);
    if (failures.length) throw new Error(`Regeneration interrupted the conversation surface: ${failures.join(', ')}`);
    process.stdout.write('Regeneration kept the conversation and composer continuously mounted.\n');
  }
  if (chatOnlyMode && process.argv.includes('--handoff-check')) {
    await waitFor(`Array.from(document.querySelectorAll('.rich-message-frame')).some(frame => frame.style.height === '240px') && !document.querySelector('.rich-message-staging[aria-hidden="true"]')`, 'Rich conversation did not settle without scrolling')
    const otherCharacterId = 'synthetic-other-character'
    await remoteCall('eleckoiCharacters/create', { character: { id: otherCharacterId, name: 'Synthetic other character' } })
    await remoteCall('eleckoiConversations/create', { input: { title: 'Synthetic other chat', metadata: { characterId: otherCharacterId } } })
    await waitFor(`Array.from(document.querySelectorAll('.conversation-main b')).some(node => node.innerText === 'Synthetic other character')`, 'Second synthetic conversation did not appear')
    await window.webContents.executeJavaScript(`(() => {
      const failures = [];
      const inspect = () => {
        if (document.querySelector('.chat-panel') && !document.querySelector('[data-composer-input]')) failures.push('Composer absent');
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.querySelector('#eleckoi-root'), { childList:true, subtree:true });
      window.__eleckoiHandoffProbe = { failures, observer };
    })()`)
    for (const label of ['Synthetic other character', conversationLabel, 'Synthetic other character', conversationLabel]) {
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.conversation-main b')).find(node => node.innerText === ${JSON.stringify(label)}).click()`)
      await waitFor(`document.querySelector('.chat-header h1')?.innerText === ${JSON.stringify(label)} && document.querySelector('[data-composer-input]')`, 'Conversation switch did not restore the composer')
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    const handoffFailures = await window.webContents.executeJavaScript(`(() => {
      window.__eleckoiHandoffProbe.observer.disconnect(); return window.__eleckoiHandoffProbe.failures;
    })()`)
    if (handoffFailures.length) throw new Error(`Conversation composer disappeared during switching: ${handoffFailures.length}`)
    process.stdout.write('Switching between loaded character conversations kept the composer present.\n')
  }
  if (process.env.ELECKOI_CLIENT_PROBE_SCREENSHOT) writeFileSync(process.env.ELECKOI_CLIENT_PROBE_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
  process.stdout.write(chatOnlyMode
    ? 'Built ElecKoi roleplay send, failed request recovery, cold restart and continuous regeneration statistics passed.\n'
    : 'ElecKoi production desktop boot, saved credential reveal, failed model request termination and continuous regeneration statistics passed.\n')
}
main().catch(error => { process.stderr.write(`${error.stack || error}\n`); failed = true }).finally(async () => {
  try {
    if (window && !window.isDestroyed()) await window.loadURL('about:blank')
    window?.destroy()
    await host?.close()
    modelServer?.closeAllConnections()
    if (modelServer) await new Promise(resolve => modelServer.close(resolve))
    protocol.unhandle('dsh-app')
  } finally {
    const cleaner = spawn(process.execPath, ['-e', `(${cleanupAfterExit.toString()})()`, String(process.pid), root], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, windowsHide: true, stdio: 'ignore',
    })
    cleaner.unref()
    app.exit(failed ? 1 : 0)
  }
})

async function cleanupAfterExit() {
  const { resolve, sep, basename } = require('node:path')
  const target = resolve(process.argv[2])
  if (!target.startsWith(resolve(require('node:os').tmpdir()) + sep) || !basename(target).startsWith('eleckoi-client-probe-')) return
  const pid = Number(process.argv[1])
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { process.kill(pid, 0) } catch (error) {
      if (error.code === 'ESRCH') require('node:fs').rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
