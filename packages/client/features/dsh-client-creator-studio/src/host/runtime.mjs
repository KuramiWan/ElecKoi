import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { materializeAgentPreset, readRuntimePresetDefinition, currentRequestSnapshot } from '@eleckoi/dsh-client-roleplay'
import { requireSessionMessage, sessionMessageText, sessionMessageTurn } from '@eleckoi/dsh-product-api'
import { CREATOR_STUDIO_EVENT, creatorStudioProjection, creatorStudioStateSchema } from './projection.mjs'

/** Studio commands create ordinary DSH Sessions; the official Controller owns their Agent handles. */
export async function installCreatorStudioRuntime(ctx) {
  const template = process.env.ELECKOI_PRESET_TEMPLATE_PATH, presets = process.env.ELECKOI_PRESET_ROOT
  const cwd = process.env.ELECKOI_WORKSPACE_ROOT
  if (!template || !presets || !cwd) throw new Error('AI 创作工作室缺少 Host 运行目录。')
  const root = join(presets, 'creator-studio')
  mkdirSync(root, { recursive: true })
  const registrations = new Map()
  const register = id => {
    if (registrations.has(id)) return registrations.get(id)
    const job = ctx.agentPresets.register(readRuntimePresetDefinition(join(root, id, 'preset.json'), id, template, ['uploaded-file-tools']))
      .catch(error => { registrations.delete(id); throw error })
    registrations.set(id, job)
    return job
  }
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    if (directory.isDirectory()) await register(directory.name)
  }
  const requireCharacter = characterId => {
    if (characterId && !ctx.eleckoiProductData.readCharacters().items.some(item => item.id === characterId)) throw new Error('找不到所选角色。')
  }
  const readState = async sessionId => {
    const inspection = await ctx.sessionController.inspect(sessionId)
    const event = inspection.events.findLast(item => item.type === CREATOR_STUDIO_EVENT)
    if (!event) throw new Error('这不是 AI 创作工作室会话。')
    return { inspection, state: creatorStudioStateSchema.parse(event.data) }
  }
  const reopenAfterMessageEdit = async (sessionId, inspection, state) => {
    await ctx.sessionController.create({ sessionId, cwd: inspection.meta.cwd, agentPreset: inspection.meta.agentPreset })
    const agent = ctx.agents.get(sessionId)
    if (!agent) throw new Error('AI 创作工作室 Agent 未完成恢复。')
    const events = agent.session.snapshotEvents()
    const current = events.findLast(event => event.type === CREATOR_STUDIO_EVENT)?.data
    if (current?.presetId !== state.presetId || current?.characterId !== state.characterId) {
      agent.session.append(CREATOR_STUDIO_EVENT, state, { ignorable: true })
    }
    const title = inspection.events.findLast(event => event.type === 'session/title')?.data
    const currentTitle = events.findLast(event => event.type === 'session/title')?.data
    if (title?.source.kind === 'user' && (currentTitle?.source.kind !== 'user' || currentTitle.title !== title.title)) {
      await ctx.sessionController.rename({ sessionId, title: title.title })
    }
    const selection = inspection.events.findLast(event => event.type === 'model/selection')?.data
    const currentSelection = events.findLast(event => event.type === 'model/selection')?.data
    if (selection && JSON.stringify(selection) !== JSON.stringify(currentSelection)) {
      await ctx.sessionController.selectModel({ sessionId, ...selection })
    }
  }
  const service = {
    async list() {
      const { items } = await ctx.sessionController.list({})
      return items.flatMap(item => {
        const state = item.projections?.values?.[creatorStudioProjection.key]
        if (!state) return []
        const pinIndex = ctx.workspaceRegistry.pinnedSessionIds.indexOf(item.sessionId)
        return [{ sessionId: String(item.sessionId), title: item.projections?.values?.title ?? '新对话', updatedAt: item.updatedAt, pinned: pinIndex >= 0, pinIndex, ...creatorStudioStateSchema.parse(state) }]
      })
    },
    async create(characterId = '') {
      requireCharacter(characterId)
      const catalog = ctx.eleckoiProductData.readAgentPresetCatalog()
      const preset = ctx.eleckoiProductData.readAgentPreset(catalog.activePresetIds.creator)
      if (preset.purpose !== 'creator') throw new Error('当前全局预设不是创作预设。')
      const disabledGroupIds = preset.toolGroups.filter(group => !group.included || !group.enabled).map(group => group.id)
      for (const groupId of ['builtin:variables', 'builtin:setting-library', 'builtin:roleplay-workflow', 'builtin:auto-illustration']) {
        if (!disabledGroupIds.includes(groupId)) throw new Error('创作预设中的角色对话工具不适用于 AI 创作工作室，请使用创作能力。')
      }
      const model = await currentRequestSnapshot(ctx)
      const revision = createHash('sha256').update(JSON.stringify({ preset, model })).digest('hex')
      const id = `eleckoi-creator-${revision}`
      materializeAgentPreset(root, template, { ...preset, versionId: preset.activeVersionId }, { disabledGroupIds }, model,
        { id, plugins: [{ id: 'creator-studio-agent', name: '@eleckoi/dsh-client-creator-studio/agent',
          config: { presetId: preset.id, creatorTools: !disabledGroupIds.includes('builtin:creator') } }] })
      await register(id)
      const { sessionId } = await ctx.sessionController.create({ sessionId: `session-${randomUUID()}`, cwd, agentPreset: id })
      const agent = ctx.agents.get(sessionId)
      if (!agent) throw new Error('AI 创作工作室 Agent 未完成创建。')
      agent.session.append(CREATOR_STUDIO_EVENT, { presetId: preset.id, characterId }, { ignorable: true })
      return { sessionId: String(sessionId), presetId: preset.id, characterId }
    },
    async open(sessionId) {
      const { inspection, state } = await readState(sessionId)
      requireCharacter(state.characterId)
      await ctx.sessionController.create({ sessionId, cwd: inspection.meta.cwd, agentPreset: inspection.meta.agentPreset })
      return { sessionId, ...state }
    },
    async rename(sessionId, title) {
      await readState(sessionId)
      await ctx.sessionController.rename({ sessionId, title })
    },
    async pin(sessionId, pinned) {
      await readState(sessionId)
      if (pinned) await ctx.workspaceRegistry.pinSession(sessionId)
      else await ctx.workspaceRegistry.unpinSession(sessionId)
    },
    async delete(sessionId) {
      await readState(sessionId)
      await ctx.eleckoiSessionEditor.deleteSession(sessionId)
      await ctx.workspaceRegistry.unpinSession(sessionId)
    },
    async messages(sessionId) {
      const { inspection } = await readState(sessionId)
      return inspection.events.flatMap((event, index) => {
        if (event.surfaceOp !== 'append') return []
        if (event.type !== 'assistant/message' && !(event.type === 'user/message' && event.data.source?.kind === 'user')) return []
        const text = sessionMessageText(event)
        if (!text.trim()) return []
        return [{ eventSeq: event.seq, role: event.type === 'user/message' ? 'user' : 'assistant', text, turn: sessionMessageTurn(inspection.events, index) }]
      })
    },
    async deleteMessagesFrom(sessionId, eventSeq, role) {
      const { inspection, state } = await readState(sessionId)
      const target = requireSessionMessage(inspection, eventSeq, role)
      const turn = sessionMessageTurn(inspection.events, target.index)
      if (ctx.agents.get(sessionId)?.status === 'running') throw new Error('请先停止生成再删除消息。')
      await ctx.eleckoiSessionEditor.transaction(sessionId, async () => {
        const changed = await ctx.eleckoiSessionEditor.rewind(sessionId, turn, eventSeq, false)
        if (changed === undefined) throw new Error('当前消息不能安全删除。')
        await reopenAfterMessageEdit(sessionId, inspection, state)
      })
    },
    async regenerate(sessionId) {
      const { inspection, state } = await readState(sessionId)
      const input = inspection.events.findLast(event => event.type === 'user/message' && event.surfaceOp === 'append' && event.data.source?.kind === 'user')
      if (!input) throw new Error('没有可以重新生成的用户输入。')
      if (ctx.agents.get(sessionId)?.status === 'running') throw new Error('请先停止生成再重新生成。')
      const target = requireSessionMessage(inspection, input.seq, 'user')
      const turn = sessionMessageTurn(inspection.events, target.index)
      await ctx.eleckoiSessionEditor.transaction(sessionId, async () => {
        const changed = await ctx.eleckoiSessionEditor.rewind(sessionId, turn, input.seq, false)
        if (changed === undefined) throw new Error('当前消息不能安全重新生成。')
        await reopenAfterMessageEdit(sessionId, inspection, state)
        const resolved = await ctx.sessionController.resolveAgent(sessionId)
        if ('error' in resolved) throw resolved.error
        resolved.agent.followup(input.data)
      })
    },
    async selectCharacter(sessionId, characterId) {
      requireCharacter(characterId)
      const opened = await service.open(sessionId)
      const agent = ctx.agents.get(sessionId)
      if (!agent || agent.status !== 'idle') throw new Error('正在生成，请先停止或等待完成后再选择角色。')
      const state = { presetId: opened.presetId, characterId }
      agent.session.append(CREATOR_STUDIO_EVENT, state, { ignorable: true })
      return { sessionId, ...state }
    }
  }
  ctx.provide('eleckoiCreatorStudioRuntime', service)
  return async () => {
    for (const registration of registrations.values()) { const dispose = await registration; await dispose() }
    registrations.clear()
  }
}
