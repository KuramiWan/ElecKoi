import { describe, expect, it } from 'vitest'
import { settingLibraryHistory } from '../../src/host/session-runtime.mjs'

function message(role, text, source = role === 'user' ? { kind: 'user' } : { kind: 'model' }) {
  return { id: `${role}-${text}`, role, content: [{ type: 'text', text }], source }
}

function session(messages) {
  return { deriveMessages: () => messages }
}

describe('setting library history', () => {
  it('keeps visible user input and final replies without tool steps', () => {
    const messages = [
      message('system', '系统配置'),
      message('user', '旧输入'),
      { ...message('assistant', ''), content: [{ type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{}' }] },
      message('user', '工具结果', { kind: 'tool', callId: 'call-1' }),
      message('assistant', '<FINAL>旧回复</FINAL>')
    ]
    expect(settingLibraryHistory(session(messages), '新输入')).toEqual([
      { role: 'user', content: '旧输入' },
      { role: 'assistant', content: '旧回复' }
    ])
  })

  it('drops the current input retained by regeneration so the bridge appends it once', () => {
    const messages = [
      message('user', '旧输入'),
      message('assistant', '旧回复'),
      message('user', '当前输入')
    ]
    expect(settingLibraryHistory(session(messages), '当前输入')).toEqual([
      { role: 'user', content: '旧输入' },
      { role: 'assistant', content: '旧回复' }
    ])
  })

  it('keeps a repeated user message that is not the last visible message', () => {
    const messages = [message('user', '继续'), message('assistant', '回复')]
    expect(settingLibraryHistory(session(messages), '继续')).toEqual([
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '回复' }
    ])
  })

  it('returns empty history when the session surface is unavailable', () => {
    expect(settingLibraryHistory(undefined, '新输入')).toEqual([])
    expect(settingLibraryHistory({}, '新输入')).toEqual([])
  })
})
