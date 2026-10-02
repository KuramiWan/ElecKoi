/** Composes each ElecKoi Agent from its immutable Session snapshot. */

import { installConversationContext } from './conversation-context.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { installRequestConfig } from './request-config.mjs'
import { commitSessionPreset, inheritSessionSnapshot, readSessionSnapshot, removeSessionSnapshot } from './session-snapshot.mjs'
import { applyDisabledPolicy } from './tool-policy.mjs'
import { installRoleplaySessionRuntime } from './session-runtime.mjs'

export const name = 'eleckoi-agent-preset-bridge'
export const inject = ['agents', 'agentPresets']

export async function apply(ctx) {
  const snapshotRoot = process.env.ELECKOI_SESSION_SNAPSHOT_ROOT
  const presetRoot = process.env.ELECKOI_PRESET_ROOT
  if (!snapshotRoot) throw new Error('ELECKOI_SESSION_SNAPSHOT_ROOT is required')
  if (!presetRoot) throw new Error('ELECKOI_PRESET_ROOT is required')
  const registrations = new Map()
  const sessionHandles = new Map()
  const sessionLocks = new Map()
  const withSessionLock = async (sessionId, action) => {
    const previous = sessionLocks.get(sessionId) ?? Promise.resolve()
    let release
    const current = new Promise((resolve) => { release = resolve })
    sessionLocks.set(sessionId, current)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (sessionLocks.get(sessionId) === current) sessionLocks.delete(sessionId)
    }
  }
  const disposeTracked = async (sessionId) => {
    const handle = sessionHandles.get(sessionId)
    if (!handle) {
      if (ctx.agents.get(sessionId)) throw new Error(`DSH 会话 ${sessionId} 有未跟踪的写入句柄。`)
      return false
    }
    await handle.dispose()
    if (sessionHandles.get(sessionId) === handle) sessionHandles.delete(sessionId)
    if (ctx.agents.get(sessionId)) throw new Error(`DSH 会话 ${sessionId} 的写入句柄未释放。`)
    return true
  }
  ctx.provide('eleckoiSessionHandles', {
    dispose: (sessionId) => withSessionLock(sessionId, () => disposeTracked(sessionId)),
    withClosed: (sessionId, action) => withSessionLock(sessionId, async () => {
      await disposeTracked(sessionId)
      return action()
    })
  })
  ctx.on('agent/disposed', ({ agent }) => {
    if (sessionHandles.get(agent.id)?.agent === agent) sessionHandles.delete(agent.id)
  })
  const trackHandle = (handle) => {
    sessionHandles.set(handle.agent.id, handle)
    return handle
  }
  const registerPreset = (id) => {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Error('ElecKoi Agent preset id is invalid')
    }
    const existing = registrations.get(id)
    if (existing) return existing
    const registration = Promise.resolve().then(() => {
      const definition = JSON.parse(readFileSync(join(presetRoot, id, 'preset.json'), 'utf8'))
      if (definition?.id !== id || !Array.isArray(definition.plugins)) {
        throw new Error(`ElecKoi Agent preset ${id} has an invalid composition`)
      }
      return ctx.agentPresets.register(definition)
    }).catch((error) => {
      registrations.delete(id)
      throw error
    })
    registrations.set(id, registration)
    return registration
  }
  // SessionController resolves the durable preset before calling agents.resume.
  // The generated declaration catalogue owns registrations; snapshots may outlive
  // a deleted declaration and must not become Host startup dependencies.
  if (existsSync(presetRoot)) {
    const ids = readdirSync(presetRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(presetRoot, entry.name, 'preset.json')))
      .map(entry => entry.name)
    try {
      await Promise.all(ids.map(registerPreset))
    } catch (error) {
      await Promise.allSettled([...registrations.values()].map(async task => (await task)()))
      throw error
    }
  }
  const presetRegistrar = {
    async registerForSession(sessionId) {
      const snapshot = readSessionSnapshot(snapshotRoot, sessionId)
      await registerPreset(snapshot.mountedPresetId)
      return snapshot.mountedPresetId
    },
    async selectForSession(sessionId) {
      return withSessionLock(sessionId, async () => {
        const snapshot = readSessionSnapshot(snapshotRoot, sessionId)
        const requested = snapshot.pendingPresetId
        if (!requested || requested === snapshot.mountedPresetId) return snapshot.mountedPresetId
        const agent = ctx.agents.get(sessionId)
        if (!agent) throw new Error(`DSH 会话 ${sessionId} 尚未激活，不能切换预设。`)
        if (agent.status !== 'idle') throw new Error(`DSH 会话 ${sessionId} 正在生成，不能切换预设。`)
        await registerPreset(requested)
        try {
          await ctx.agentPresets.recompose(agent.ctx, requested)
          agent.session.append('agent-preset/selected', { agentPreset: requested })
        } catch (error) {
          await ctx.agentPresets.recompose(agent.ctx, snapshot.mountedPresetId).catch(() => undefined)
          throw error
        }
        commitSessionPreset(snapshotRoot, sessionId, requested)
        applyDisabledPolicy(agent.ctx, snapshot.disabledToolGroupIds)
        return requested
      })
    }
  }
  ctx.provide('eleckoiPresetRegistrar', presetRegistrar)
  const disposeRuntime = installRoleplaySessionRuntime(ctx, presetRegistrar)
  const originalCreate = ctx.agents.create
  const originalResume = ctx.agents.resume
  const wrappedCreate = function (options) {
    const child = options.parentAgent !== undefined || options.meta?.origin === 'subagent'
    const sourceSessionId = child
      ? options.parentAgent?.session?.id ?? options.meta?.parentSession
      : options.sessionId
    if (!sourceSessionId) throw new Error('ElecKoi subagent is missing its parent Session id')
    const targetSessionId = child ? options.sessionId : sourceSessionId
    if (!targetSessionId) throw new Error('ElecKoi subagent is missing its child Session id')
    const snapshot = child
      ? inheritSessionSnapshot(snapshotRoot, sourceSessionId, targetSessionId)
      : readSessionSnapshot(snapshotRoot, sourceSessionId)
    const nextOptions = composeSessionOptions(ctx, options, snapshotRoot, targetSessionId, snapshot, child, false)
    return withSessionLock(targetSessionId, () => rollbackInheritedSnapshot(
      async () => {
        const existing = sessionHandles.get(targetSessionId)
        if (existing) return existing
        await registerPreset(snapshot.mountedPresetId)
        return trackHandle(await originalCreate.call(ctx.agents, nextOptions))
      },
      snapshotRoot,
      child ? targetSessionId : undefined
    ))
  }
  const wrappedResume = function (options) {
    const child = options.parentAgent !== undefined
    const sourceSessionId = child ? options.parentAgent?.session?.id : options.resumeSessionId
    if (!sourceSessionId) return originalResume.call(ctx.agents, options)
    let snapshot
    try {
      snapshot = readSessionSnapshot(snapshotRoot, sourceSessionId)
    } catch (error) {
      if (error?.code === 'ENOENT') return originalResume.call(ctx.agents, options)
      throw error
    }
    const targetSessionId = child ? options.resumeSessionId : sourceSessionId
    if (!targetSessionId) throw new Error('ElecKoi subagent is missing its resumed Session id')
    if (child) snapshot = inheritSessionSnapshot(snapshotRoot, sourceSessionId, targetSessionId)
    return withSessionLock(targetSessionId, () => rollbackInheritedSnapshot(
      async () => {
        const existing = sessionHandles.get(targetSessionId)
        if (existing) return existing
        await registerPreset(snapshot.mountedPresetId)
        return trackHandle(await originalResume.call(
          ctx.agents,
          composeSessionOptions(ctx, options, snapshotRoot, targetSessionId, snapshot, child, true)
        ))
      },
      snapshotRoot,
      child ? targetSessionId : undefined
    ))
  }

  ctx.agents.create = wrappedCreate
  ctx.agents.resume = wrappedResume
  return async () => {
    disposeRuntime()
    if (ctx.agents.create === wrappedCreate) ctx.agents.create = originalCreate
    if (ctx.agents.resume === wrappedResume) ctx.agents.resume = originalResume
    await Promise.allSettled([...registrations.values()].map(async (task) => {
      const dispose = await task
      await dispose()
    }))
  }
}

