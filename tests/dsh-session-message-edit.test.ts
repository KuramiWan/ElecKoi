import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { editDshSessionMessage, readDshSessionLog, readDshTranscript } from '@eleckoi/dsh-runtime'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-message-edit-'))
  roots.push(root)
  const directory = join(root, 'project', 'session')
  mkdirSync(directory, { recursive: true })
  const session = Session.create(SessionId('session-edit'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const user = createUserMessage({ content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } })
  const assistant = createAssistantMessage({
    content: [{ type: 'text', text: '你好，欢迎。' }], source: { provider: 'test', model: 'test' }
  })
  session.append('user/message', user, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: assistant, stream: [] }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '之后的问题' }], source: { kind: 'user' }
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 2, step: 1,
    message: createAssistantMessage({ content: [{ type: 'text', text: '之后的回答' }], source: { provider: 'test', model: 'test' } }),
    stream: []
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const path = join(directory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`)
  writeFileSync(path, [
    sessionFormatCatalog.encodeCurrentHeader({ ...session.header, delegationDepth: 0 }, session.inheritedEventCount),
    ...session.snapshotEvents().map((event) => sessionFormatCatalog.encodeCurrentEvent(
      event as Parameters<typeof sessionFormatCatalog.encodeCurrentEvent>[0]
    ))
  ].map((row) => JSON.stringify(row)).join('\n') + '\n')
  return { root, path, user, assistant }
}

describe('DSH message edit', () => {
  it('edits only the selected assistant message without changing the user input or turn count', () => {
    const { root, assistant } = fixture()
    editDshSessionMessage(root, 'session-edit', assistant.id, 'assistant', '改过的回复')
    const transcript = readDshTranscript(root, 'session-edit')
    expect(transcript).toHaveLength(2)
    expect(transcript?.[0]?.userText).toBe('你好')
    expect(transcript?.[0]?.assistantText).toBe('改过的回复')
    expect(transcript?.[1]).toMatchObject({ userText: '之后的问题', assistantText: '之后的回答' })
    const log = readDshSessionLog(root, 'session-edit')!
    expect(log.events).toHaveLength(12)
    const resumed = Session.create(SessionId('session-edit'),
      log.events as unknown as Parameters<typeof Session.create>[1],
      log.header as unknown as Parameters<typeof Session.create>[2],
      log.inheritedEventCount as Parameters<typeof Session.create>[3])
    expect(resumed.deriveMessages().map((message) => message.content)).toEqual([
      [{ type: 'text', text: '你好' }], [{ type: 'text', text: '改过的回复' }],
      [{ type: 'text', text: '之后的问题' }], [{ type: 'text', text: '之后的回答' }]
    ])
  })

  it('edits only the selected user message', () => {
    const { root, user } = fixture()
    editDshSessionMessage(root, 'session-edit', user.id, 'user', '新的提问')
    expect(readDshTranscript(root, 'session-edit')?.[0]).toMatchObject({
      userText: '新的提问', assistantText: '你好，欢迎。'
    })
  })

  it('refuses a mismatched role or id without touching the log', () => {
    const { root, path, assistant } = fixture()
    const before = readFileSync(path, 'utf8')
    expect(() => editDshSessionMessage(root, 'session-edit', assistant.id, 'user', '错误内容')).toThrow()
    expect(() => editDshSessionMessage(root, 'session-edit', 'missing', 'assistant', '错误内容')).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})
