// 判据来源：ADR 0002 决定 4/8（用户可见文案只有一个解析点，在渲染层；宿主不拼用户可见句子）、
// spec 决定 8、票 EH-4b 第 1 节（输入输出形状 / 未知码不许吞 / 复用 EH-1 的折叠）。
// 三份 helper 收口后的统一行为对照 `notes/eh-explore-renderer.md` §7.2 的差异表逐行断言。
import { describe, expect, it, vi } from 'vitest'
import {
  ELECKOI_FAILURE_CODE_LIST,
  ELECKOI_FAILURE_CODES,
  ELECKOI_FALLBACK_FAILURE_CODE
} from '../packages/product-shared/src/contracts/errors/codes'
import {
  GENERIC_FAILURE_TEXT,
  failureDetailLines,
  failureMessage,
  formatFailureDetails,
  reportFailure,
  resolveFailure
} from '../apps/web/src/utils/failureText.js'

describe('用户可见文案的唯一解析点', () => {
  it('RemoteError 形状的契约码：按码给说法，码与详情原样带出去', () => {
    const failure = {
      isDSHRemoteError: true,
      code: ELECKOI_FAILURE_CODES.ioFailed,
      message: '读取角色列表失败：ENOENT',
      details: { operation: 'read', path: '/tmp/eleckoi/characters.json' }
    }

    const resolved = resolveFailure(failure)

    expect(resolved.code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
    expect(resolved.details).toEqual({ operation: 'read', path: '/tmp/eleckoi/characters.json' })
    expect(resolved.text).toContain('读取失败')
    expect(resolved.text).toContain('/tmp/eleckoi/characters.json')
    expect(resolved.text).not.toContain('角色不存在')
    expect(resolved.diagnostic).toContain(ELECKOI_FAILURE_CODES.ioFailed)
    expect(resolved.diagnostic).toContain('读取角色列表失败：ENOENT')
    expect(resolved.diagnostic).toContain('/tmp/eleckoi/characters.json')
  })

  it('认不出的码：给一句通用说法，但码与详情不许被吞', () => {
    const resolved = resolveFailure({
      isDSHRemoteError: true,
      code: 'gateway/internal',
      message: 'carrier failed',
      details: { endpoint: 'eleckoiCharacters/list' }
    })

    expect(resolved.code).toBe(ELECKOI_FALLBACK_FAILURE_CODE)
    expect(resolved.details.what).toBe('gateway/internal')
    expect(resolved.text).toBe(GENERIC_FAILURE_TEXT)
    expect(resolved.text).not.toContain('carrier failed')
    expect(resolved.diagnostic).toContain('gateway/internal')
  })

  it('裸 Error 与字符串：码走兜底，文案用它自己的 message', () => {
    expect(resolveFailure(new Error('  EACCES: permission denied  '))).toMatchObject({
      code: ELECKOI_FALLBACK_FAILURE_CODE,
      text: 'EACCES: permission denied'
    })
    expect(resolveFailure(' 发送失败 ').text).toBe('发送失败')
    expect(resolveFailure({ message: '连接被拒绝' }).text).toBe('连接被拒绝')
  })

  it('给不出文案的输入：用调用方给的 fallback，不把 null / [object Object] 交给用户', () => {
    const fallback = { fallback: '发送失败' }

    expect(resolveFailure(null, fallback).text).toBe('发送失败')
    expect(resolveFailure(undefined, fallback).text).toBe('发送失败')
    expect(resolveFailure({ reason: 'not_ready' }, { fallback: '连接测试失败' }).text).toBe('连接测试失败')
    expect(resolveFailure({ message: 42 }, { fallback: '导入失败' }).text).toBe('导入失败')
    expect(resolveFailure('', fallback).text).toBe('发送失败')
    expect(resolveFailure(null).text).toBe(GENERIC_FAILURE_TEXT)
  })

  it('码表里每条具体码都有自己的说法（兜底码除外）', () => {
    for (const code of ELECKOI_FAILURE_CODE_LIST) {
      if (code === ELECKOI_FALLBACK_FAILURE_CODE) continue
      const resolved = resolveFailure({
        isDSHRemoteError: true,
        code,
        message: 'developer diagnostic',
        details: {}
      })
      expect(resolved.code, code).toBe(code)
      expect(resolved.text, code).not.toBe(GENERIC_FAILURE_TEXT)
      expect(resolved.text, code).not.toBe('developer diagnostic')
      expect(resolved.text.trim().length, code).toBeGreaterThan(0)
    }
  })

  it('永不抛：可疑输入粗扫一圈，且都产出可用的 text 与对象形态的 details', () => {
    const suspicious = [
      Symbol('x'),
      () => {},
      0,
      false,
      NaN,
      [],
      [new Error('nested')],
      { message: 42 },
      { isDSHRemoteError: true, code: 42, message: '失败' }
    ]

    for (const value of suspicious) {
      const resolved = resolveFailure(value, { fallback: '操作失败' })
      expect(typeof resolved.text, String(value)).toBe('string')
      expect(resolved.text.trim().length, String(value)).toBeGreaterThan(0)
      expect(typeof resolved.code, String(value)).toBe('string')
      expect(Array.isArray(resolved.details), String(value)).toBe(false)
      expect(resolved.details, String(value)).not.toBeNull()
      expect(typeof resolved.diagnostic, String(value)).toBe('string')
    }
  })

  it('详情行格式化：参数逐个给出，供界面展示与复制', () => {
    expect(failureDetailLines({ operation: 'read', path: '/tmp/a.json' })).toEqual([
      { key: 'operation', label: 'operation', value: 'read' },
      { key: 'path', label: 'path', value: '/tmp/a.json' }
    ])
    expect(failureDetailLines({})).toEqual([])
    expect(failureDetailLines(null)).toEqual([])
    expect(formatFailureDetails({ issues: [{ path: 'name', message: 'Too small' }] }))
      .toBe('issues: [{"path":"name","message":"Too small"}]')
    expect(formatFailureDetails({ what: 'gateway/internal' })).toBe('what: gateway/internal')
  })

  it('诊断串交给日志：带可检索标记、码与详情', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const resolved = reportFailure(new Error('EACCES: permission denied'), '窗口最小化')
      expect(resolved.code).toBe(ELECKOI_FALLBACK_FAILURE_CODE)
      expect(spy).toHaveBeenCalledTimes(1)
      const line = spy.mock.calls[0][0]
      expect(line).toContain('窗口最小化')
      expect(line).toContain('eleckoi-renderer-failure')
      expect(line).toContain(ELECKOI_FALLBACK_FAILURE_CODE)
      expect(line).toContain('EACCES: permission denied')
    } finally {
      spy.mockRestore()
    }
  })
})

