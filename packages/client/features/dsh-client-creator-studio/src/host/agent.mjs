import { defineTool } from '@deepseek-ai/dsh-tools'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import { creatorCapabilities, creatorToolsets, creatorAuthoringInstructions } from '@eleckoi/dsh-product-data'
import { applyDisabledPolicy, extendNativeRequestInput, requestProjectionSnapshot, sessionInstructions } from '@eleckoi/dsh-client-roleplay'
import { creatorStudioProjection } from './projection.mjs'

export const name = 'eleckoi-creator-studio-agent'
export const inject = ['agents', 'tools', 'llm', 'sessionProjections', 'eleckoiProductData', 'eleckoiCharacterConfigurationChanges', 'eleckoiProductRecordChanges']

export function apply(ctx, config) {
  if (typeof config?.presetId !== 'string' || typeof config?.creatorTools !== 'boolean') throw new Error('AI 创作工作室的预设配置不正确。')
  const ownerScope = scopeOf(ctx)
  if (ownerScope === undefined) throw new Error('AI 创作工作室插件必须挂载在正式预设或 Agent 作用域中。')
  const owns = agent => agent && scopeChainOf(scopeOf(agent.ctx)).includes(ownerScope)
  const readState = agent => {
    if (!owns(agent)) throw new Error('该会话不属于当前 AI 创作工作室作用域。')
    const state = ctx.sessionProjections.stateOf(agent.session, creatorStudioProjection.key)
    if (!state || state.presetId !== config.presetId) throw new Error('AI 创作工作室会话缺少正式预设绑定。')
    return state
  }
  const capabilities = creatorCapabilities(ctx.eleckoiProductData)
  const toolsets = creatorToolsets
  const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
  const requireToolset = id => {
    const toolset = toolsets.find(item => item.id === id)
    if (!toolset) throw new Error(`未知创作能力组：${id}`)
    return toolset
  }
  const disposers = []
  const projected = new WeakSet()
  if (config.creatorTools) {
    disposers.push(ctx.tools.register(defineTool({ name: 'eleckoi_list_toolsets', description: '列出 AI 创作工作室可用的能力组。', parameters: {}, output,
      execute: () => ({ toolsets: toolsets.map(({ id, title, description }) => ({ id, title, description, operationCount: capabilities.filter(operation => operation.toolsetId === id).length })) }) })))
    disposers.push(ctx.tools.register(defineTool({ name: 'eleckoi_describe_toolset', description: '查看能力组的操作；指定 operation_ids 并启用 include_schema 可读取这些操作的准确参数。',
      parameters: { toolset_id: { type: 'string', required: true }, operation_ids: { type: 'array', items: { type: 'string' } }, include_schema: { type: 'boolean' } }, output,
      execute(args) {
        const toolset = requireToolset(args.toolset_id)
        const selected = new Set(args.operation_ids ?? [])
        if (args.include_schema && !selected.size) throw new Error('展开参数时必须指定 operation_ids。')
        const operations = capabilities.filter(item => item.toolsetId === toolset.id && (!selected.size || selected.has(item.id)))
        if (selected.size && operations.length !== selected.size) throw new Error('所选操作不属于这个能力组。')
        return { toolset, operations: operations.map(({ execute, inputSchema, ...item }) => ({ ...item, ...(args.include_schema ? { inputSchema } : {}) })) }
      } })))
    disposers.push(ctx.tools.register(defineTool({ name: 'eleckoi_call_capability', description: '执行已发现的创作操作，直接修改当前选定角色的正式资料。参数必须符合已查询的输入结构。',
      parameters: { capability_id: { type: 'string', required: true }, arguments: { type: 'object', additionalProperties: true, required: true } }, output,
      execute(args, exec) {
        exec.signal.throwIfAborted()
        if (!exec.agent) throw new Error('创作操作缺少调用会话。')
        const state = readState(exec.agent)
        if (!state?.characterId) throw new Error('请先在 AI 创作工作室菜单中选择角色。')
        const operation = capabilities.find(item => item.id === args.capability_id)
        if (!operation) throw new Error(`未知创作操作：${args.capability_id}`)
        const value = operation.execute(state.characterId, args.arguments)
        if (operation.effect === 'write') {
          ctx.eleckoiCharacterConfigurationChanges.publish({ kind: 'snapshot' })
          ctx.eleckoiProductRecordChanges.publish({ kind: 'records', domain: 'characters', ids: [state.characterId] })
        }
        return { value }
      } })))
  }
  disposers.push(ctx.on('agent/created', ({ agent }) => {
    if (!owns(agent)) return
    const preset = ctx.eleckoiProductData.readAgentPreset(config.presetId)
    applyDisabledPolicy(agent.ctx, preset.toolGroups.filter(group => !group.included || !group.enabled).map(group => group.id))
  }))
  disposers.push(ctx.on('llm/stream', (options, next) => {
    if (!isAgentLoopRequest(options) || projected.has(options)) return next()
    const agent = ctx.agents.get(options.sessionId)
    if (!owns(agent)) return next()
    const state = readState(agent)
    const { settingLibrary } = ctx.eleckoiProductData.creatorPresetRuntime(config.presetId)
    const context = { settingLibrary }
    const target = state.characterId ? ctx.eleckoiProductData.readCharacters().items.find(item => item.id === state.characterId) : undefined
    if (state.characterId && !target) throw new Error('所选角色已不存在，请重新选择角色。')
    const instructions = [sessionInstructions({ conversationContext: context }), config.creatorTools ? creatorAuthoringInstructions : '', `当前编辑目标：${target ? JSON.stringify({ id: target.id, name: target.name }) : '未选择角色。需要修改资料时请用户从菜单选择角色。'}`].filter(Boolean).join('\n\n')
    const messages = extendNativeRequestInput(options.messages, requestProjectionSnapshot(context).plan, instructions)
    const request = { ...options, messages }
    projected.add(request)
    return ctx.llm.stream(request)
  }))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
