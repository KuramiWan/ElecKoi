import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { initProfile, loadOverlayPatches, PROFILE_PATCH_FILENAME, PROFILE_TEMPLATES, readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'
import { isMap, isSeq, parseDocument } from 'yaml'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { ChildHostMessage, HostPromptPart, HostRunRequest, ParentHostMessage } from './hostSessionProtocol'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('@eleckoi/dsh-runtime'))
const TAVILY_BUNDLE = '@eleckoi/dsh-web-search-tavily'

function selectTavilyBundleOnce(profile: string): void {
  const marker = join(profile, '.eleckoi-tavily-bundle-v1')
  if (existsSync(marker)) return
  const manifest = readProfileManifest('dsh', profile)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(TAVILY_BUNDLE)) {
    writeProfileBundles(profile, manifest, [...bundles, TAVILY_BUNDLE])
  }
  writeFileSync(marker, 'initialized\n', { flag: 'wx' })
}

function synchronizeModelProfile(profile: string, providerPatchPath: string | undefined): void {
  if (!providerPatchPath) return
  const path = join(profile, PROFILE_PATCH_FILENAME)
  const before = readFileSync(path, 'utf8')
  const document = parseDocument(before, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
  if (document.errors.length > 0) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('DSH profile patch must be a list.')
  const models = loadOverlayPatches('dsh', providerPatchPath)
  for (const id of ['llm-pi-ai', 'llm-deepseek']) {
    const config = models.findLast(row => row.id === id)?.config
    if (config === undefined) throw new Error(`DSH model patch is missing ${id}.`)
    const index = document.contents.items.findLastIndex(row => isMap(row) && row.get('id') === id && !row.has('insert'))
    if (index < 0) document.add(document.createNode({ id, config }))
    else document.setIn([index, 'config'], document.createNode(config))
  }
  const after = String(document)
  if (after === before) return
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, after, { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch { /* Renamed or never written. */ }
  }
}

export function resolveDshWebFrontendDirectory(): string {
  return join(dirname(runtimeRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist')
}

export interface DshDesktopPluginHostReady {
  url: string
  injections: readonly unknown[]
}

export interface DshDesktopHostConfiguration {
  providerPatchPath?: string
  credentials: Record<string, string>
}

export interface DshDesktopPluginHostOptions {
  runtimeDataRoot: string
  workspaceRoot: string
  agentPatchPath: string
  hostConfiguration: () => DshDesktopHostConfiguration
  executablePath: string
  packageManager?: { entryPath: string; nodeBinPath: string }
  onDiagnostic?: (message: string) => void
  onFailure?: (error: Error) => void
}

function isChildMessage(value: unknown): value is ChildHostMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const message = value as Record<string, unknown>
  if (message.type === 'ready') return typeof message.url === 'string' && Array.isArray(message.injections)
  if (message.type === 'fatal') return typeof message.message === 'string'
  if (message.type === 'run-notification') return typeof message.id === 'string' && typeof message.method === 'string'
  if (message.type === 'run-complete') return typeof message.id === 'string' && typeof message.finalResponse === 'string'
  if (message.type === 'run-failed') return typeof message.id === 'string' && typeof message.message === 'string'
  if (message.type === 'create-complete') return typeof message.id === 'string'
    && (message.message === undefined || typeof message.message === 'string')
  if (message.type === 'cancel-complete') return typeof message.id === 'string' && typeof message.cancelled === 'boolean'
  if (message.type === 'dispose-complete') return typeof message.id === 'string' && typeof message.disposed === 'boolean'
  if (message.type === 'rewind-complete') return typeof message.id === 'string'
    && (message.cut === undefined || Number.isSafeInteger(message.cut))
    && (message.unavailable === undefined || message.unavailable === true)
    && (message.message === undefined || typeof message.message === 'string')
  if (message.type === 'edit-message-complete') return typeof message.id === 'string'
    && (message.message === undefined || typeof message.message === 'string')
  if (message.type === 'reconfigure-complete') return typeof message.id === 'string'
    && (message.message === undefined || typeof message.message === 'string')
  return message.type === 'shutdown-complete'
}

interface ActiveHostRun {
  onNotification: (notification: HarnessNotification) => void
  resolve: (result: { finalResponse: string; events: unknown[] }) => void
  reject: (error: Error) => void
  events: unknown[]
}

export class DshDesktopPluginHost {
  private child: ChildProcess | undefined
  private readyTask: Promise<DshDesktopPluginHostReady> | undefined
  private configurationTask: Promise<DshDesktopPluginHostReady> | undefined
  private configurationKey = ''
  private stopping = false
  private readonly runs = new Map<string, ActiveHostRun>()
  private readonly controls = new Map<string, { resolve: (value: boolean) => void; reject: (error: Error) => void }>()
  private readonly rewinds = new Map<string, { resolve: (cut: number | undefined) => void; reject: (error: Error) => void }>()
  private readonly messageEdits = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  private readonly reconfigurations = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()

  constructor(private readonly options: DshDesktopPluginHostOptions) {}

  start(requestedConfiguration?: DshDesktopHostConfiguration): Promise<DshDesktopPluginHostReady> {
    const hostConfiguration = requestedConfiguration ?? this.options.hostConfiguration()
    const configurationKey = JSON.stringify(hostConfiguration)
    if (this.readyTask !== undefined) {
      if (configurationKey === this.configurationKey && this.configurationTask === undefined) return this.readyTask
      const task = (this.configurationTask ?? this.readyTask).then(async ready => {
        if (configurationKey === this.configurationKey) return ready
        if (this.runs.size > 0) throw new Error('当前回复尚未结束，模型配置将在下一轮生效。')
        await this.reconfigure(hostConfiguration)
        this.configurationKey = configurationKey
        return ready
      })
      this.configurationTask = task
      void task.then(() => {
        if (this.configurationTask === task) this.configurationTask = undefined
      }, () => {
        if (this.configurationTask === task) this.configurationTask = undefined
      })
      return task
    }
    this.configurationKey = configurationKey
    const home = join(this.options.runtimeDataRoot, 'home')
    const profile = join(home, 'profiles', 'desktop')
    initProfile(profile, [...PROFILE_TEMPLATES.web.bundles, '@eleckoi/dsh-client-roleplay', TAVILY_BUNDLE])
    selectTavilyBundleOnce(profile)
    const profileManifest = readProfileManifest('dsh', profile)
    const activeBundles = profileManifest.dsh?.profile?.bundles ?? []
    if (!activeBundles.includes('@eleckoi/dsh-client-roleplay')) {
      writeProfileBundles(profile, profileManifest, [...activeBundles, '@eleckoi/dsh-client-roleplay'])
    }
    synchronizeModelProfile(profile, hostConfiguration.providerPatchPath)
    const overlayPath = join(profile, 'eleckoi-plugin-host.patch.yml')
    const clientCharactersEntry = runtimeRequire.resolve('@eleckoi/dsh-client-characters')
    const clientCharacterConfigurationEntry = runtimeRequire.resolve('@eleckoi/dsh-client-character-configuration')
    const clientConversationsEntry = runtimeRequire.resolve('@eleckoi/dsh-client-conversations')
    const clientModelsEntry = runtimeRequire.resolve('@eleckoi/dsh-client-models')
    const clientPersonaEntry = runtimeRequire.resolve('@eleckoi/dsh-client-persona')
    const clientPresetsEntry = runtimeRequire.resolve('@eleckoi/dsh-client-presets')
    const clientShellEntry = runtimeRequire.resolve('@eleckoi/dsh-client-shell')
    const sessionEditEntry = runtimeRequire.resolve('@eleckoi/dsh-runtime/session-edit-plugin')
    const sessionRoot = join(this.options.runtimeDataRoot, 'sessions')
    writeFileSync(overlayPath, [
      '- id: session-persistence-jsonl',
      '  config:',
      `    root: ${JSON.stringify(sessionRoot)}`,
      '    compression: none',
      '- id: desktop-product-telemetry',
      '  disabled: true',
      '- id: product-analytics',
      '  disabled: true',
      '- id: ui-layout',
      '  disabled: true',
      '- id: ui-sidebar',
      '  disabled: true',
      '- id: ui-settings-general',
      '  disabled: true',
      '- id: ui-settings-models',
      '  config:',
      '    credentialOnboarding: false',
      '- insert:',
      '    - id: eleckoi-client-characters',
      `      name: ${JSON.stringify(clientCharactersEntry)}`,
      '    - id: eleckoi-client-character-configuration',
      `      name: ${JSON.stringify(clientCharacterConfigurationEntry)}`,
      '    - id: eleckoi-client-conversations',
      `      name: ${JSON.stringify(clientConversationsEntry)}`,
      '    - id: eleckoi-client-models',
      `      name: ${JSON.stringify(clientModelsEntry)}`,
      '    - id: eleckoi-client-persona',
      `      name: ${JSON.stringify(clientPersonaEntry)}`,
      '    - id: eleckoi-client-presets',
      `      name: ${JSON.stringify(clientPresetsEntry)}`,
      '    - id: eleckoi-client-shell',
      `      name: ${JSON.stringify(clientShellEntry)}`,
      '    - id: eleckoi-session-edit',
      `      name: ${JSON.stringify(sessionEditEntry)}`,
      ''
    ].join('\n'))
    const entry = require.resolve('@eleckoi/dsh-runtime/desktop-plugin-host')
    const child = spawn(this.options.executablePath, [
      entry,
      profile,
      overlayPath,
      this.options.packageManager?.entryPath ?? '',
      this.options.packageManager?.nodeBinPath ?? '',
      this.options.agentPatchPath,
      hostConfiguration.providerPatchPath ?? ''
    ], {
      cwd: profile,
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_SESSION_ROOT: sessionRoot,
        DSH_CWD: this.options.workspaceRoot,
        ELECKOI_SESSION_SNAPSHOT_ROOT: join(this.options.runtimeDataRoot, 'session-snapshots'),
        ELECKOI_PRESET_ROOT: join(this.options.runtimeDataRoot, 'generated-presets'),
        DSH_TELEMETRY_DISABLED: '1',
        ELECTRON_RUN_AS_NODE: '1',
        DSH_WEB_SEARCH_PROVIDER: hostConfiguration.credentials.DSH_WEB_SEARCH_PROVIDER,
        ELECKOI_TAVILY_API_KEY: hostConfiguration.credentials.ELECKOI_TAVILY_API_KEY
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    })
    this.child = child
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { this.options.onDiagnostic?.(chunk) })
    child.stderr?.on('data', (chunk: string) => { this.options.onDiagnostic?.(chunk) })
    this.readyTask = new Promise((resolve, reject) => {
      let settled = false
      let failureReported = false
      const reportFailure = (error: Error) => {
        if (failureReported || this.stopping) return
        failureReported = true
        this.options.onFailure?.(error)
      }
      const timeout = setTimeout(() => {
        fail(new Error('DSH 插件宿主启动超时。'))
        child.kill()
      }, 90_000)
      const fail = (error: Error) => {
        if (settled) {
          reportFailure(error)
          return
        }
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
      child.on('message', (value: unknown) => {
        if (!isChildMessage(value)) {
          fail(new Error('DSH 插件宿主返回了无效消息。'))
          return
        }
        if (value.type === 'fatal') fail(new Error(value.message))
        if (value.type === 'run-notification') {
          const run = this.runs.get(value.id)
          if (run !== undefined) {
            if (value.method === 'session.event') run.events.push(value.params.event)
            run.onNotification({ method: value.method, params: value.params })
          }
        }
        if (value.type === 'run-complete' || value.type === 'run-failed') {
          const run = this.runs.get(value.id)
          if (run !== undefined) {
            this.runs.delete(value.id)
            if (value.type === 'run-complete') run.resolve({ finalResponse: value.finalResponse, events: run.events })
            else run.reject(new Error(value.message))
          }
        }
        if (value.type === 'cancel-complete' || value.type === 'dispose-complete' || value.type === 'create-complete') {
          const pending = this.controls.get(value.id)
          if (pending !== undefined) {
            this.controls.delete(value.id)
            if (value.message) pending.reject(new Error(value.message))
            else pending.resolve(value.type === 'cancel-complete' ? value.cancelled
              : value.type === 'dispose-complete' ? value.disposed : true)
          }
        }
        if (value.type === 'rewind-complete') {
          const pending = this.rewinds.get(value.id)
          if (pending !== undefined) {
            this.rewinds.delete(value.id)
            if (value.message) pending.reject(new Error(value.message))
            else pending.resolve(value.unavailable ? undefined : value.cut)
          }
        }
        if (value.type === 'edit-message-complete') {
          const pending = this.messageEdits.get(value.id)
          if (pending !== undefined) {
            this.messageEdits.delete(value.id)
            if (value.message) pending.reject(new Error(value.message))
            else pending.resolve()
          }
        }
        if (value.type === 'reconfigure-complete') {
          const pending = this.reconfigurations.get(value.id)
          if (pending !== undefined) {
            this.reconfigurations.delete(value.id)
            if (value.message) pending.reject(new Error(value.message))
            else pending.resolve()
          }
        }
        if (value.type === 'ready' && !settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ url: value.url, injections: value.injections })
        }
      })
      child.once('error', error => fail(error))
      child.once('exit', code => {
        const error = new Error(`DSH 插件宿主退出：${String(code)}`)
        for (const run of this.runs.values()) run.reject(error)
        this.runs.clear()
        for (const pending of this.controls.values()) pending.reject(error)
        this.controls.clear()
        for (const pending of this.rewinds.values()) pending.reject(error)
        this.rewinds.clear()
        for (const pending of this.messageEdits.values()) pending.reject(error)
        this.messageEdits.clear()
        for (const pending of this.reconfigurations.values()) pending.reject(error)
        this.reconfigurations.clear()
        if (this.child === child) {
          this.child = undefined
          this.readyTask = undefined
          this.configurationTask = undefined
        }
        if (!this.stopping) fail(error)
      })
    })
    this.readyTask = this.readyTask.then(async ready => {
      await this.reconfigure(hostConfiguration)
      return ready
    })
    return this.readyTask
  }

  private reconfigure(configuration: DshDesktopHostConfiguration): Promise<void> {
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('DSH 会话宿主未连接。')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.reconfigurations.set(id, { resolve, reject })
      const message: ParentHostMessage = {
        type: 'reconfigure', id,
        providerPatchPath: configuration.providerPatchPath,
        credentials: configuration.credentials
      }
      child.send(message, error => {
        if (error === null) return
        this.reconfigurations.delete(id)
        reject(error)
      })
    })
  }

  async createSession(sessionId: string, cwd: string): Promise<void> {
    await (this.readyTask ?? this.start())
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('DSH 会话宿主未连接。')
    const id = randomUUID()
    await new Promise<void>((resolve, reject) => {
      this.controls.set(id, { resolve: () => resolve(), reject })
      const message: ParentHostMessage = { type: 'create', id, sessionId, cwd }
      child.send(message, error => {
        if (error === null) return
        this.controls.delete(id)
        reject(error)
      })
    })
  }

  async run(input: {
    sessionId: string
    cwd: string
    selection: HostRunRequest['selection']
    content: HostPromptPart[]
    files: import('./types').DshInputFile[]
    onNotification: (notification: HarnessNotification) => void
  }): Promise<{ finalResponse: string; events: unknown[] }> {
    await (this.readyTask ?? this.start())
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('DSH 会话宿主未连接。')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.runs.set(id, { resolve, reject, onNotification: input.onNotification, events: [] })
      const message: ParentHostMessage = { type: 'run', id, sessionId: input.sessionId, cwd: input.cwd, selection: input.selection, content: input.content, files: input.files }
      child.send(message, error => {
        if (error === null) return
        this.runs.delete(id)
        reject(error)
      })
    })
  }

  async cancel(sessionId: string): Promise<boolean> {
    const child = this.child
    if (child === undefined || !child.connected) return false
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.controls.set(id, { resolve, reject })
      const message: ParentHostMessage = { type: 'cancel', id, sessionId }
      child.send(message, error => {
        if (error === null) return
        this.controls.delete(id)
        reject(error)
      })
    })
  }

  async dispose(sessionId: string): Promise<boolean> {
    const child = this.child
    if (child === undefined || !child.connected) return false
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.controls.set(id, { resolve, reject })
      const message: ParentHostMessage = { type: 'dispose', id, sessionId }
      child.send(message, error => {
        if (error === null) return
        this.controls.delete(id)
        reject(error)
      })
    })
  }

  async rewind(sessionId: string, fromTurn: number): Promise<number | undefined> {
    await (this.readyTask ?? this.start())
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('DSH 会话宿主未连接。')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.rewinds.set(id, { resolve, reject })
      const message: ParentHostMessage = { type: 'rewind', id, sessionId, fromTurn }
      child.send(message, error => {
        if (error === null) return
        this.rewinds.delete(id)
        reject(error)
      })
    })
  }

  async editMessage(sessionId: string, messageId: string, role: 'user' | 'assistant', content: string): Promise<void> {
    await (this.readyTask ?? this.start())
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('DSH 会话宿主未连接。')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.messageEdits.set(id, { resolve, reject })
      const message: ParentHostMessage = { type: 'edit-message', id, sessionId, messageId, role, content }
      child.send(message, error => {
        if (error === null) return
        this.messageEdits.delete(id)
        reject(error)
      })
    })
  }

  async close(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    const child = this.child
    this.child = undefined
    this.readyTask = undefined
    this.configurationTask = undefined
    if (child === undefined || child.exitCode !== null) return
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    if (child.connected) child.send({ type: 'shutdown' })
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 5_000))
    ])
    if (!graceful) {
      child.kill()
      await exited
    }
  }
}
