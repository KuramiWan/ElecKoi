import { defineTool } from '@deepseek-ai/dsh-tools'
import { runRuntimePluginApply } from './runtime-plugin-failure.mjs'
const validStatuses = new Set(['pending', 'inProgress', 'completed'])

export const name = 'eleckoi-roleplay-plan-tool'
export const inject = ['tools']

// 边界④ 的出口：`apply()` 抛出（含工具注册失败）时先产出带码的可记录对象并写诊断出口。
export function apply(ctx, config = {}) {
  return runRuntimePluginApply('roleplay-plan-tool', () => applyRoleplayPlanTool(ctx, config))
}

function applyRoleplayPlanTool(ctx, config = {}) {
  const steps = Array.isArray(config.steps)
    ? config.steps.map((step) => String(step).trim()).filter(Boolean).slice(0, 20)
    : []
  return ctx.tools.register(defineTool({
    name: 'update_roleplay_plan',
    description: steps.length ? [
      '更新本轮角色扮演计划。必须复述完整任务列表并填写状态；任务文字和顺序由作者固定。',
      ...steps.map((step, index) => `${index + 1}. ${step}`),
      '最后一项由应用在检测到 FINAL 正文后完成，模型不要主动将其标记为 completed。'
    ].join('\n') : '读取当前空的角色扮演计划。',
    parameters: {
      explanation: { type: 'string', description: '可选的简短进度说明。' },
      plan: {
        type: 'array',
        required: true,
        description: '完整角色扮演计划；每次调用会替换上一份状态。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: { type: 'string', required: true },
            status: { type: 'string', enum: ['pending', 'inProgress', 'completed'], required: true }
          }
        }
      }
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
    async execute(args) {
      if (!steps.length) return { status: 'ok', plan: [] }
      return canonicalizePlan(args, steps)
    }
  }))
}

function canonicalizePlan(args, steps) {
  const submitted = Array.isArray(args.plan) ? args.plan : []
  const statuses = steps.map((_step, index) => {
    const status = submitted[index]?.status
    return validStatuses.has(status) ? status : 'pending'
  })
  const precedingTasksCompleted = statuses.slice(0, -1).every((status) => status === 'completed')
  const last = statuses.length - 1
  statuses[last] = precedingTasksCompleted
    ? 'inProgress'
    : statuses[last] === 'completed' ? 'pending' : statuses[last]
  const counts = Object.fromEntries([...validStatuses].map((status) => [status, statuses.filter((item) => item === status).length]))
  return {
    status: 'ok',
    message: precedingTasksCompleted
      ? '现在只剩最终输出项。直接输出 <FINAL> 正文，不要再次调用 update_roleplay_plan；应用检测到正文后会自动完成最终项。'
      : `角色扮演计划已更新：${counts.completed} 已完成，${counts.inProgress} 进行中，${counts.pending} 待处理。最终输出项由应用在检测到 <FINAL> 正文后自动完成。`,
    ...(typeof args.explanation === 'string' && args.explanation.trim() ? { explanation: args.explanation.trim() } : {}),
    plan: steps.map((step, index) => ({ step, status: statuses[index] }))
  }
}
