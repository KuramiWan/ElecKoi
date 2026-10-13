import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { initProfile, PROFILE_TEMPLATES, readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'
import {
  ELECKOI_FAILURE_CODES,
  isEleckoiFailureCode,
  type EleckoiFailureCode
} from '@eleckoi/product-shared/contracts/errors/codes'
import type { EleckoiFailureDetails } from '@eleckoi/product-shared/contracts/errors/details'
import { ELECKOI_DESKTOP_BUNDLES, registerDesktopBundles } from './desktopPluginBundles'
import {
  HOST_SESSION_PROTOCOL_VERSION,
  type ChildHostFatalMessage,
  type ChildHostMessage,
  type ParentHostMessage
} from './hostSessionProtocol'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('@eleckoi/desktop-host'))
const TAVILY_BUNDLE = '@eleckoi/dsh-web-search-tavily'

/**
 * TODO(迁移清理)：受支持的升级及 profile 恢复入口都已完成 tavily-bundle-v1 登记后，
 * 删除本函数、start 调用及对应旧 profile 用例。保留新 profile 的 Tavily 默认选择，
 * 以及通过正式 profile 保存用户启停选择的正常流程；不要删除现有用户配置或标记文件。
 */
function selectTavilyBundleOnce(profile: string): void {
  const marker = join(profile, '.eleckoi-tavily-bundle-v1')
  if (existsSync(marker)) return
  const manifest = readProfileManifest('dsh', profile)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(TAVILY_BUNDLE)) writeProfileBundles(profile, manifest, [...bundles, TAVILY_BUNDLE])
  writeFileSync(marker, 'initialized\n', { flag: 'wx' })
}

