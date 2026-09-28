import { isAbsolute, join, relative } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAttachmentCleanupRepository } from '../src/main/modules/agent/AgentAttachmentCleanupRepository'
import { ConversationRepository } from '../src/main/modules/conversations/ConversationRepository'
import { MessageRepository } from '../src/main/modules/conversations/MessageRepository'
import { SqliteDatabase } from '../src/main/platform/sqlite/SqliteDatabase'

const temporaryDirectories: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    const child = relative(tmpdir(), directory)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected test cleanup path')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('chat attachment cleanup', () => {
  it('queues the same uploaded file only once across repeated notifications', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-file-cleanup-'))
    temporaryDirectories.push(directory)
    const database = new SqliteDatabase(join(directory, 'eleckoi.sqlite3'))
    database.open()
    databases.push(database)
    const cleanup = new AgentAttachmentCleanupRepository(
      database,
      { removeImage: vi.fn(), removeFile: vi.fn() },
      new MessageRepository(database)
    )
    const file = { attachmentId: `sha256:${'d'.repeat(64)}`, name: 'draft.md', bytes: 5 }

    cleanup.queueFiles([file, file])
    cleanup.queueFiles([file])

    expect(database.native.prepare("SELECT count(*) AS count FROM cleanup_operations WHERE kind='dsh_file_attachment'").get())
      .toEqual({ count: 1 })
  })

  it('reclaims a staged upload with no message after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-file-cleanup-'))
    temporaryDirectories.push(directory)
    const database = new SqliteDatabase(join(directory, 'eleckoi.sqlite3'))
    database.open()
    databases.push(database)
    const messages = new MessageRepository(database)
    const removeFile = vi.fn()
    const file = { attachmentId: `sha256:${'e'.repeat(64)}`, name: 'draft.md', bytes: 5 }
    const cleanup = new AgentAttachmentCleanupRepository(database, { removeImage: vi.fn(), removeFile }, messages)
    cleanup.queueFiles([file])

    const restartedCleanup = new AgentAttachmentCleanupRepository(database, { removeImage: vi.fn(), removeFile }, messages)
    restartedCleanup.drain()

    expect(removeFile).toHaveBeenCalledWith(file, false)
  })

  it('retains a shared file until its final chat is deleted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-file-cleanup-'))
    temporaryDirectories.push(directory)
    const database = new SqliteDatabase(join(directory, 'eleckoi.sqlite3'))
    database.open()
    databases.push(database)
    const conversations = new ConversationRepository(database)
    const messages = new MessageRepository(database)
    const removeFile = vi.fn()
    const cleanup = new AgentAttachmentCleanupRepository(database, { removeImage: vi.fn(), removeFile }, messages)
    conversations.registerDeleteCleanup(cleanup)
    const first = conversations.create({}).conversation.id
    const second = conversations.create({}).conversation.id
    const file = { attachmentId: `sha256:${'f'.repeat(64)}`, name: 'notes.md', bytes: 5 }
    messages.create(first, 'user', '', 'complete', undefined, '', [], [file])
    messages.create(second, 'user', '', 'complete', undefined, '', [], [file])
    cleanup.queueFiles([file])
    cleanup.drain()
    expect(removeFile).not.toHaveBeenCalled()

    await conversations.delete(first)
    expect(removeFile).not.toHaveBeenCalled()
    await conversations.delete(second)
    expect(removeFile).toHaveBeenCalledOnce()
    expect(removeFile).toHaveBeenCalledWith(file, false)
  })

  it('removes a prepared image that never became a message attachment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-image-cleanup-'))
    temporaryDirectories.push(directory)
    const database = new SqliteDatabase(join(directory, 'eleckoi.sqlite3'))
    database.open()
    databases.push(database)
    const removeImage = vi.fn()
    const cleanup = new AgentAttachmentCleanupRepository(
      database,
      { removeImage },
      new MessageRepository(database)
    )
    const attachmentId = 'sha256:' + 'a'.repeat(64)

    cleanup.discardPrepared([attachmentId, attachmentId])

    expect(removeImage).toHaveBeenCalledOnce()
    expect(removeImage).toHaveBeenCalledWith(attachmentId)
    expect(database.native.prepare("SELECT * FROM cleanup_operations WHERE kind='dsh_image_attachment'").all()).toEqual([])
  })

  it('removes an image after its last referencing conversation is deleted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-image-cleanup-'))
    temporaryDirectories.push(directory)
    const database = new SqliteDatabase(join(directory, 'eleckoi.sqlite3'))
    database.open()
    databases.push(database)
    const conversations = new ConversationRepository(database)
    const messages = new MessageRepository(database)
    const removeImage = vi.fn()
    const cleanup = new AgentAttachmentCleanupRepository(database, { removeImage }, messages)
    conversations.registerDeleteCleanup(cleanup)
    const first = conversations.create({}).conversation.id
    const second = conversations.create({}).conversation.id
    const image = {
      attachmentId: `sha256:${'b'.repeat(64)}`,
      mediaType: 'image/png' as const,
      bytes: 68,
      width: 1,
      height: 1
    }
    messages.create(first, 'user', '', 'complete', undefined, '', [image])
    messages.create(second, 'user', '', 'complete', undefined, '', [image])

    await conversations.delete(first)
    expect(removeImage).not.toHaveBeenCalled()

    await conversations.delete(second)
    expect(removeImage).toHaveBeenCalledOnce()
    expect(removeImage).toHaveBeenCalledWith(image.attachmentId)
    expect(database.native.prepare("SELECT * FROM cleanup_operations WHERE kind='dsh_image_attachment'").all()).toEqual([])
  })

  it('keeps a failed deletion queued for the next cleanup pass', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-image-cleanup-'))
    temporaryDirectories.push(directory)
    const database = new SqliteDatabase(join(directory, 'eleckoi.sqlite3'))
    database.open()
    databases.push(database)
    const conversations = new ConversationRepository(database)
    const messages = new MessageRepository(database)
    const removeImage = vi.fn(() => { throw new Error('locked') })
    const cleanup = new AgentAttachmentCleanupRepository(database, { removeImage }, messages)
    conversations.registerDeleteCleanup(cleanup)
    const conversationId = conversations.create({}).conversation.id
    const image = {
      attachmentId: `sha256:${'c'.repeat(64)}`,
      mediaType: 'image/png' as const,
      bytes: 68,
      width: 1,
      height: 1
    }
    messages.create(conversationId, 'user', '', 'complete', undefined, '', [image])

    await conversations.delete(conversationId)

    expect(database.native.prepare("SELECT state,attemptCount,lastError FROM cleanup_operations WHERE kind='dsh_image_attachment'").get())
      .toMatchObject({ state: 'failed', attemptCount: 1, lastError: expect.stringContaining('locked') })

    const replacementConversationId = conversations.create({}).conversation.id
    messages.create(replacementConversationId, 'user', '', 'complete', undefined, '', [image])
    removeImage.mockClear()
    cleanup.drain()

    expect(removeImage).not.toHaveBeenCalled()
    expect(database.native.prepare("SELECT * FROM cleanup_operations WHERE kind='dsh_image_attachment'").all()).toEqual([])
  })
})
