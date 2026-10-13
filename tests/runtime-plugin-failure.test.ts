import { afterEach, describe, expect, it, vi } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
// @ts-expect-error 运行时插件为无声明文件的 JavaScript 入口。
import { runRuntimePluginApply } from '../apps/desktop/resources/dsh/runtime-plugin-failure.mjs'
// @ts-expect-error 运行时插件为无声明文件的 JavaScript 入口。
import { apply as applyRoleplayPlanTool } from '../apps/desktop/resources/dsh/roleplay-plan-tool.mjs'

function captureThrow(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('期望这里抛出')
}

describe('边界④：运行时插件的失败出口', () => {
  const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  afterEach(() => {
    diagnostics.mockClear()
  })

  it('apply 抛出时产出的可记录对象带兜底码，并且进了诊断出口', () => {
    const thrown = captureThrow(() => runRuntimePluginApply('uploaded-file-tools', () => {
      throw new Error('工具注册失败')
    }))

    // 跨包副本不保证类身份唯一，所以按形状断言（同 `foldFailure` 的理由）。
    expect(thrown).toMatchObject({
      name: 'DesktopError',
      code: ELECKOI_FAILURE_CODES.internal,
      message: '工具注册失败',
      details: {}
    })

    const line = String(diagnostics.mock.calls[0]?.[0] ?? '')
    expect(line).toContain('eleckoi/runtime-plugin-failure')
    expect(line).toContain('uploaded-file-tools')
    expect(line).toContain(ELECKOI_FAILURE_CODES.internal)
    expect(line).toContain('工具注册失败')
  })

  it('插件抛出已带契约码的失败时，码与详情不被折掉', () => {
    const thrown = captureThrow(() => runRuntimePluginApply('variable-tools', () => {
      throw new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, '写不进去', { operation: 'write' })
    }))

    expect(thrown).toMatchObject({
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '写不进去',
      details: { operation: 'write' }
    })
  })

  it('同步返回的 disposer 原样透传，异步拒绝同样收口', async () => {
    const disposer = () => undefined
    expect(runRuntimePluginApply('setting-library-tools', () => disposer)).toBe(disposer)

    await expect(runRuntimePluginApply('setting-library-tools', async () => {
      throw new Error('异步注册失败')
    })).rejects.toMatchObject({ code: ELECKOI_FAILURE_CODES.internal, message: '异步注册失败' })
  })

  it('overlay 插件的 apply 已经接上出口（注册失败带码抛出）', () => {
    const ctx = {
      tools: {
        register() {
          throw new Error('tools 服务没接上')
        }
      }
    }

    const thrown = captureThrow(() => applyRoleplayPlanTool(ctx))

    expect(thrown).toMatchObject({ code: ELECKOI_FAILURE_CODES.internal, message: 'tools 服务没接上' })
    expect(String(diagnostics.mock.calls[0]?.[0] ?? '')).toContain('roleplay-plan-tool')
  })
})
