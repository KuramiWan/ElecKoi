import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HOST_SESSION_PROTOCOL_VERSION,
  childMessageDiagnosticOf,
  isChildMessage,
  pluginHostFailureOf,
  readyChildMessage,
  type ChildHostFatalMessage
} from '@eleckoi/desktop-host'

// 边界③（宿主 ↔ DSH 子进程）的用例。不起真子进程：直接把帧喂给解析 / 折叠函数
// （判据来源：ADR 0002 决定 10 与订正 a、tickets/EH-6-child-protocol.md 第 5 节）。

describe('子进程协议版本', () => {
  it('协议版本常量是 2', () => {
    expect(HOST_SESSION_PROTOCOL_VERSION).toBe(2)
  })

  it('生产侧的 ready 帧带同一个版本常量', () => {
    const ready = readyChildMessage('http://127.0.0.1:5/', [{ tag: 'eleckoi' }])
    expect(ready.protocolVersion).toBe(2)
    expect(ready.type).toBe('ready')
    expect(ready.url).toBe('http://127.0.0.1:5/')
    expect(ready.injections).toEqual([{ tag: 'eleckoi' }])
  })

  // 覆盖代理，不是行为判据：子进程入口在 import 时就会跑 main()，用例不能 import 它，
  // 所以「生产侧真的用了那个共享构造函数」只能读源文本来证。手法同 ADR 0002 订正 m。
  it('子进程入口通过同一个构造函数发 ready 帧（覆盖代理）', () => {
    const source = readFileSync('apps/desktop-host/src/desktopPluginHostChild.ts', 'utf8')
    expect(source).toContain('readyChildMessage(')
  })

  it('消费侧认同一个版本常量的 ready 帧，不认偏斜或缺失的版本', () => {
    expect(isChildMessage(readyChildMessage('http://127.0.0.1:5/', []))).toBe(true)
    expect(isChildMessage({
      type: 'ready', protocolVersion: 1, url: 'http://127.0.0.1:5/', injections: []
    })).toBe(false)
    expect(isChildMessage({ type: 'ready', url: 'http://127.0.0.1:5/', injections: [] })).toBe(false)
  })
})

describe('isChildMessage 的显式白名单', () => {
  it('未知 type 不是合法消息', () => {
    expect(isChildMessage({ type: 'bogus' })).toBe(false)
    expect(isChildMessage({ type: 'readyy', url: 'u', injections: [] })).toBe(false)
    expect(isChildMessage({ type: 7 })).toBe(false)
  })

  it('白名单里的四条仍然合法', () => {
    expect(isChildMessage(readyChildMessage('u', []))).toBe(true)
    expect(isChildMessage({ type: 'fatal', message: '炸了' })).toBe(true)
    expect(isChildMessage({ type: 'shutdown-complete' })).toBe(true)
    expect(isChildMessage({ type: 'update-tasks-complete', id: 'i', active: true })).toBe(true)
  })

  it('fatal 帧的可选字段在时必须不是字符串以外的类型', () => {
    expect(isChildMessage({ type: 'fatal', message: '炸了', code: 'eleckoi/io/failed' })).toBe(true)
    expect(isChildMessage({ type: 'fatal', message: '炸了', stack: 'at child.ts:1:1' })).toBe(true)
    expect(isChildMessage({ type: 'fatal', message: '炸了', logPath: '/tmp/host.log' })).toBe(true)
    expect(isChildMessage({ type: 'fatal', message: '炸了', code: 42 })).toBe(false)
    expect(isChildMessage({ type: 'fatal', message: '炸了', stack: 42 })).toBe(false)
    expect(isChildMessage({ type: 'fatal', message: '炸了', logPath: 42 })).toBe(false)
  })

  it('拒绝一条消息时说得清拒绝的是什么（含协议版本偏斜）', () => {
    expect(childMessageDiagnosticOf({ type: 'bogus' })).toContain('bogus')
    expect(childMessageDiagnosticOf(42)).toContain('type')
    expect(childMessageDiagnosticOf({ type: 'ready', protocolVersion: 1, url: 'u', injections: [] }))
      .toContain('协议版本偏斜')
  })
})

describe('fatal 帧折成可记录对象（③ 边界）', () => {
  const frame: ChildHostFatalMessage = {
    type: 'fatal',
    code: 'eleckoi/io/failed',
    message: '写不进去',
    stack: 'Error: 写不进去\n    at child.ts:1:1',
    logPath: '/tmp/eleckoi-plugin-host.log'
  }

  it('code / message / stack / logPath 都在，不是只有 message', () => {
    const failure = pluginHostFailureOf(frame)
    expect(failure.code).toBe('eleckoi/io/failed')
    expect(failure.message).toBe('写不进去')
    expect(failure.stack).toContain('at child.ts:1:1')
    expect(failure.logPath).toBe('/tmp/eleckoi-plugin-host.log')
  })

  it('帧没带码时折成兜底码', () => {
    const failure = pluginHostFailureOf({ type: 'fatal', message: '炸了' })
    expect(failure.code).toBe('eleckoi/internal')
    expect(failure.details).toEqual({})
  })

  it('帧带的码不在契约表里（例如 legacy 6 码）不原样传下去：折兜底码，原码进 details.what', () => {
    const failure = pluginHostFailureOf({ type: 'fatal', message: '炸了', code: 'NOT_FOUND' })
    expect(failure.code).toBe('eleckoi/internal')
    expect(failure.details).toEqual({ what: 'NOT_FOUND' })
  })

  it('没带 stack / logPath 的帧不凭空造这两个值', () => {
    const failure = pluginHostFailureOf({ type: 'fatal', message: '炸了' })
    expect(failure.logPath).toBeUndefined()
    expect(failure.stack).not.toContain('child.ts')
  })
})
