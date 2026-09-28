import { delimiter } from 'node:path'
import { createReadStream } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import {
  loadLayeredEnv, loadOverlayPatches, loadProfileDirectory, readProfilePatches,
  reconcileProfilePatches, reportSkippedBundles
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR, runProfile } from '@deepseek-ai/dsh/profile-boot'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ChildHostMessage, HostRunRequest, ParentHostMessage } from './hostSessionProtocol'

function send(message: ChildHostMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) {
      resolve()
      return
    }
    process.send(message, error => error === null ? resolve() : reject(error))
  })
}

function finalMessageText(event: Record<string, unknown>): string | undefined {
  if (event.type !== 'assistant/message') return undefined
  const data = event.data
  if (typeof data !== 'object' || data === null) return undefined
  const message = (data as Record<string, unknown>).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content) || content.some(part => typeof part === 'object' && part !== null && (part as Record<string, unknown>).type === 'tool-call')) {
    return undefined
  }
  return content.filter(part => typeof part === 'object' && part !== null && (part as Record<string, unknown>).type === 'text')
    .map(part => String((part as Record<string, unknown>).text ?? '')).join('')
}

async function main(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (profileDirectory === undefined) throw new Error('Missing desktop plugin profile directory')
  const profile = loadProfileDirectory('dsh', profileDirectory, INSTALL_ANCHOR)
  reportSkippedBundles('dsh', profile)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles: [process.argv[3], process.argv[6]].filter((value): value is string => Boolean(value)),
    args: ['--no-open', '--port', '0'],
    ...!process.argv[4] ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[4]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[5] ?? ''}${delimiter}${process.env.PATH ?? ''}`
        }
      }
    }
  })
  let stopping: Promise<void> | undefined
  const activeRuns = new Map<string, AbortController>()
  const stop = (): Promise<void> => stopping ??= (async () => {
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect?.()
  })()
  const { ctx } = await application
  let providerPatchPath = process.argv[7] || undefined
  let configuredCredentials: Record<string, string> = {}
  const reconfigure = async (message: Extract<ParentHostMessage, { type: 'reconfigure' }>): Promise<void> => {
    if (activeRuns.size > 0) throw new Error('当前回复尚未结束，模型配置将在下一轮生效。')
    const credentials = ctx.get('credentials')
    if (credentials === undefined) throw new Error('DSH 凭据服务未装载。')
    const nextCredentials = message.credentials
    const credentialNames = new Set([...Object.keys(configuredCredentials), ...Object.keys(nextCredentials)])
    for (const name of credentialNames) {
      if (name === 'DSH_WEB_SEARCH_PROVIDER' || name === 'ELECKOI_TAVILY_API_KEY'
        || name === 'ELECKOI_WEB_SEARCH_MAX_RESULTS') continue
      const value = nextCredentials[name] ?? ''
      if (value === (configuredCredentials[name] ?? '')) continue
      if (value) await credentials.set(credentialRef(name), value)
      else await credentials.unset(credentialRef(name))
    }
    for (const name of ['DSH_WEB_SEARCH_PROVIDER', 'ELECKOI_TAVILY_API_KEY', 'ELECKOI_WEB_SEARCH_MAX_RESULTS']) {
      process.env[name] = nextCredentials[name] ?? ''
    }
    if (message.providerPatchPath && message.providerPatchPath !== providerPatchPath) {
      const editor = ctx.get('configEditor') as {
        entries(): Array<{ options: { id: string; config?: unknown } }>
        edit(entry: unknown, change: () => unknown): Promise<void>
      } | undefined
      if (editor === undefined) throw new Error('DSH 模型配置编辑插件未装载。')
      const models = loadOverlayPatches('dsh', message.providerPatchPath)
      for (const id of ['llm-pi-ai', 'llm-deepseek']) {
        const config = models.findLast(row => row.id === id)?.config
        const entry = editor.entries().find(row => row.options.id === id)
        if (config === undefined || entry === undefined) throw new Error(`DSH 模型配置缺少 ${id}。`)
        if (!isDeepStrictEqual(entry.options.config ?? {}, config)) await editor.edit(entry, () => config)
      }
      providerPatchPath = message.providerPatchPath
    }
    if (nextCredentials.DSH_WEB_SEARCH_PROVIDER !== configuredCredentials.DSH_WEB_SEARCH_PROVIDER) {
      await reconcileProfilePatches(ctx, readProfilePatches('dsh', ctx.profileContext), 'dsh')
    }
    configuredCredentials = { ...nextCredentials }
  }
  const sessionHandles = (ctx as typeof ctx & {
    eleckoiSessionHandles?: { dispose(sessionId: string): Promise<boolean> }
  }).eleckoiSessionHandles
  const presetRegistrar = (ctx as typeof ctx & {
    eleckoiPresetRegistrar?: {
      registerForSession(sessionId: string): Promise<string>
      selectForSession(sessionId: string): Promise<string>
    }
  }).eleckoiPresetRegistrar
  const sessionEditor = (ctx as typeof ctx & {
    eleckoiSessionEditor?: {
      rewind(sessionId: string, fromTurn: number): Promise<number | undefined>
      editMessage(sessionId: string, messageId: string, role: 'user' | 'assistant', content: string): Promise<void>
    }
  }).eleckoiSessionEditor
  const runSession = async (request: HostRunRequest): Promise<void> => {
    const sessionId = request.sessionId as SessionId
    const abort = new AbortController()
    activeRuns.set(request.id, abort)
    try {
      if (presetRegistrar === undefined) throw new Error('ElecKoi Agent 预设注册器未装载。')
      const agentPreset = await presetRegistrar.registerForSession(request.sessionId)
      await ctx.sessionController.create({ sessionId, cwd: request.cwd, agentPreset })
      await presetRegistrar.selectForSession(request.sessionId)
      await ctx.sessionController.selectModel({ sessionId, ...request.selection })
      const follow = ctx.sessionController.follow({
        address: { kind: 'session', sessionId }, assistantStream: true
      }, abort.signal)[Symbol.asyncIterator]()
      const opening = await follow.next()
      if (opening.done || opening.value.type !== 'snapshot') throw new Error('DSH 会话事件流没有返回初始快照。')
      const cursor = opening.value.cursor
      const fileParts: Array<Parameters<typeof ctx.sessionController.prompt>[0]['content'][number]> = []
      for (const file of request.files) {
        const data = file.reference
          ? ctx.attachments.readFileStream(file.reference as FileAttachmentRef, abort.signal)
          : createReadStream(file.path, { highWaterMark: 64 * 1024, signal: abort.signal })
        const uploaded = await ctx.fileUploads.uploadStream({ sessionId, data, name: file.name, signal: abort.signal })
        await send({ type: 'run-notification', id: request.id, method: 'agent.file-uploaded',
          params: { sessionId, draftId: file.id, file: uploaded.file } })
        fileParts.push({ type: 'file', receiptId: uploaded.receiptId })
      }
      let finalResponse = ''
      const settled = (async () => {
        for (;;) {
          const next = await follow.next()
          if (next.done) throw new Error('DSH 会话在回复完成前结束。')
          const frame = next.value
          if (frame.type === 'assistant-stream') {
            await send({
              type: 'run-notification', id: request.id, method: 'agent.assistant-stream',
              params: { sessionId, frame: frame.frame }
            })
            continue
          }
          if (frame.type !== 'event' || frame.event.seq <= cursor) continue
          const event = frame.event as unknown as Record<string, unknown>
          await send({ type: 'run-notification', id: request.id, method: 'session.event', params: { sessionId, event } })
          finalResponse = finalMessageText(event) ?? finalResponse
          if (event.type === 'turn/end') return finalResponse
        }
      })()
      void settled.catch(() => {})
      const prompt = await ctx.sessionController.prompt({
        requestId: request.id as Parameters<typeof ctx.sessionController.prompt>[0]['requestId'],
        sessionId, mode: 'queue', content: [...request.content, ...fileParts]
      }, abort.signal)
      if (!prompt.accepted) throw new Error('DSH 会话没有接受消息。')
      await send({ type: 'run-complete', id: request.id, finalResponse: await settled })
    } catch (error) {
      await send({ type: 'run-failed', id: request.id, message: error instanceof Error ? error.message : String(error) })
    } finally {
      abort.abort()
      activeRuns.delete(request.id)
    }
  }
  process.on('message', (value: unknown) => {
    if (typeof value !== 'object' || value === null || !('type' in value)) return
    const message = value as ParentHostMessage
    if (message.type === 'shutdown') {
      for (const run of activeRuns.values()) run.abort()
      void stop()
    } else if (message.type === 'run') {
      void runSession(message)
    } else if (message.type === 'create') {
      void (async () => {
        if (presetRegistrar === undefined) throw new Error('ElecKoi Agent 预设注册器未装载。')
        const agentPreset = await presetRegistrar.registerForSession(message.sessionId)
        await ctx.sessionController.create({ sessionId: message.sessionId as SessionId, cwd: message.cwd, agentPreset })
        const session = ctx.sessions.get(message.sessionId as SessionId)
        if (session === undefined) throw new Error('DSH 新建会话未进入会话仓库。')
        await ctx.sessions.flush(session)
        await send({ type: 'create-complete', id: message.id })
      })().catch(error => {
        void send({ type: 'create-complete', id: message.id, message: String(error) })
      })
    } else if (message.type === 'cancel') {
      try {
        ctx.sessionController.cancel({ sessionId: message.sessionId as SessionId })
        void send({ type: 'cancel-complete', id: message.id, cancelled: true })
      } catch (error) {
        void send({ type: 'cancel-complete', id: message.id, cancelled: false, message: String(error) })
      }
    } else if (message.type === 'dispose') {
      void (async () => {
        if (sessionHandles === undefined) throw new Error('ElecKoi 会话生命周期服务未装载。')
        const disposed = await sessionHandles.dispose(message.sessionId)
        await send({ type: 'dispose-complete', id: message.id, disposed })
      })().catch(error => {
        void send({ type: 'dispose-complete', id: message.id, disposed: false, message: String(error) })
      })
    } else if (message.type === 'rewind') {
      void (async () => {
        if (sessionEditor === undefined) throw new Error('ElecKoi 会话编辑插件未装载。')
        const cut = await sessionEditor.rewind(message.sessionId, message.fromTurn)
        await send({ type: 'rewind-complete', id: message.id, ...(cut === undefined ? { unavailable: true } : { cut }) })
      })().catch(error => {
        void send({ type: 'rewind-complete', id: message.id, message: String(error) })
      })
    } else if (message.type === 'edit-message') {
      void (async () => {
        if (sessionEditor === undefined) throw new Error('ElecKoi 会话编辑插件未装载。')
        if (activeRuns.size > 0) throw new Error('回复仍在生成，不能编辑消息。')
        await sessionEditor.editMessage(message.sessionId, message.messageId, message.role, message.content)
        await send({ type: 'edit-message-complete', id: message.id })
      })().catch(error => {
        void send({ type: 'edit-message-complete', id: message.id, message: String(error) })
      })
    } else if (message.type === 'reconfigure') {
      void reconfigure(message).then(() => send({ type: 'reconfigure-complete', id: message.id })).catch(error => {
        void send({ type: 'reconfigure-complete', id: message.id, message: String(error) })
      })
    }
  })
  process.once('disconnect', () => {
    for (const run of activeRuns.values()) run.abort()
    void stop()
  })
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  await send({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() })
}

void main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error)
  await send({ type: 'fatal', message }).catch(() => undefined)
  console.error(error)
  process.exitCode = 1
  if (process.connected) process.disconnect?.()
})
