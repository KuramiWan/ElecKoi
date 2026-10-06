import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { sessionFormatLogFilename } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { createSessionFormatV3ToV4, releasedV3SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { afterEach, describe, expect, it } from 'vitest'
import { readDshSessionLog } from '../packages/dsh-runtime/src/trajectory'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function historicalEvents(preStep = false, initialHead = false) {
  const events = []
  const append = (type, data, surfaceOp, sourceEventSeqs) => {
    const event = { seq: events.length, time: 1_000 + events.length, type, data,
      ...(surfaceOp ? { surfaceOp } : {}), ...(sourceEventSeqs ? { sourceEventSeqs } : {}) }
    events.push(event)
    return event
  }
  const user = () => append('user/message', { id: 'synthetic-user', role: 'user',
    source: { kind: 'user' }, content: [{ type: 'text', text: '合成旧输入' }] }, 'append')
  const system = (turn, text, id) => append('system/message', { turn, step: 1, message: {
    id, role: 'system', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    content: [{ type: 'text', text }] } }, 'append')
  append('turn/start', { turn: 1 })
  if (preStep) user()
  append('step/start', { turn: 1, step: 1 })
  if (initialHead) system(1, '合成初始配置', 'synthetic-initial-system')
  if (!preStep) user()
  append('request/header', { header: { config: { provider: 'synthetic-provider', model: 'synthetic-model' } }, reason: 'initial' })
  append('assistant/message', { turn: 1, step: 1, stream: [], message: {
    id: 'synthetic-first-reply', role: 'assistant', source: { kind: 'model', provider: 'synthetic-provider', model: 'synthetic-model' },
    content: [{ type: 'reasoning', text: '合成思考' }, { type: 'text', text: '合成历史回复' }]
  } }, 'append')
  append('step/end', { turn: 1, step: 1 })
  append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  append('session/end-seed', {})
  append('turn/start', { turn: 2 })
  append('step/start', { turn: 2, step: 1 })
  system(2, '合成后续配置', 'synthetic-later-system')
  append('request/header', { header: { config: { provider: 'synthetic-provider', model: 'synthetic-model' } }, reason: 'initial' })
  append('assistant/message', { turn: 2, step: 1, stream: [], message: {
    id: 'synthetic-second-reply', role: 'assistant', source: { kind: 'model', provider: 'synthetic-provider', model: 'synthetic-model' },
    content: [{ type: 'text', text: '合成后续回复' }]
  } }, 'append')
  append('step/end', { turn: 2, step: 1 })
  append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  append('session/title', { title: '合成聊天', source: { kind: 'llm' },
    messageSeqs: [events.find(event => event.type === 'user/message').seq] })
  return events
}

async function fixture(events = historicalEvents(), headerOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-system-head-'))
  cleanups.push(() => {
    const child = relative(tmpdir(), root)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected fixture directory')
    rmSync(root, { recursive: true, force: true })
  })
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  cleanups.push(() => ctx.fiber.dispose())
  const id = SessionId('synthetic-old-session')
  const handle = await ctx.sessionPersistence.create(Session.create(id).header)
  await handle.flush()
  await handle.close()
  const current = readDshSessionLog(root, id)
  const currentPath = current.path
  const header = current.header
  const inherited = headerOverrides.isSeeded
    ? events.findLastIndex(event => event.type === 'session/end-seed' && event.data.inherited === true) : 0
  const oldHeader = { ...header, version: 3, ...headerOverrides }
  const rows = [releasedV3SessionFormatCodec.encodeHeader(oldHeader, inherited),
    ...events.map(event => releasedV3SessionFormatCodec.encodeEvent(event))]
  const source = rows.map(JSON.stringify).join('\n') + '\n'
  const path = join(dirname(currentPath), sessionFormatLogFilename(3))
  writeFileSync(path, source)
  rmSync(currentPath)
  return { root, ctx, id, path, currentPath, source, events, header: oldHeader }
}

async function read(ctx, id, access = 'read') {
  const handle = await ctx.sessionPersistence.open(id, access)
  try { return { ...await handle.read(), header: handle.header, inheritedEventCount: handle.inheritedEventCount } }
  finally { await handle.close() }
}

function messages(events) {
  return events.filter(event => event.surfaceOp !== undefined)
    .map(event => event.type === 'user/message' ? event.data : event.data.message)
}

describe('V3 system head adjacent migration', { timeout: 30_000 }, () => {
  it.each([false, true])('migrates missing head with pre-step inputs=%s, preserving messages and actual lifecycle', async preStep => {
    const f = await fixture(historicalEvents(preStep))
    const migrated = await read(f.ctx, f.id)
    expect(migrated.header).toEqual({ ...f.header, version: 4 })
    const head = migrated.events.find(event => event.type === 'system/message')
    expect(head.data.message.content).toEqual([])
    expect(head.data).toMatchObject({ turn: 1, step: 1 })
    expect(migrated.events[head.seq - 1].type).toBe('step/start')
    const originalMessages = messages(f.events).map(({ id, role, content }) => ({ id, role, content }))
    expect(messages(migrated.events).filter(message => message.id !== head.data.message.id)
      .map(({ id, role, content }) => ({ id, role, content }))).toEqual(originalMessages)
    const lifecycle = ['turn/start', 'turn/end', 'step/start', 'step/end']
    expect(migrated.events.filter(event => lifecycle.includes(event.type)).map(({ type, time, data }) => ({ type, time, data })))
      .toEqual(f.events.filter(event => lifecycle.includes(event.type)).map(({ type, time, data }) => ({ type, time, data })))
    const later = migrated.events.find(event => event.type === 'system/message' && event.data.message.id === 'synthetic-later-system')
    expect(later.data).toMatchObject({ turn: 2, step: 1 })
    expect(later.time).toBe(f.events.find(event => event.data.message?.id === 'synthetic-later-system').time)
    expect(migrated.events.filter(event => event.type === 'request/header').map(({ type, time, data }) => ({ type, time, data })))
      .toEqual(f.events.filter(event => event.type === 'request/header').map(({ type, time, data }) => ({ type, time, data })))
    const title = migrated.events.find(event => event.type === 'session/title')
    expect(migrated.events[title.data.messageSeqs[0]].data.id).toBe('synthetic-user')
    const session = Session.create(f.id, migrated.events, migrated.header, migrated.inheritedEventCount)
    expect(session.deriveMessages().map(({ id, role, content }) => ({ id, role, content }))).toEqual(originalMessages)
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
    expect(readdirSync(dirname(f.path))).not.toContain(sessionFormatLogFilename(4))
    await read(f.ctx, f.id, 'write')
    const successor = readFileSync(f.currentPath, 'utf8')
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
    const reopened = new Context()
    await reopened.plugin(JsonlSessionPersistence, { root: f.root, compression: 'none' })
    cleanups.push(() => reopened.fiber.dispose())
    const stored = await read(reopened, f.id, 'write')
    expect(stored.events).toEqual(migrated.events)
    expect(readFileSync(f.currentPath, 'utf8')).toBe(successor)
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
    const resumed = Session.create(f.id, stored.events, stored.header, stored.inheritedEventCount)
    resumed.append('turn/start', { turn: 3 })
    resumed.append('step/start', { turn: 3, step: 1 })
    resumed.append('system/message', { turn: 3, step: 1, message: createSystemMessage('合成当前配置') }, { surfaceOp: 'append' })
    const nextInput = createUserMessage({ content: [{ type: 'text', text: '合成新输入' }], source: { kind: 'user' } })
    resumed.append('user/message', nextInput, { surfaceOp: 'append' })
    resumed.append('request/header', { header: { config: { provider: 'synthetic-provider', model: 'synthetic-model' } }, reason: 'initial' })
    const nextReply = createAssistantMessage({ content: [{ type: 'text', text: '合成新回复' }],
      source: { provider: 'synthetic-provider', model: 'synthetic-model' } })
    resumed.append('assistant/message', { turn: 3, step: 1, stream: [], message: nextReply }, { surfaceOp: 'append' })
    resumed.append('step/end', { turn: 3, step: 1 })
    resumed.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    const writer = await reopened.sessionPersistence.open(f.id, 'write')
    try { await writer.append(resumed.snapshotEvents().slice(stored.events.length)); await writer.flush() }
    finally { await writer.close() }
    const continued = await read(reopened, f.id)
    expect(continued.header.id).toBe(f.id)
    expect(continued.events).toEqual(resumed.snapshotEvents())
    expect(Session.create(f.id, continued.events, continued.header, continued.inheritedEventCount)
      .deriveMessages().filter(message => message.role !== 'system').map(message => message.id))
      .toEqual([...originalMessages.filter(message => message.role !== 'system').map(message => message.id), nextInput.id, nextReply.id])
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
  })

  it('does not add another system head to a normal V3 Session', async () => {
    const f = await fixture(historicalEvents(false, true))
    const stored = await read(f.ctx, f.id, 'write')
    expect(stored.events).toHaveLength(f.events.length)
    expect(stored.events.filter(event => event.type === 'system/message').map(event => event.data.message.id))
      .toEqual(['synthetic-initial-system', 'synthetic-later-system'])
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
  })

  it('keeps replacement ranges and source references attached to the original input', async () => {
    const events = historicalEvents(true)
    const original = events.find(event => event.type === 'user/message')
    const systemIndex = events.findIndex(event => event.type === 'system/message')
    events.splice(systemIndex + 1, 0, { type: 'user/message', time: 2_000,
      data: { ...original.data, id: 'synthetic-edited-input', content: [{ type: 'text', text: '合成修改输入' }] },
      surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
    events.forEach((event, seq) => { event.seq = seq })
    const f = await fixture(events)
    const migrated = await read(f.ctx, f.id, 'write')
    const input = migrated.events.find(event => event.data.id === 'synthetic-user')
    const edited = migrated.events.find(event => event.data.id === 'synthetic-edited-input')
    expect(edited.surfaceOp).toEqual({ op: 'replace', startSeq: input.seq, endSeq: input.seq })
    expect(edited.sourceEventSeqs).toEqual([input.seq])
    const current = Session.create(f.id, migrated.events, migrated.header, migrated.inheritedEventCount).deriveMessages()
    expect(current.some(message => message.id === input.data.id)).toBe(false)
    expect(current.find(message => message.id === edited.data.id).content).toEqual(edited.data.content)
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
  })

  it('preserves completed tool execution while using the official V4 tool conversion', async () => {
    const events = historicalEvents()
    const reply = events.find(event => event.type === 'assistant/message')
    reply.data.message.content.push({ type: 'tool-call', id: 'synthetic-call', name: 'synthetic-tool', arguments: '{}' })
    const endIndex = events.findIndex(event => event.type === 'step/end')
    events.splice(endIndex, 0,
      { type: 'tool/call', time: 1_500, data: { turn: 1, step: 1, callId: 'synthetic-call', name: 'synthetic-tool', arguments: '{}' } },
      { type: 'tool/result', time: 1_501, surfaceOp: 'append', data: { turn: 1, step: 1, message: {
        id: 'synthetic-tool-result', role: 'user', source: { kind: 'tool', callId: 'synthetic-call' },
        content: [{ type: 'tool-result', toolCallId: 'synthetic-call', isError: false, content: [{ type: 'text', text: '合成工具结果' }] }]
      } } })
    events.forEach((event, seq) => { event.seq = seq })
    const f = await fixture(events)
    const migrated = await read(f.ctx, f.id, 'write')
    expect(migrated.events.find(event => event.type === 'tool/call').data).toEqual(events.find(event => event.type === 'tool/call').data)
    expect(migrated.events.find(event => event.type === 'tool/result').data.message).toEqual({
      id: 'synthetic-tool-result', role: 'tool', toolCallId: 'synthetic-call', isError: false,
      source: { kind: 'tool', callId: 'synthetic-call' }, content: [{ type: 'text', text: '合成工具结果' }]
    })
    expect(migrated.events.find(event => event.type === 'assistant/message').data).toEqual(reply.data)
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
  })

  it('remaps an existing inherited cut without moving inputs across it', async () => {
    const events = historicalEvents(true)
    const marker = events.find(event => event.type === 'session/end-seed')
    marker.data.inherited = true
    const f = await fixture(events, { isSeeded: true, parentSession: 'synthetic-parent', delegationDepth: 1 })
    const migrated = await read(f.ctx, f.id, 'write')
    expect(migrated.inheritedEventCount).toBe(migrated.events.find(event => event.type === 'session/end-seed').seq)
    expect(migrated.inheritedEventCount).toBe(marker.seq + 1)
    expect(migrated.events.slice(0, migrated.inheritedEventCount).some(event => event.data.id === 'synthetic-user')).toBe(true)
    expect((await read(f.ctx, f.id)).events).toEqual(migrated.events)
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
  })

  it('continues to reject a native V4 artifact without the protected system head', async () => {
    const f = await fixture()
    const migrated = await read(f.ctx, f.id)
    const events = migrated.events.filter(event => event.type !== 'session/title'
      && !(event.type === 'system/message' && event.data.message.content.length === 0))
      .map((event, seq) => ({ ...event, seq }))
    const restore = sessionFormatCatalog.createRestore(sessionFormatCatalog.encodeCurrentHeader(migrated.header, 0),
      { recovery: 'strict', validation: 'current' })
    expect(() => {
      for (const event of events) restore.decodeRow(sessionFormatCatalog.encodeCurrentEvent(event))
      restore.finish()
    }).toThrow('system/message requires a protected first surface head')
    expect(readdirSync(dirname(f.path))).not.toContain(sessionFormatLogFilename(4))
  })

  it('does not turn an invalid supplied inheritance boundary into an unspecified one', async () => {
    const events = historicalEvents()
    events.find(event => event.type === 'session/end-seed').data.inherited = true
    const f = await fixture(events, { isSeeded: true, parentSession: 'synthetic-parent', delegationDepth: 1 })
    const stage = createSessionFormatV3ToV4([]).createStage({ sourceHeader: f.header,
      targetHeader: { ...f.header, version: 4 }, sourceInheritedEventCount: events.length, sourceKind: 'decoded' })
    const context = { emitEvent: () => {} }
    for (const event of events) stage.transformEvent(event, context)
    expect(() => stage.finish(context)).toThrow()
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
    expect(readdirSync(dirname(f.path))).not.toContain(sessionFormatLogFilename(4))
  })

  it.each(['closed-turn', 'inherited', 'broken-step', 'unknown-required'])('refuses %s without modifying the old generation or publishing V4', async kind => {
    const events = historicalEvents(true)
    let header = {}
    if (kind === 'closed-turn') events.splice(2, 0,
      { type: 'turn/end', time: 1_002, data: { turn: 1, reason: { kind: 'completed' } } })
    if (kind === 'inherited') {
      events.splice(2, 0, { type: 'session/end-seed', time: 1_002, data: { inherited: true } })
      header = { isSeeded: true }
    }
    if (kind === 'broken-step') events.find(event => event.type === 'system/message').data.step = 2
    if (kind === 'unknown-required') events.push({ type: 'synthetic/required', time: 2_000, data: {} })
    events.forEach((event, seq) => { event.seq = seq })
    // The added prefixes do not affect references in these refusal fixtures.
    const f = await fixture(events, header)
    await expect(read(f.ctx, f.id, 'write')).rejects.toThrow()
    expect(readFileSync(f.path, 'utf8')).toBe(f.source)
    expect(readdirSync(dirname(f.path))).not.toContain(sessionFormatLogFilename(4))
  })

  it('publishes through the official writer lease and leaves only one current generation', async () => {
    const f = await fixture()
    const owner = await f.ctx.sessionPersistence.open(f.id, 'write')
    try {
      const other = new Context()
      await other.plugin(JsonlSessionPersistence, { root: f.root, compression: 'none' })
      cleanups.push(() => other.fiber.dispose())
      await expect(other.sessionPersistence.open(f.id, 'write')).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
      expect(readFileSync(f.path, 'utf8')).toBe(f.source)
      expect(readdirSync(dirname(f.path)).filter(name => name === sessionFormatLogFilename(4))).toHaveLength(1)
    } finally { await owner.close() }
  })
})
