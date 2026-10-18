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
  hasDesktopIpcFailureMarker,
  throwIfDesktopIpcFailure,
  unwrapDesktopIpcResult,
  wrapDesktopIpcHandler
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

describe('wrapDesktopIpcHandler', () => {
  it('handler 成功 → 载荷原样返回，没有被包装成失败', async () => {
    const wrapped = wrapDesktopIpcHandler((_event: unknown, value: unknown) => value)
    const payload = { ok: true, items: [1, 2] }
    await expect(wrapped(undefined, payload)).resolves.toBe(payload)
    expect(hasDesktopIpcFailureMarker(await wrapped(undefined, payload))).toBe(false)
    await expect(wrapped(undefined, 'text')).resolves.toBe('text')
  })

  it('async handler 成功 → 载荷也原样返回（更新的四个通道就是 async）', async () => {
    const wrapped = wrapDesktopIpcHandler(async () => ({ phase: 'idle' }))
    await expect(wrapped(undefined)).resolves.toEqual({ phase: 'idle' })
    expect(hasDesktopIpcFailureMarker(await wrapped(undefined))).toBe(false)
  })

  it('handler 抛 DesktopError → 返回带标记的对象，同一条码与 details', async () => {
    const wrapped = wrapDesktopIpcHandler(() => {
      throw new DesktopError(
        ELECKOI_FAILURE_CODES.agentPresetNotFound,
        '找不到这个预设：preset-1',
        { what: '预设' }
      )
    })
    const failure = await wrapped(undefined)
    expect(hasDesktopIpcFailureMarker(failure)).toBe(true)
    expect(failure).toMatchObject({
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.agentPresetNotFound,
      message: '找不到这个预设：preset-1',
      details: { what: '预设' }
    })
    // 渲染层那个唯一解析点认得出这条码（不是兜底）。
    expect(foldFailure(failure).code).toBe(ELECKOI_FAILURE_CODES.agentPresetNotFound)
  })

  it('handler 抛裸 Error → 折成兜底码，message 不丢', async () => {
    const wrapped = wrapDesktopIpcHandler(() => {
      throw new Error('桌面窗口操作不受支持。')
    })
    expect(await wrapped(undefined)).toMatchObject({
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.internal,
      message: '桌面窗口操作不受支持。',
      details: {}
    })
  })

  it('async handler 的拒绝同样折成线上对象（不是以 Error 跨进程）', async () => {
    const wrapped = wrapDesktopIpcHandler(async () => {
      throw new DesktopError(
        ELECKOI_FAILURE_CODES.netOperationFailed,
        '检查更新失败：网络不可用',
        { operation: 'check', what: '更新' }
      )
    })
    const failure = await wrapped(undefined)
    expect(failure).toMatchObject({
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.netOperationFailed,
      details: { operation: 'check', what: '更新' }
    })
  })

  it('失败对象过 JSON 往返后形状不变（结构化克隆的判据）', async () => {
    const wrapped = wrapDesktopIpcHandler(() => {
      throw new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, '写不进去：/tmp/x', { operation: 'write', path: '/tmp/x' })
    })
    const failure = await wrapped(undefined)
    expect(Object.getPrototypeOf(failure)).toBe(Object.prototype)
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure)
    expect(foldFailure(JSON.parse(JSON.stringify(failure))).code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
  })
})

describe('throwIfDesktopIpcFailure', () => {
  it('带标记的对象被原样抛出去（渲染层拿到的就是它，能 foldFailure）', () => {
    const failure = desktopIpcFailureOf(new DesktopError(
      ELECKOI_FAILURE_CODES.agentPresetNotFound,
      '找不到这个预设。',
      { what: '预设' }
    ))
    let thrown: unknown
    try {
      throwIfDesktopIpcFailure(failure)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(failure)
    expect(foldFailure(thrown).code).toBe(ELECKOI_FAILURE_CODES.agentPresetNotFound)
  })

  it('普通载荷什么也不做（不把成功当失败）', () => {
    for (const value of [null, undefined, 0, '', 'text', [], {}, { isDSHRemoteError: false }, { ok: true }]) {
      expect(() => throwIfDesktopIpcFailure(value), String(value)).not.toThrow()
    }
  })
})

describe('unwrapDesktopIpcResult', () => {
  it('拿到带标记的对象 → 拒绝它本身（码与详情随拒绝原因到渲染层）', async () => {
    const failure = desktopIpcFailureOf(new DesktopError(
      ELECKOI_FAILURE_CODES.securityDenied,
      '拒绝打开这个工作区。',
      { what: '工作区' }
    ))
    await expect(unwrapDesktopIpcResult(async () => failure)).rejects.toBe(failure)
  })

  it('拿到普通载荷 → 原样返回', async () => {
    const payload = { phase: 'idle' }
    await expect(unwrapDesktopIpcResult(async () => payload)).resolves.toBe(payload)
  })
})
