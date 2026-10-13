import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import { childHostFailureOf, childHostFatalFrame, isChildMessage } from '@eleckoi/desktop-host'

// 边界④ 在③ 边界上的落点：插件失败（以及任何子进程启动失败）折成同一个可记录对象，
// 并把码放进 EH-6 定下的 `fatal.code`——没有新协议字段、没有第二套失败类型。
// 用例不起真子进程（入口 import 时就会跑 main()），只喂纯函数；「生产侧真的用了它」用覆盖代理证。

describe('子进程失败在③边界上的落点', () => {
  it('带契约码的失败：码与详情不被折掉，帧里带上码', () => {
    const failure = childHostFailureOf(
      new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, '写不进去', { operation: 'write' })
    )

    expect(failure).toEqual({
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '写不进去',
      details: { operation: 'write' }
    })
    expect(childHostFatalFrame(failure, 'at roleplay-plan-tool.mjs:7:3')).toEqual({
      type: 'fatal',
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '写不进去',
      stack: 'at roleplay-plan-tool.mjs:7:3'
    })
  })

  it('未知插件失败折兜底码，帧里仍有码与开发者诊断', () => {
    const failure = childHostFailureOf(new Error('插件宿主起不来'))

    expect(failure).toEqual({
      code: ELECKOI_FAILURE_CODES.internal,
      message: '插件宿主起不来',
      details: {}
    })
    expect(childHostFatalFrame(failure, undefined)).toEqual({
      type: 'fatal',
      code: ELECKOI_FAILURE_CODES.internal,
      message: '插件宿主起不来'
    })
  })

  it('产出的帧过得了消费侧的白名单（与 EH-6 的 isChildMessage 协同）', () => {
    expect(isChildMessage(childHostFatalFrame(childHostFailureOf(new Error('炸了')), 'at a:1:1'))).toBe(true)
  })

  // 覆盖代理，不是行为判据（理由同 EH-6 的 ready 帧那条）。
  it('子进程入口用同一个构造函数发 fatal 帧（覆盖代理）', () => {
    const source = readFileSync('apps/desktop-host/src/desktopPluginHostChild.ts', 'utf8')
    expect(source).toContain('childHostFatalFrame(')
  })
})
