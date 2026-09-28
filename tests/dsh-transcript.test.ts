import { describe, expect, it } from 'vitest'
import { projectDshTranscript } from '@eleckoi/dsh-runtime'

describe('DSH transcript projection', () => {
  it('projects exact completed-turn usage onto the matching assistant response', () => {
    const turns = projectDshTranscript([
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'step/start', data: { turn: 1, step: 1 } },
      { seq: 3, time: 3, type: 'assistant/message', surfaceOp: 'append', data: {
        turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 170, cacheReadTokens: 50 },
        message: { id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' }, content: [{ type: 'text', text: '回答' }] }
      } },
      { seq: 4, time: 4, type: 'step/end', data: { turn: 1, step: 1 } },
      { seq: 5, time: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { seq: 6, time: 6, type: 'turn/start', data: { turn: 2 } }
    ], 'session-usage')
    expect(turns[0]?.turnUsage).toEqual({
      uncachedInputTokens: 100, outputTokens: 20, totalTokens: 170,
      cacheReadTokens: 50, routes: [{ provider: 'deepseek', model: 'deepseek-chat' }]
    })
    expect(turns[1]?.turnUsage).toBeUndefined()
  })

  it('reads uploaded file references from the user message', () => {
    const attachment = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'notes.md', bytes: 12 }
    const turns = projectDshTranscript([
      { seq: 0, time: 10, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, time: 11, type: 'user/message', surfaceOp: 'append', data: {
        source: { kind: 'user' }, content: [{ type: 'file', attachment }]
      } },
      { seq: 2, time: 12, type: 'turn/end', data: { turn: 1 } }
    ], 'session-file')
    expect(turns[0]?.userFiles).toEqual([attachment])
  })

  it('reads user image references from the Session log', () => {
    const attachment = {
      attachmentId: 'sha256:example', mediaType: 'image/png', bytes: 128,
      width: 16, height: 8, name: 'scene.png'
    }
    const turns = projectDshTranscript([
      { seq: 0, time: 10, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, time: 11, type: 'user/message', surfaceOp: 'append', data: {
        id: 'user-message-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '看这张图' }, { type: 'image', attachment }]
      } },
      { seq: 2, time: 12, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
    ], 'session-image')
    expect(turns[0]?.userImages).toEqual([attachment])
    expect(turns[0]?.userMessageId).toBe('user-message-1')
  })

  it('keeps direct user input and the final reply in their original turns', () => {
    const events = [
      { seq: 0, time: 10, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, time: 11, type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }] } },
      { seq: 2, time: 12, type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:eleckoi-request-projection' }, content: [{ type: 'text', text: '内部提示' }] } },
      { seq: 3, time: 13, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '工具说明' }, { type: 'tool-call', id: 'call-1' }] } } },
      { seq: 4, time: 14, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 2, message: { id: 'assistant-message-1', content: [{ type: 'reasoning', text: '思考' }, { type: 'text', text: '回答' }] } } },
      { seq: 5, time: 15, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { seq: 6, time: 20, type: 'turn/start', data: { turn: 2 } },
      { seq: 7, time: 21, type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '追问' }] } },
      { seq: 8, time: 22, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 7, endSeq: 7 }, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '模型内部替换' }] } }
    ]
    const turns = projectDshTranscript(events, 'session-a')
    expect(turns[0]?.assistantMessageId).toBe('assistant-message-1')
    expect(turns.map(({ startSeq, userSeq, userText, assistantSeq, assistantText, completed }) => ({
      startSeq, userSeq, userText, assistantSeq, assistantText, completed
    }))).toEqual([
      { startSeq: 0, userSeq: 1, userText: '问题', assistantSeq: 4, assistantText: '回答', completed: true },
      { startSeq: 6, userSeq: 7, userText: '追问', assistantSeq: null, assistantText: '', completed: false }
    ])
  })
})
