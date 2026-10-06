import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { sessionFormatLogFilename } from '@deepseek-ai/dsh-session-format'
import { releasedV3SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDshSessionLog } from '../packages/dsh-runtime/src/trajectory'
import { recoverStartupSessions } from '../packages/dsh-runtime/src/sessionStartupRecovery'

const cleanups = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-startup-recovery-'))
  cleanups.push(() => {
    const child = relative(tmpdir(), root)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected fixture directory')
    rmSync(root, { recursive: true, force: true })
  })
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  cleanups.push(() => ctx.fiber.dispose())
  const records = []
  const paths = new Map()
  for (const id of ['synthetic-first', 'synthetic-second']) {
    const session = Session.create(SessionId(id))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '合成输入' }], source: { kind: 'user' }
    }), { surfaceOp: 'append' })
    const handle = await ctx.sessionPersistence.create(session.header)
    await handle.append(session.snapshotEvents())
    await handle.flush()
    await handle.close()
    paths.set(id, readDshSessionLog(root, id).path)
    records.push({ id, runtimeSessionId: id, metadata: { characterId: 'synthetic-character' } })
  }
  const archive = { tables: { agent_turns: [{ kind: 'user' }] } }
  const write = vi.fn(async () => {})
  ctx.provide('eleckoiProductData', {
    readConversationCatalog: () => records,
    exportConversationArchive: () => archive
  })
  ctx.provide('eleckoiSessionHandles', { withClosed: async (_id, action) => action() })
  ctx.provide('sessionProjections', { hydrate: () => {} })
  ctx.provide('sessionProjectionCache', { write })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return { root, ctx, records, paths, write, error }
}

describe('desktop startup Session recovery', { timeout: 30_000 }, () => {
  it('keeps an invalid V3 step unchanged and still refreshes the next conversation', async () => {
    const f = await fixture()
    const current = f.paths.get('synthetic-first')
    const log = readDshSessionLog(f.root, 'synthetic-first')
    const codec = releasedV3SessionFormatCodec
    const event = (seq, type, data, surfaceOp) => ({ seq, time: 1_000 + seq, type, data,
      ...(surfaceOp ? { surfaceOp } : {}) })
    const rows = [codec.encodeHeader({ ...log.header, version: 3 }, 0), ...[
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'user/message', { id: 'synthetic-user', role: 'user',
        source: { kind: 'user' }, content: [{ type: 'text', text: '合成旧输入' }] }, 'append'),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'system/message', { turn: 1, step: 2, message: {
        id: 'synthetic-system', role: 'system', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
        content: [{ type: 'text', text: '合成系统配置' }] } }, 'append'),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    ].map(row => codec.encodeEvent(row))]
    const path = join(dirname(current), sessionFormatLogFilename(codec.version))
    const source = rows.map(JSON.stringify).join('\n') + '\n'
    writeFileSync(path, source)
    rmSync(current)
    await expect(f.ctx.sessionPersistence.open(SessionId('synthetic-first'), 'write'))
      .rejects.toThrow(/open turn and step/)
    await expect(recoverStartupSessions(f.ctx, f.root)).resolves.toBeUndefined()
    expect(f.write.mock.calls.map(([session]) => session.id)).toEqual(['synthetic-second'])
    expect(f.error).toHaveBeenCalledWith(expect.stringContaining('synthetic-first'),
      expect.objectContaining({ message: expect.stringContaining('open turn and step') }))
    expect(readFileSync(path, 'utf8')).toBe(source)
    expect(readdirSync(dirname(path))).not.toContain(sessionFormatLogFilename(4))
    const handle = await f.ctx.sessionPersistence.open(SessionId('synthetic-second'), 'write')
    await handle.close()
  })

  it('contains a projection refresh failure and continues with later conversations', async () => {
    const f = await fixture()
    const original = readFileSync(f.paths.get('synthetic-first'), 'utf8')
    f.write.mockRejectedValueOnce(new Error('synthetic checkpoint failure'))
    await expect(recoverStartupSessions(f.ctx, f.root)).resolves.toBeUndefined()
    expect(f.write.mock.calls.map(([session]) => session.id)).toEqual(['synthetic-first', 'synthetic-second'])
    expect(f.error).toHaveBeenCalledWith(expect.stringContaining('synthetic-first'),
      expect.objectContaining({ message: 'synthetic checkpoint failure' }))
    expect(readFileSync(f.paths.get('synthetic-first'), 'utf8')).toBe(original)
    const handle = await f.ctx.sessionPersistence.open(SessionId('synthetic-first'), 'write')
    await handle.close()
  })

  it.each(['stat', 'archive'])('contains a per-conversation %s failure', async stage => {
    const f = await fixture()
    if (stage === 'stat') vi.spyOn(f.ctx.sessionPersistence, 'stat').mockRejectedValueOnce(new Error('synthetic header failure'))
    else vi.spyOn(f.ctx.eleckoiProductData, 'exportConversationArchive').mockImplementationOnce(() => {
      throw new Error('synthetic archive failure')
    })
    await expect(recoverStartupSessions(f.ctx, f.root)).resolves.toBeUndefined()
    expect(f.error).toHaveBeenCalledOnce()
    expect(f.write.mock.calls.map(([session]) => session.id)).toEqual(['synthetic-second'])
  })
})