export function resolveDshWebFrontendDirectory(): string {
  return join(dirname(runtimeRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist')
}

export interface DshDesktopPluginHostReady {
  url: string
  injections: readonly unknown[]
}

export interface DshDesktopPluginHostOptions {
  runtimeDataRoot: string
  workspaceRoot: string
  productDatabasePath: string
  productMediaRoot: string
  presetTemplatePath: string
  agentPatchPath: string
  executablePath: string
  packageManager?: { entryPath: string; nodeBinPath: string }
  /** 子进程 stdout/stderr 的每一段输出（此前没人接，读出来就丢）。 */
  onDiagnostic?: (message: string) => void
  onFailure?: (failure: DshPluginHostFailure) => void
}

export type DshDesktopPluginHostEnvironment = Readonly<Record<string, string>>

/**
 * ③ 边界产出的可记录对象：形状就是 `EleckoiFailure`（`{ code, message, details }`，边界⑦ 要求
 * 任何边界都产出同一个可记录对象），再带上子进程协议给的两个诊断指针 `stack` / `logPath`
 * （ADR 决定 10：诊断用指针与 stack 承载，不把整段日志塞进消息）。
 *
 * 它同时是 `Error`，因为 ③ 边界有两条路要用同一个对象：`ready` **之前**到达的 `fatal` 走 reject
 * （`main.ts` 的 `dialog.showErrorBox` 读它），`ready` **之后**到达的走 `onFailure`（宿主日志读它）。
 * 两条路拿到的都是这一个对象，值不在任一条路上丢。
 *
 * 折叠规则（`packages/product-shared/src/contracts/errors/boundaries.ts` 的 ③ 表）：帧带的码在契约码表里
 * 就原样保留；没带或不在表里（legacy 6 码、更新的子进程发来的码）折成兜底码，原码进 `details.what`
 * 做诊断——**不许猜**成某个域码。
 */
export class DshPluginHostFailure extends Error {
  readonly code: EleckoiFailureCode
  readonly details: EleckoiFailureDetails
  readonly logPath: string | undefined

  constructor(fields: {
    readonly message: string
    /** 未校验的原始码：它来自另一个进程，用前必须过码表。 */
    readonly code?: string
    /** 子进程侧的 stack；给了就用它做这个失败的 stack（诊断以子进程为准）。 */
    readonly stack?: string
    readonly logPath?: string
  }) {
    super(fields.message)
    this.name = 'DshPluginHostFailure'
    const rawCode = fields.code
    if (rawCode !== undefined && isEleckoiFailureCode(rawCode)) {
      this.code = rawCode
      this.details = {}
    } else {
      this.code = ELECKOI_FAILURE_CODES.internal
      this.details = rawCode === undefined ? {} : { what: rawCode }
    }
    this.logPath = fields.logPath
    if (fields.stack !== undefined) this.stack = fields.stack
  }
}

/**
 * ③ 边界：把**消费侧认过的** `fatal` 帧折成可记录对象（判定在 {@link isChildMessage}，
 * 这里只折叠、不重新校验形状）。帧里的 `code` / `stack` / `logPath` 一个都不许丢。
 */
export function pluginHostFailureOf(frame: ChildHostFatalMessage): DshPluginHostFailure {
  return new DshPluginHostFailure({
    message: frame.message,
    code: frame.code,
    stack: frame.stack,
    logPath: frame.logPath
  })
}

/**
 * 子进程消息的**显式白名单**：只有下面四条合法，其余一律不合法。
 *
 * 收尾是 `return false` 而不是「没命中就当作某一种」：静默接受未知消息等于静默丢诊断（EH-6）。
 * `ready` 帧在这里断言协议版本——上下两侧读的是 {@link HOST_SESSION_PROTOCOL_VERSION} 同一个常量，
 * 所以版本偏斜在消费侧当场失败，而不是让一个版本对不上的子进程继续跑。
 */
export function isChildMessage(value: unknown): value is ChildHostMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const message = value as Record<string, unknown>
  if (message.type === 'ready') {
    return message.protocolVersion === HOST_SESSION_PROTOCOL_VERSION
      && typeof message.url === 'string'
      && Array.isArray(message.injections)
  }
  if (message.type === 'fatal') {
    return typeof message.message === 'string'
      && isOptionalString(message.code)
      && isOptionalString(message.stack)
      && isOptionalString(message.logPath)
  }
  if (message.type === 'update-tasks-complete') {
    return typeof message.id === 'string'
      && typeof message.active === 'boolean'
      && isOptionalString(message.message)
  }
  if (message.type === 'shutdown-complete') return true
  return false
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

/**
 * 拒绝一条子进程消息时的开发者诊断：说清拒绝的是什么（`type` 是唯一有信息量的字段）。
 * `ready` 帧单独说——协议版本偏斜要一眼看得出来，它折兜底码（③ 表的「协议版本偏斜或握手失败」）。
 */
export function childMessageDiagnosticOf(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return 'DSH 插件宿主返回了无效消息：消息没有 type 字段。'
  }
  const observedType = String(value.type)
  if (observedType !== 'ready') return `DSH 插件宿主返回了无效消息：type=${observedType}。`
  const version = 'protocolVersion' in value ? String(value.protocolVersion) : '缺失'
  return `DSH 插件宿主协议版本偏斜：子进程 ${version}，宿主 ${String(HOST_SESSION_PROTOCOL_VERSION)}。`
}

interface PendingControl {
  resolve(value: boolean): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class DshDesktopPluginHost {
  private child: ChildProcess | undefined
  private readyTask: Promise<DshDesktopPluginHostReady> | undefined
  private stopping = false
  private readonly controls = new Map<string, PendingControl>()

  constructor(private readonly options: DshDesktopPluginHostOptions) {
    if (typeof options.productDatabasePath !== 'string' || options.productDatabasePath.trim().length === 0) {
      throw new Error('DSH 插件宿主必须提供产品数据库路径。')
    }
    if (typeof options.productMediaRoot !== 'string' || options.productMediaRoot.trim().length === 0) {
      throw new Error('DSH 插件宿主必须提供产品媒体目录。')
    }
  }

  start(environment: DshDesktopPluginHostEnvironment = {}): Promise<DshDesktopPluginHostReady> {
    if (this.readyTask !== undefined) return this.readyTask
    if (this.stopping) return Promise.reject(new Error('DSH 插件宿主正在停止。'))
    const home = join(this.options.runtimeDataRoot, 'home')
    const profile = join(home, 'profiles', 'desktop')
    initProfile(profile, [...PROFILE_TEMPLATES.web.bundles, ...ELECKOI_DESKTOP_BUNDLES, TAVILY_BUNDLE])
    registerDesktopBundles(profile)
    selectTavilyBundleOnce(profile)
    const overlayPath = join(profile, 'eleckoi-plugin-host.patch.yml')
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
      '  disabled: true',
      ''
    ].join('\n'))
    const child = spawn(this.options.executablePath, [
      require.resolve('@eleckoi/desktop-host/host'),
      profile,
      overlayPath,
      this.options.packageManager?.entryPath ?? '',
      this.options.packageManager?.nodeBinPath ?? '',
      this.options.agentPatchPath
    ], {
      cwd: profile,
      env: {
        ...process.env,
        ...environment,
        DSH_HOME: home,
        DSH_SESSION_ROOT: sessionRoot,
        DSH_CWD: this.options.workspaceRoot,
        ELECKOI_SESSION_SNAPSHOT_ROOT: join(this.options.runtimeDataRoot, 'session-snapshots'),
        ELECKOI_PRESET_ROOT: join(this.options.runtimeDataRoot, 'generated-presets'),
        ELECKOI_PRESET_TEMPLATE_PATH: this.options.presetTemplatePath,
        ELECKOI_SESSION_BRIDGE_ROOT: join(this.options.runtimeDataRoot, 'session-bridges'),
        ELECKOI_DATABASE_PATH: this.options.productDatabasePath,
        ELECKOI_MEDIA_ROOT: this.options.productMediaRoot,
        ELECKOI_WORKSPACE_ROOT: this.options.workspaceRoot,
        DSH_TELEMETRY_DISABLED: '1',
        ELECTRON_RUN_AS_NODE: '1'
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
      const timeout = setTimeout(() => {
        fail(new DshPluginHostFailure({ message: 'DSH 插件宿主启动超时。' }))
        child.kill()
      }, 90_000)
      const reportFailure = (failure: DshPluginHostFailure): void => {
        if (failureReported || this.stopping) return
        failureReported = true
        this.options.onFailure?.(failure)
      }
      const fail = (failure: DshPluginHostFailure): void => {
        if (settled) reportFailure(failure)
        else {
          settled = true
          clearTimeout(timeout)
          reject(failure)
        }
      }
      child.on('message', (value: unknown) => {
        if (!isChildMessage(value)) {
          fail(new DshPluginHostFailure({ message: childMessageDiagnosticOf(value) }))
          return
        }
        if (value.type === 'fatal') fail(pluginHostFailureOf(value))
        if (value.type === 'update-tasks-complete') {
          const pending = this.controls.get(value.id)
          if (pending !== undefined) {
            clearTimeout(pending.timer)
            this.controls.delete(value.id)
            if (value.message) pending.reject(new Error(value.message))
            else pending.resolve(value.active)
          }
        }
        if (value.type === 'ready' && !settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ url: value.url, injections: value.injections })
        }
      })
      child.once('error', error => fail(new DshPluginHostFailure({
        message: error.message,
        stack: error.stack
      })))
      child.once('exit', code => {
        const failure = new DshPluginHostFailure({ message: `DSH 插件宿主退出：${String(code)}` })
        this.rejectControls(failure)
        if (this.child === child) {
          this.child = undefined
          this.readyTask = undefined
        }
        if (!this.stopping) fail(failure)
      })
    })
    return this.readyTask
  }

  async updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean> {
    await (this.readyTask ?? this.start())
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('DSH 插件宿主未连接。')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controls.delete(id)
        reject(new Error('DSH 任务检查超时。'))
      }, 10_000)
      this.controls.set(id, { resolve, reject, timer })
      const message: ParentHostMessage = { type: 'update-tasks', id, action }
      child.send(message, error => {
        if (error === null) return
        clearTimeout(timer)
        this.controls.delete(id)
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
    this.rejectControls(new Error('DSH 插件宿主正在停止。'))
    if (child === undefined || child.exitCode !== null) return
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    if (child.connected) child.send({ type: 'shutdown' } satisfies ParentHostMessage)
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 5_000))
    ])
    if (!graceful) {
      child.kill()
      await exited
    }
  }

  private rejectControls(error: Error): void {
    for (const pending of this.controls.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.controls.clear()
  }
}
