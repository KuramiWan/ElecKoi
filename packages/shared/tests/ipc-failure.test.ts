/**
 * 边界⑤（主进程 ↔ 渲染层）的失败形状。
 *
 * 断言的是「失败能不能活着过这条边界」：必须是可结构化克隆的普通对象、必须带得住码与详情，
 * 而且不能靠 `instanceof` 认（跨 world 复制之后原型链没了）。
 */
import { describe, expect, it } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '../src/contracts/errors/codes'
import { DesktopError } from '../src/foundation/DesktopError'
import { foldFailure } from '../src/foundation/failure'
import {
  desktopHostFailureNoticeOf,
  desktopIpcFailureOf,
  hasDesktopIpcFailureMarker
} from '../src/foundation/ipcFailure'

describe('desktopIpcFailureOf', () => {
  it('契约失败折成带标记的普通对象，码与详情都在', () => {
    const failure = desktopIpcFailureOf(new DesktopError(
      ELECKOI_FAILURE_CODES.agentPresetNotFound,
      '找不到这个预设。',
      { what: '预设 preset-1' }
    ))
    expect(failure.isDSHRemoteError).toBe(true)
    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.agentPresetNotFound)
    expect(failure.message).toBe('找不到这个预设。')
    expect(failure.details).toEqual({ what: '预设 preset-1' })
  })

  it('未知失败折兜底，不猜语义', () => {
    expect(desktopIpcFailureOf(new Error('炸了')).code).toBe(ELECKOI_FAILURE_CODES.internal)
    expect(desktopIpcFailureOf(undefined).code).toBe(ELECKOI_FAILURE_CODES.internal)
  })

  it('产出的是可结构化克隆的普通对象（不能是类实例）', () => {
    const failure = desktopIpcFailureOf(new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, '写不进去'))
    expect(failure).not.toBeInstanceOf(DesktopError)
    expect(Object.getPrototypeOf(failure)).toBe(Object.prototype)
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure)
  })
})

describe('hasDesktopIpcFailureMarker', () => {
  it('只认标记，不校验码（码不认识也必须算失败，不能变成静默成功）', () => {
    expect(hasDesktopIpcFailureMarker({ isDSHRemoteError: true, code: 'eleckoi/未来才有的码' })).toBe(true)
    expect(hasDesktopIpcFailureMarker({ isDSHRemoteError: true, code: 'whatever' })).toBe(true)
  })

  it('成功载荷没有标记', () => {
    for (const value of [null, undefined, 0, '', 'text', [], {}, { isDSHRemoteError: false }, { ok: true }]) {
      expect(hasDesktopIpcFailureMarker(value), String(value)).toBe(false)
    }
  })
})

describe('desktopHostFailureNoticeOf', () => {
  it('搬码与详情，不折码、不拼句子', () => {
    const notice = desktopHostFailureNoticeOf({
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '子进程写日志失败',
      details: { operation: 'write' }
    })
    expect(notice).toEqual({
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '子进程写日志失败',
      details: { operation: 'write' }
    })
  })

  it('拿不到诊断指针时整个属性不出现（undefined 过不了结构化克隆）', () => {
    const notice = desktopHostFailureNoticeOf({
      code: ELECKOI_FAILURE_CODES.internal,
      message: '不知道怎么了',
      details: {},
      stack: undefined,
      logPath: undefined
    })
    expect('stack' in notice).toBe(false)
    expect('logPath' in notice).toBe(false)
    expect(Object.values(notice).every((value) => value !== undefined)).toBe(true)
  })

  it('有指针时带上', () => {
    const notice = desktopHostFailureNoticeOf({
      code: ELECKOI_FAILURE_CODES.internal,
      message: '崩了',
      details: {},
      stack: 'at foo',
      logPath: '/tmp/log'
    })
    expect(notice.stack).toBe('at foo')
    expect(notice.logPath).toBe('/tmp/log')
  })
})

describe('边界⑤ 的完整一跳：折叠 → 线上载荷 → 再折叠', () => {
  it('契约失败过一遍线上形状后码与详情不变（JSON 往返）', () => {
    const notice = desktopHostFailureNoticeOf({
      code: ELECKOI_FAILURE_CODES.pluginLoadFailed,
      message: 'DSH 插件宿主进程意外退出',
      details: { what: 'DSH 插件宿主进程' },
      stack: 'at boot'
    })
    const wire = JSON.parse(JSON.stringify(notice)) as typeof notice
    const folded = foldFailure(wire)
    expect(folded.code).toBe(ELECKOI_FAILURE_CODES.pluginLoadFailed)
    expect(folded.details).toEqual({ what: 'DSH 插件宿主进程' })
    expect(hasDesktopIpcFailureMarker(wire)).toBe(true)
  })
})
