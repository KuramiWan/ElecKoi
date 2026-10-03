/** Composes each ElecKoi Agent from its immutable Session snapshot. */

import { installConversationContext } from './conversation-context.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { installRequestConfig } from './request-config.mjs'
import { readRuntimePresetDefinition } from './preset-definition.mjs'
import { commitSessionPreset, inheritSessionSnapshot, readSessionSnapshot, removeSessionSnapshot } from './session-snapshot.mjs'
import { applyDisabledPolicy } from './tool-policy.mjs'
import { ACTIVE_RUNTIME_PRESET_ID, installRoleplaySessionRuntime } from './session-runtime.mjs'

export const name = 'eleckoi-agent-preset-bridge'
export const inject = ['agents', 'agentPresets', 'sessionController']

export async function apply(ctx) {
  const snapshotRoot = process.env.ELECKOI_SESSION_SNAPSHOT_ROOT
  const presetRoot = process.env.ELECKOI_PRESET_ROOT
  const templatePath = process.env.ELECKOI_PRESET_TEMPLATE_PATH
  if (!snapshotRoot) throw new Error('ELECKOI_SESSION_SNAPSHOT_ROOT is required')
  if (!presetRoot) throw new Error('ELECKOI_PRESET_ROOT is required')
  let activeRegistration
  let registrationQueue = Promise.resolve()
  const legacyRegistrations = new Map()
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
  const registerActivePreset = () => {
    const id = ACTIVE_RUNTIME_PRESET_ID
    const path = join(presetRoot, id, 'preset.json')
    const revision = presetRevision(path)
    const operation = registrationQueue.then(async () => {
      if (activeRegistration?.revision === revision) return activeRegistration
      const definition = readRuntimePresetDefinition(path, id, templatePath)
      if (activeRegistration) {
        const previous = activeRegistration
        activeRegistration = undefined
        await previous.dispose()
      }
      const dispose = await ctx.agentPresets.register(definition)
      activeRegistration = { revision, dispose }
      return activeRegistration
    })
    registrationQueue = operation.catch(() => undefined)
    return operation
  }

  const registerLegacyPreset = (id) => {
    const existing = legacyRegistrations.get(id)
    if (existing) return existing
    const operation = Promise.resolve().then(async () => {
      const legacyPath = join(presetRoot, id, 'preset.json')
      const definition = existsSync(legacyPath)
        ? readRuntimePresetDefinition(legacyPath, id, templatePath)
        : legacyAliasDefinition(presetRoot, id, templatePath)
      const dispose = await ctx.agentPresets.register(definition)
      return { dispose }
    }).catch((error) => {
      legacyRegistrations.delete(id)
      throw error
    })
    legacyRegistrations.set(id, operation)
    return operation
  }

  const registerPreset = (id) => id === ACTIVE_RUNTIME_PRESET_ID
    ? registerActivePreset()
    : registerLegacyPreset(id)

  // TODO(remove legacy preset migration after the supported upgrade window):
  // remove legacyRegistrations, legacyAliasDefinition, and their migration tests
  // together once every supported release has durably selected eleckoi-active.
  // Until then old declarations must remain registered long enough for an old
  // Session log to resume once and persist the single current preset selection.
  if (existsSync(presetRoot)) {
    const ids = readdirSync(presetRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(presetRoot, entry.name, 'preset.json')))
      .map(entry => entry.name)
      .sort()
    await Promise.all(ids.map(registerPreset))
  }
  const presetRegistrar = {
    async prepareForSession(sessionId, requestedPresetId) {
      await registerPreset(requestedPresetId)
      const inspection = await ctx.sessionController.inspect(sessionId)
      const storedPresetId = storedPresetForInspection(inspection)
      if (storedPresetId) await registerPreset(storedPresetId)
      let snapshot
      try {
        snapshot = readSessionSnapshot(snapshotRoot, sessionId)
      } catch (error) {
        if (error?.code === 'ENOENT') return storedPresetId ?? requestedPresetId
        throw error
      }
      await registerPreset(snapshot.mountedPresetId)
      return storedPresetId ?? snapshot.mountedPresetId
    },
    async registerForSession(sessionId) {
      const snapshot = readSessionSnapshot(snapshotRoot, sessionId)
      await registerPreset(snapshot.mountedPresetId)
      return snapshot.mountedPresetId
    },
    async selectForSession(sessionId) {
      return withSessionLock(sessionId, async () => {
        const snapshot = readSessionSnapshot(snapshotRoot, sessionId)
        const requested = snapshot.pendingPresetId
        const requestedRevision = snapshot.pendingPresetRevision
        if (!requested || !requestedRevision) return snapshot.mountedPresetId
        if (requested === snapshot.mountedPresetId
          && requestedRevision === snapshot.mountedPresetRevision) return snapshot.mountedPresetId
        const agent = ctx.agents.get(sessionId)
        if (!agent) throw new Error(`DSH 会话 ${sessionId} 尚未激活，不能切换预设。`)
        if (agent.status !== 'idle') throw new Error(`DSH 会话 ${sessionId} 正在生成，不能切换预设。`)
        const current = await registerPreset(requested)
        try {
          await ctx.agentPresets.recompose(agent.ctx, requested)
          agent.session.append('agent-preset/selected', { agentPreset: requested })
        } catch (error) {
          throw error
        }
        commitSessionPreset(snapshotRoot, sessionId, requested, current.revision)
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
    await registrationQueue
    await activeRegistration?.dispose()
    await Promise.allSettled([...legacyRegistrations.values()].map(async task => {
      const legacy = await task
      await legacy.dispose()
    }))
  }
}

function presetRevision(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function legacyAliasDefinition(presetRoot, id, templatePath) {
  const activePath = join(presetRoot, ACTIVE_RUNTIME_PRESET_ID, 'preset.json')
  const active = readRuntimePresetDefinition(activePath, ACTIVE_RUNTIME_PRESET_ID, templatePath)
  return { ...active, id }
}

function storedPresetForInspection(inspection) {
  let selected = typeof inspection?.meta?.agentPreset === 'string'
    ? inspection.meta.agentPreset
    : undefined
  for (const event of inspection?.events ?? []) {
    if (event?.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string') {
      selected = event.data.agentPreset
    }
  }
  return selected
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
