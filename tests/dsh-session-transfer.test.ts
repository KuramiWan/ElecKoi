import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { exportDshSession, importDshSessions, readDshSessionLog } from '@eleckoi/dsh-runtime'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('round trips a DSH log through its public session persistence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-transfer-'))
  directories.push(directory)
  const sourceRoot = join(directory, 'source')
  const targetRoot = join(directory, 'target')
  const sourceDirectory = join(sourceRoot, 'project', 'session')
  mkdirSync(sourceDirectory, { recursive: true })
  const session = Session.create(SessionId('session-source'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '测试输入' }], source: { kind: 'user' }
  }), { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  writeFileSync(join(sourceDirectory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`), [
    sessionFormatCatalog.encodeCurrentHeader({ ...session.header, delegationDepth: 0 }, session.inheritedEventCount),
    ...session.snapshotEvents().map((event) => sessionFormatCatalog.encodeCurrentEvent(
      event as Parameters<typeof sessionFormatCatalog.encodeCurrentEvent>[0]
    ))
  ].map((row) => JSON.stringify(row)).join('\n') + '\n')
  const archive = exportDshSession(sourceRoot, 'session-source')
  expect(archive).not.toBeNull()
  await importDshSessions(targetRoot, join(directory, 'workspace'), [archive!], new Map([['session-source', 'session-imported']]))
  const imported = readDshSessionLog(targetRoot, 'session-imported')
  expect(imported?.header.id).toBe('session-imported')
  expect(imported?.events).toEqual(archive?.events)
})
