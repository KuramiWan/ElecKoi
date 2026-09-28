import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DshSessionCleanupRepository } from '../src/main/modules/agent/DshSessionCleanupRepository'
import { ConversationRepository } from '../src/main/modules/conversations/ConversationRepository'
import { MessageRepository } from '../src/main/modules/conversations/MessageRepository'
import { SqliteDatabase } from '../src/main/platform/sqlite/SqliteDatabase'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('keeps character-delete Session cleanup queued until its logs are removed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-session-cleanup-'))
  directories.push(directory)
  const database = new SqliteDatabase(join(directory, 'common.sqlite3'))
  database.open()
  try {
    const conversations = new ConversationRepository(database)
    const messages = new MessageRepository(database)
    const id = conversations.create({}).conversation.id
    database.native.prepare('UPDATE chat_sessions SET characterId=? WHERE id=?').run('card', id)
    messages.create(id, 'user', '问题', 'complete')
    messages.create(id, 'assistant', '回答', 'complete', undefined, 'historic-session')
    const disposeConversation = vi.fn()
      .mockRejectedValueOnce(new Error('暂时无法清理'))
      .mockResolvedValue(undefined)
    const cleanup = new DshSessionCleanupRepository(database, messages, { disposeConversation })
    conversations.registerDeleteCleanup(cleanup)

    conversations.deleteForCharacter('card')
    await cleanup.drainAsync()
    expect(conversations.exists(id)).toBe(false)
    expect(database.native.prepare("SELECT count(*) AS count FROM cleanup_operations WHERE kind='dsh_conversation_session'").get())
      .toEqual({ count: 1 })

    await cleanup.drainAsync()
    expect(disposeConversation).toHaveBeenCalledWith(id, expect.arrayContaining([id, 'historic-session']))
    expect(database.native.prepare("SELECT count(*) AS count FROM cleanup_operations WHERE kind='dsh_conversation_session'").get())
      .toEqual({ count: 0 })
  } finally {
    database.close()
  }
})