// 判据来源：notes/eh-explore-renderer.md §7.2 的三份分叉行为差异表（A=useActiveChatModel、
// B=useModelConnectionTest、C=chatMessageSend 的 getErrorMessage）。
it.each([
  { name: '带空白的字符串', input: '  boom  ', fallback: '兜底', expected: 'boom', before: 'A 不 trim、C trim、B 走 fallback' },
  { name: '带空白的 Error message', input: new Error('  boom  '), fallback: '兜底', expected: 'boom', before: 'A/B 不 trim、C trim' },
  { name: '空 message 的 Error', input: new Error(''), fallback: '兜底', expected: '兜底', before: '三份都走 fallback' },
  { name: '{ message } 普通对象', input: { message: 'boom' }, fallback: '兜底', expected: 'boom', before: 'B 走 fallback、A/C 认 message' },
  { name: 'message 为非字符串的对象', input: { message: 42 }, fallback: '兜底', expected: '兜底', before: 'A/C 对 number 取 .trim 会抛 TypeError' },
  { name: '带 cause 的 Error', input: new Error('b', { cause: new Error('c') }), fallback: '兜底', expected: 'b', before: '三份都只取最外层（共享 errorMessage.ts 会拼 cause 链，但那份零引用）' }
])('收口后 failureMessage 对 $name 统一给 $expected（收口前：$before）', ({ input, fallback, expected }) => {
  expect(failureMessage(input, fallback)).toBe(expected)
})