async function rollbackInheritedSnapshot(start, snapshotRoot, childSessionId) {
  try {
    return await start()
  } catch (error) {
    if (childSessionId) removeSessionSnapshot(snapshotRoot, childSessionId)
    throw error
  }
}

function composeSessionOptions(ctx, options, snapshotRoot, sourceSessionId, snapshot, child, resuming) {
  const model = child ? snapshot.subagentModel : snapshot.model
  if (!model?.provider || !model?.model) throw new Error(`Session ${sourceSessionId} has no model snapshot`)
  const originalSetup = options.setup
  return {
    ...options,
    agentOptions: requestAgentOptions(options.agentOptions, model),
    ...resuming || child ? {} : {
      meta: { ...(options.meta ?? {}), agentPreset: snapshot.mountedPresetId }
    },
    setup: async (agentCtx, agent) => {
      // Mounting a preset changes the Agent scope. Register product request
      // configuration and context before joining the preset composition.
      installRequestConfig(agentCtx, snapshotRoot, sourceSessionId, child)
      if (!child) installConversationContext(agentCtx, snapshotRoot, sourceSessionId)
      applyDisabledPolicy(agentCtx, snapshot.disabledToolGroupIds)
      const transaction = await originalSetup?.(agentCtx, agent)
      if (!child) await ctx.agentPresets.mount(agentCtx, snapshot.mountedPresetId)
      return transaction
    }
  }
}

function requestAgentOptions(inherited, model) {
  const { maxTokens: _maxTokens, reasoningEffort: _reasoningEffort, ...rest } = inherited ?? {}
  return {
    ...rest,
    provider: model.provider,
    model: model.model,
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort })
  }
}
