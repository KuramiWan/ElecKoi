/**
 * 边界③ 的折帧与帧校验。
 *
 * 两件事要守住：**带码的帧不被改写**、**认不出的码不猜语义但也不丢**。
 * 另外这条边界的产物要能继续走边界⑤（结构化克隆 + IPC 通知），所以顺带断言它可 JSON 往返。
 */
import { describe, expect, it } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { foldFailure } from '@shared/foundation/failure'
import { isChildFatalFrame, pluginHostFailureOf } from '../src/childHostFailure'

describe('isChildFatalFrame', () => {
  it('最小合法帧只有 type 与 message', () => {
    expect(isChildFatalFrame({ type: 'fatal', message: '炸了' })).toBe(true)
  })

  it('带码、详情、栈也是合法帧', () => {
    expect(isChildFatalFrame({
      type: 'fatal',
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '写不进去',
      details: { operation: 'write', path: '/tmp/x' },
      stack: 'at foo'
    })).toBe(true)
  })

  it('帧上的未知字段（含 logPath）按可选字段忽略', () => {
    // logPath 不是帧字段：宿主收到 fatal 帧后自己记录本机日志路径（见 hostSessionProtocol.ts）。
    expect(isChildFatalFrame({ type: 'fatal', message: 'x', logPath: [] })).toBe(true)
  })

  it('形状不对的一律不认', () => {
    const bad = [
      null,
      undefined,
      'fatal',
      [],
      { type: 'ready', message: 'x' },
      { type: 'fatal' },
      { type: 'fatal', message: 42 },
      { type: 'fatal', message: 'x', code: 7 },
      { type: 'fatal', message: 'x', stack: {} },
      { type: 'fatal', message: 'x', details: [1, 2] },
      { type: 'fatal', message: 'x', details: 'text' }
    ]
    for (const value of bad) expect(isChildFatalFrame(value), JSON.stringify(value)).toBe(false)
  })
})

describe('pluginHostFailureOf', () => {
  it('契约码与详情原样搬过来，子进程栈也带上', () => {
    const failure = pluginHostFailureOf({
      type: 'fatal',
      code: ELECKOI_FAILURE_CODES.pluginLoadFailed,
      message: '插件宿主启动失败',
      details: { what: 'DSH 插件宿主进程' },
      stack: 'at boot'
    })
    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.pluginLoadFailed)
    expect(failure.message).toBe('插件宿主启动失败')
    expect(failure.details).toEqual({ what: 'DSH 插件宿主进程' })
    expect(failure.stack).toBe('at boot')
  })

  it('认不出的码折兜底，原码进 details.what（不丢证据）', () => {
    const failure = pluginHostFailureOf({ type: 'fatal', code: 'eleckoi/未来才有的码', message: '新版本的东西' })
    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.internal)
    expect(failure.details).toEqual({ what: 'eleckoi/未来才有的码' })
  })

  it('没有码的帧折兜底，并写明子进程没给码', () => {
    const failure = pluginHostFailureOf({ type: 'fatal', message: '子进程崩了' })
    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.internal)
    expect(failure.details).toEqual({ what: '子进程未提供失败码' })
  })

  it('产物自带网关载体标记，后续折叠不再改写码（③ → ⑤ 一跳）', () => {
    const failure = pluginHostFailureOf({
      type: 'fatal',
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '写不进去',
      details: { operation: 'write' }
    })
    expect(failure.isDSHRemoteError).toBe(true)
    expect(foldFailure(failure).code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
  })

  it('可 JSON 往返（要过结构化克隆与 IPC）', () => {
    const failure = pluginHostFailureOf({
      type: 'fatal',
      code: ELECKOI_FAILURE_CODES.timeoutExpired,
      message: '启动超时',
      details: { what: 'DSH 插件宿主启动' }
    })
    const plain = { isDSHRemoteError: true, code: failure.code, message: failure.message, details: failure.details }
    expect(JSON.parse(JSON.stringify(plain))).toEqual(plain)
  })
})
