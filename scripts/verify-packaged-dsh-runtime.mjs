import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dshClientPages } from './dsh-client-pages.mjs'

const unpacked = process.env.ELECKOI_UNPACKED_DIR ?? join(process.cwd(), 'release', 'win-unpacked')
const executable = join(unpacked, 'ElecKoi.exe')
const appAsar = join(unpacked, 'resources', 'app.asar')

if (!existsSync(executable) || !existsSync(appAsar)) {
  throw new Error(`找不到已解包的 ElecKoi：${unpacked}`)
}

const probe = `
  import('node:fs/promises').then(async ({ access, mkdtemp, readFile, rm }) => {
    const { createServer } = await import('node:http')
    const { once } = await import('node:events')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { pathToFileURL } = await import('node:url')
    const unpacked = ${JSON.stringify(unpacked)}
    const appAsar = ${JSON.stringify(appAsar)}
    const mainSource = await readFile(join(appAsar, 'out', 'main', 'main.js'), 'utf8')
    const externalUpdaterDependencies = ['electron-updater', 'builder-util-runtime', 'debug', 'sax']
    for (const dependency of externalUpdaterDependencies) {
      const loadMarkers = ['require("' + dependency, "require('" + dependency]
      if (loadMarkers.some((marker) => mainSource.includes(marker))) {
        throw new Error('Packaged main process still loads ' + dependency + ' as an external dependency.')
      }
    }
    if (!mainSource.includes('class AppUpdater') || !mainSource.includes('NsisUpdater')) {
      throw new Error('Packaged main process does not contain the bundled updater runtime.')
    }
    process.stdout.write('Packaged updater runtime check passed.\\n')
    const buildTimeBrowserPackages = [
      '@fortawesome/fontawesome-free',
      '@tailwindcss/browser',
      'jquery',
      'jquery-ui-dist',
      'jquery-ui-touch-punch',
      'lodash',
      'pixi.js',
      'showdown',
      'toastr',
      'vue',
      'vue-router'
    ]
    for (const dependency of buildTimeBrowserPackages) {
      try {
        await access(join(appAsar, 'node_modules', ...dependency.split('/')))
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        throw error
      }
      throw new Error('Build-time browser package leaked into app.asar: ' + dependency)
    }
    process.stdout.write('Packaged browser dependency boundary check passed.\\n')
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-shell', 'src', 'client.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-conversations', 'src', 'client.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-roleplay', 'src', 'client.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-roleplay', 'src', 'index.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-roleplay', 'cordis.patch.yml'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-characters', 'src', 'client.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-character-configuration', 'src', 'client.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-models', 'src', 'client.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-persona', 'src', 'client.js'))
    await access(join(appAsar, 'node_modules', '@eleckoi', 'dsh-client-presets', 'src', 'client.js'))
    process.stdout.write('Packaged ElecKoi DSH client module is present.\\n')
    const productRenderer = join(appAsar, 'out', 'renderer-dsh')
    const productHtml = await readFile(join(productRenderer, 'src', 'renderer', 'dsh.html'), 'utf8')
    const productScript = productHtml.match(/<script\\b[^>]*\\bsrc="(?:\\.\\.\\/)+assets\\/([^"\\s]+\\.js)"/i)?.[1]
    const productStyle = productHtml.match(/<link\\b[^>]*\\bhref="(?:\\.\\.\\/)+assets\\/([^"\\s]+\\.css)"/i)?.[1]
    if (!productScript || !productStyle) throw new Error('Packaged ElecKoi DSH renderer entry is incomplete.')
    await access(join(productRenderer, 'assets', productScript))
    await access(join(productRenderer, 'assets', productStyle))
    for (const pageAsset of ${JSON.stringify(dshClientPages.map(page => `eleckoi-page-${page.key}.js`))}) {
      await access(join(productRenderer, 'assets', pageAsset))
    }
    process.stdout.write('Packaged ElecKoi DSH renderer assets are present.\\n')
    const runtimeUrl = pathToFileURL(join(appAsar, 'node_modules', '@eleckoi', 'dsh-runtime', 'dist', 'index.mjs')).href
    const { DshDesktopPluginHost, DshRuntime } = await import(runtimeUrl)
    const packageManagerPath = join(unpacked, 'resources', 'dsh', 'pnpm', 'bin', 'pnpm.mjs')
    const nodeBinPath = join(unpacked, 'resources', 'dsh', 'node-bin')
    await access(packageManagerPath)
    await access(join(nodeBinPath, 'node.cmd'))
    const root = await mkdtemp(join(tmpdir(), 'eleckoi-packaged-dsh-'))
    const runtime = new DshRuntime({
      configPath: join(appAsar, 'resources', 'dsh', 'cordis.yml'),
      presetTemplatePath: join(appAsar, 'resources', 'dsh', 'agent-preset-template', 'agent.cordis.yml'),
      workspaceRoot: join(root, 'workspace'),
      runtimeDataRoot: join(root, 'runtime'),
      executablePath: process.execPath
    })
    runtime.bindSessionHost(new DshDesktopPluginHost({
      runtimeDataRoot: join(root, 'runtime'),
      workspaceRoot: join(root, 'workspace'),
      agentPatchPath: join(appAsar, 'resources', 'dsh', 'desktop-agent.patch.yml'),
      hostConfiguration: () => runtime.hostConfiguration(),
      executablePath: process.execPath,
      packageManager: { entryPath: packageManagerPath, nodeBinPath }
    }))
    let server
    try {
      await runtime.verify()
      process.stdout.write('Packaged DSH runtime handshake passed.\\n')
      server = createServer(async (request, response) => {
        for await (const _chunk of request) {}
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache'
        })
        const base = {
          id: 'chatcmpl-packaged-probe',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'packaged-probe-model'
        }
        const send = (choice) => response.write('data: ' + JSON.stringify({
          ...base,
          choices: [{ index: 0, ...choice }]
        }) + '\\n\\n')
        send({ delta: { role: 'assistant', content: '' }, finish_reason: null })
        send({ delta: { content: 'packaged probe ok' }, finish_reason: null })
        send({ delta: {}, finish_reason: 'stop' })
        response.end('data: [DONE]\\n\\n')
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') {
        throw new Error('Packaged DSH probe server did not expose a TCP port.')
      }
      const final = []
      await runtime.stream(
        'packaged-probe-conversation',
        'hello',
        {
          configId: 'packaged-probe-config',
          provider: 'custom',
          apiKey: 'packaged-probe-key',
          baseUrl: 'http://127.0.0.1:' + address.port,
          model: 'packaged-probe-model',
          systemPrompt: '',
          apiFormat: 'openai-completions',
          customHeaders: {},
          contextWindow: 128000,
          autoCompactTokenLimit: 96000,
          supportsImageInput: false
        },
        { onDelta() {}, onFinal(content) { final.push(content) } },
        undefined,
        {
          characterId: 'packaged-probe-character',
          characterName: 'Probe Character',
          persona: {},
          history: [],
          settingLibrary: {
            characterId: 'packaged-probe-character',
            name: 'Probe Library',
            entries: [],
            groups: [],
            promptPositions: []
          }
        },
        'packaged-probe-thread',
        {
          disabledGroupIds: [
            'builtin:variables',
            'builtin:web',
            'builtin:workspace',
            'builtin:roleplay-workflow'
          ]
        },
        [],
        [],
        {
          id: 'agent-preset-standard',
          versionId: 'packaged-probe-v1',
          name: 'Packaged Probe',
          roleplayPlan: { steps: [] }
        }
      )
      if (final.join('') !== 'packaged probe ok') {
        throw new Error('Packaged DSH probe did not return the expected final reply.')
      }
      process.stdout.write('Packaged DSH preset, Agent plane and local turn passed.\\n')
    } finally {
      await runtime.close()
      if (server !== undefined) {
        server.close()
        await once(server, 'close')
      }
      await rm(root, { recursive: true, force: true })
    }
    const pluginRoot = await mkdtemp(join(tmpdir(), 'eleckoi-packaged-plugin-host-'))
    const pluginHost = new DshDesktopPluginHost({
      runtimeDataRoot: pluginRoot,
      workspaceRoot: join(pluginRoot, 'workspace'),
      agentPatchPath: join(appAsar, 'resources', 'dsh', 'desktop-agent.patch.yml'),
      hostConfiguration: () => ({ credentials: {} }),
      executablePath: process.execPath,
      packageManager: { entryPath: packageManagerPath, nodeBinPath }
    })
    try {
      const ready = await pluginHost.start()
      const response = await fetch(ready.url, { redirect: 'manual' })
      if (response.status !== 303 || !response.headers.get('set-cookie')) {
        throw new Error('Packaged plugin Host did not issue the client login cookie.')
      }
      if (!JSON.stringify(ready.injections).includes('dsh-client-ui-plugin-manager')) {
        throw new Error('Packaged plugin Host did not load the official plugin manager.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-shell'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi client shell.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-conversations'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi conversation model.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-roleplay'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi roleplay view.')
      }
      if (await pluginHost.dispose('probe-nonexistent-session') !== false) {
        throw new Error('Packaged plugin Host did not load the ElecKoi roleplay lifecycle.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-characters'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi character model.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-character-configuration'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi character configuration model.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-models'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi model catalog.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-persona'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi user profile model.')
      }
      if (!ready.injections.some(row => row?.kind === 'global' && row?.name === '__DSH_BOOT__'
        && row.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-presets'))) {
        throw new Error('Packaged plugin Host did not load the ElecKoi preset model.')
      }
      process.stdout.write('Packaged DSH plugin Host and client bootstrap passed.\\n')
    } finally {
      await pluginHost.close()
      await rm(pluginRoot, { recursive: true, force: true })
    }
  }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
`

const result = spawnSync(executable, ['-e', probe], {
  cwd: unpacked,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 180_000
})

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Packaged DSH runtime handshake failed.\n')
  process.exit(result.status ?? 1)
}

process.stdout.write(result.stdout)
