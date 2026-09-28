import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { DshRuntime, readDshSessionLog, rewindDshSession } from '@eleckoi/dsh-runtime'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(queuedPrompts = false, trailingPrompt = false) {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-rewind-'))
  temporaryDirectories.push(root)
  const directory = join(root, 'project', 'session')
  mkdirSync(directory, { recursive: true })
  const session = Session.create(SessionId('session-a'))
  for (let turn = 1; turn <= 3; turn += 1) {
    if (queuedPrompts) {
      session.append('agent/inbox/spliced', {
        target: 'next-turn', start: 0,
        inserted: [createUserMessage({
          content: [{ type: 'text', text: `待发送第${turn}轮` }], source: { kind: 'user' }
        })]
      })
    }
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `第${turn}轮` }], source: { kind: 'user' }
    }), { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  if (trailingPrompt) session.append('agent/inbox/spliced', {
    target: 'next-turn', start: 0,
    inserted: [createUserMessage({
      content: [{ type: 'text', text: '已取消的输入' }], source: { kind: 'user' }
    })]
  })
  const path = join(directory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`)
  writeFileSync(path, [
    sessionFormatCatalog.encodeCurrentHeader({ ...session.header, delegationDepth: 0 }, session.inheritedEventCount),
    ...session.snapshotEvents().map((event) => sessionFormatCatalog.encodeCurrentEvent(
      event as unknown as Parameters<typeof sessionFormatCatalog.encodeCurrentEvent>[0]
    ))
  ].map((row) => JSON.stringify(row)).join('\n') + '\n')
  return { root, path }
}

describe('DSH Session physical rewind', () => {
  it('drops queued prompts before the rewritten first turn', () => {
    const { root, path } = fixture(true)
    expect(rewindDshSession(root, 'session-a', 1)).toBe(0)
    expect(readDshSessionLog(root, 'session-a')?.events).toHaveLength(0)
    expect(readFileSync(path, 'utf8')).not.toContain('待发送第1轮')
  })

  it('drops queued prompts after the last retained turn', () => {
    const { root, path } = fixture(true)
    expect(rewindDshSession(root, 'session-a', 2)).toBe(6)
    const events = readDshSessionLog(root, 'session-a')?.events ?? []
    expect(events.filter((event) => event.type === 'turn/start')
      .map((event) => (event.data as { turn: number }).turn)).toEqual([1])
    expect(readFileSync(path, 'utf8')).not.toContain('待发送第2轮')
  })

  it('removes the selected turn and all later turns while retaining the Session id', () => {
    const { root, path } = fixture()
    const removedAt = rewindDshSession(root, 'session-a', 2)
    expect(removedAt).toBe(5)
    const restored = readDshSessionLog(root, 'session-a')
    expect(restored?.header.id).toBe('session-a')
    expect(restored?.events.filter((event) => event.type === 'turn/start')
      .map((event) => (event.data as { turn: number }).turn)).toEqual([1])
    const disk = readFileSync(path, 'utf8')
    expect(disk).toContain('第1轮')
    expect(disk).not.toContain('第2轮')
    expect(disk).not.toContain('第3轮')
  })

  it('removes a queued input that was cancelled before its turn started', () => {
    const { root, path } = fixture(false, true)
    expect(rewindDshSession(root, 'session-a', 4)).toBe(15)
    expect(readDshSessionLog(root, 'session-a')?.events).toHaveLength(15)
    expect(readFileSync(path, 'utf8')).not.toContain('已取消的输入')
  })

  it('leaves the original log intact when the target turn is absent', () => {
    const { root, path } = fixture()
    const before = readFileSync(path, 'utf8')
    expect(() => rewindDshSession(root, 'session-a', 5)).toThrow('没有第 5 轮')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('derives statistics from the retained log instead of a stale statistics file', async () => {
    const { root, path } = fixture()
    const runtimeRoot = join(root, 'runtime')
    const sessionRoot = join(runtimeRoot, 'sessions')
    const logDirectory = join(sessionRoot, 'project', 'session')
    mkdirSync(logDirectory, { recursive: true })
    copyFileSync(path, join(logDirectory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`))
    const statsDirectory = join(sessionRoot, 'conversation-a', 'eleckoi-generation-stats')
    mkdirSync(statsDirectory, { recursive: true })
    writeFileSync(join(statsDirectory, 'session-a.json'), JSON.stringify({ version: 1, turns: 99, steps: 99 }))
    const createRuntime = () => new DshRuntime({
      configPath: join(root, 'unused.yml'),
      workspaceRoot: join(root, 'workspace'),
      runtimeDataRoot: runtimeRoot,
      executablePath: 'unused',
      presetTemplatePath: join(root, 'unused-preset.yml')
    })
    const before = createRuntime()
    expect(before.generationStats('conversation-a', 'session-a')).toMatchObject({ turns: 3, steps: 3 })
    await before.close()

    rewindDshSession(sessionRoot, 'session-a', 2)
    const after = createRuntime()
    expect(after.generationStats('conversation-a', 'session-a')).toMatchObject({ turns: 1, steps: 1 })
    await after.close()
  })

  it('updates live statistics and trajectory after a same-Session rewind', async () => {
    const { root, path } = fixture()
    const runtimeRoot = join(root, 'runtime')
    const sessionRoot = join(runtimeRoot, 'sessions')
    const logDirectory = join(sessionRoot, 'project', 'session')
    mkdirSync(logDirectory, { recursive: true })
    copyFileSync(path, join(logDirectory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`))
    const runtime = new DshRuntime({
      configPath: join(root, 'unused.yml'), workspaceRoot: join(root, 'workspace'),
      runtimeDataRoot: runtimeRoot, executablePath: 'unused', presetTemplatePath: join(root, 'unused-preset.yml')
    })
    runtime.bindSessionHost({
      rewind: async (sessionId: string, fromTurn: number) => rewindDshSession(sessionRoot, sessionId, fromTurn),
      close: async () => undefined
    } as Parameters<DshRuntime['bindSessionHost']>[0])
    try {
      expect(runtime.generationStats('conversation-a', 'session-a')).toMatchObject({ turns: 3, steps: 3 })
      expect(runtime.trajectory('conversation-a', 'session-a').records).toHaveLength(3)
      await runtime.rewindConversation('conversation-a', 'session-a', 2)
      expect(runtime.generationStats('conversation-a', 'session-a')).toMatchObject({ turns: 1, steps: 1 })
      expect(runtime.trajectory('conversation-a', 'session-a').records).toHaveLength(1)
      expect(readFileSync(join(logDirectory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`), 'utf8'))
        .not.toContain('第2轮')
    } finally {
      await runtime.close()
    }
  })
})
