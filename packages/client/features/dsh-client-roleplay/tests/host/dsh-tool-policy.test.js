import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { applyDisabledPolicy } from '../../src/host/tool-policy.mjs'
import { classify, filterDeclarations } from '../../../../../../apps/desktop/resources/dsh/tool-policy.mjs'

describe('DSH character tool policy', () => {
  it('classifies the current desktop tool groups and keeps internal probes', () => {
    expect(classify({ type: 'function', function: { name: 'eleckoi_read_variables' } })).toBe('builtin:variables')
    expect(classify({ type: 'function', function: { name: 'pwsh' } })).toBe('builtin:workspace')
    expect(classify({ type: 'function', function: { name: 'skill' } })).toBe('builtin:workflow')
    expect(classify({ type: 'function', function: { name: 'workflow' } })).toBe('builtin:workflow')
    expect(classify({ type: 'function', function: { name: 'subagent_fork' } })).toBe('builtin:collaboration')
    expect(classify({ type: 'function', function: { name: 'send_message' } })).toBe('builtin:collaboration')
    expect(classify({ type: 'namespace', name: 'collaboration', tools: [] })).toBe('builtin:collaboration')
    expect(classify({ type: 'web_search' })).toBe('builtin:web')
    expect(classify({ type: 'function', function: { name: 'spawn_agent' } })).toBeUndefined()
    expect(classify({ type: 'function', function: { name: 'update_plan' } })).toBeUndefined()
    expect(classify({ type: 'function', function: { name: 'future_tool' } })).toBeUndefined()

    expect(filterDeclarations([
      { type: 'function', function: { name: 'eleckoi_read_variables' } },
      { type: 'function', function: { name: 'eleckoi_read_setting_files' } },
      { type: 'function', function: { name: 'future_tool' } },
      { type: 'function', function: { name: 'eleckoi_read_uploaded_file' } },
      { type: 'function', function: { name: 'eleckoi_internal_probe' } }
    ], new Set(['builtin:variables', 'builtin:other']))).toEqual([
      { type: 'function', function: { name: 'eleckoi_read_setting_files' } },
      { type: 'function', function: { name: 'future_tool' } },
      { type: 'function', function: { name: 'eleckoi_read_uploaded_file' } },
      { type: 'function', function: { name: 'eleckoi_internal_probe' } }
    ])
  })

  it('keeps plugin tools callable with saved preset policies and follows plugin unload', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.inject(['tools'], async owner => {
        const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
        const plugin = await owner.plugin({ inject: ['tools'], apply(pluginCtx) {
          for (const name of ['generate_image', 'generate_images', 'edit_image', 'synthetic_extension_tool']) {
            pluginCtx.tools.register(defineTool({ name, description: 'Synthetic plugin tool', parameters: {}, output,
              execute: () => 'synthetic plugin result' }))
          }
        } })
        owner.tools.register(defineTool({ name: 'read', description: 'Synthetic workspace tool', parameters: {}, output,
          execute: () => 'synthetic workspace result' }))
        const agent = { id: 'synthetic-plugin-policy-session' }
        const scope = createScope(owner, agent)
        agent.ctx = scope.ctx
        try {
          applyDisabledPolicy(agent.ctx, ['builtin:other', 'builtin:remote-dsh', 'builtin:workspace'])
          expect(owner.tools.schemas(agent).map(tool => tool.name)).toEqual([
            'generate_image', 'generate_images', 'edit_image', 'synthetic_extension_tool'
          ])
          const result = await owner.tools.execute({ agent, callId: 'synthetic-plugin-call', name: 'generate_image',
            arguments: {}, signal: new AbortController().signal })
          expect(result.isError).toBe(false)
          expect(result.content).toEqual([{ type: 'text', text: 'synthetic plugin result' }])
          const blocked = await owner.tools.execute({ agent, callId: 'synthetic-workspace-call', name: 'read',
            arguments: {}, signal: new AbortController().signal })
          expect(blocked.isError).toBe(true)
          await plugin.dispose()
          expect(owner.tools.schemas(agent)).toEqual([])
          applyDisabledPolicy(agent.ctx, [])
          expect(owner.tools.schemas(agent).map(tool => tool.name)).toEqual(['read'])
        } finally { await scope.dispose() }
      })
    } finally { await ctx.fiber.dispose() }
  })
})
