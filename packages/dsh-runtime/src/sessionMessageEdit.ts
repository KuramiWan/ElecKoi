import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { readDshSessionLog } from './trajectory'

type MessageRole = 'user' | 'assistant'

/** Edit the selected persisted message while preserving every other Session event. */
export function editDshSessionMessage(
  sessionRoot: string, sessionId: string, messageId: string, role: MessageRole, content: string
): void {
  if (!messageId || !content.trim()) throw new Error('消息内容不能为空。')
  const log = readDshSessionLog(sessionRoot, sessionId)
  if (!log) throw new Error('找不到要编辑的 DSH 会话。')
  if (log.header.isSeeded || log.inheritedEventCount !== 0) {
    throw new Error('不能直接修改继承了父会话事件的 DSH 子会话。')
  }
  if (log.header.version !== sessionFormatCatalog.currentVersion
    || basename(log.path) !== `session.v${sessionFormatCatalog.currentVersion}.jsonl`) {
    throw new Error('DSH 会话必须先迁移到当前格式，才能编辑消息。')
  }
  const type = role === 'user' ? 'user/message' : 'assistant/message'
  const matches = log.events.filter((event) => event.type === type
    && event.surfaceOp === 'append'
    && isRecord(event.data)
    && (role === 'user' ? event.data : event.data.message)?.id === messageId)
  if (matches.length !== 1) throw new Error('找不到唯一对应的消息；原聊天记录未修改。')
  const selected = matches[0]!
  const data = selected.data as Record<string, unknown>
  const message = (role === 'user' ? data : data.message) as Record<string, unknown>
  if (message.role !== role || !Array.isArray(message.content)) {
    throw new Error('消息角色或内容与编辑目标不一致；原聊天记录未修改。')
  }
  let replaced = false
  const blocks = message.content.flatMap((part: unknown) => {
    if (!isRecord(part) || part.type !== 'text') return [part]
    if (replaced) return []
    replaced = true
    return [{ ...part, text: content }]
  })
  if (!replaced) blocks.unshift({ type: 'text', text: content })
  const editedMessage = { ...message, content: blocks }
  const editedData = role === 'user' ? editedMessage : { ...data, message: editedMessage }
  const events = log.events.map((event) => event === selected
    ? { ...event, data: editedData } as typeof event : event)
  const rows = [sessionFormatCatalog.encodeCurrentHeader(log.header, log.inheritedEventCount),
    ...events.map((event) => sessionFormatCatalog.encodeCurrentEvent(event))]
  const serialized = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  const restore = sessionFormatCatalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' })
  for (const row of rows.slice(1)) restore.decodeRow(row)
  const verified = restore.finish()
  if (verified.header.id !== sessionId || verified.events.length !== events.length) {
    throw new Error('编辑后的 DSH 会话验证失败；原聊天记录未修改。')
  }

  const revision = statSync(log.path, { bigint: true })
  const suffix = randomUUID()
  const temporary = `${log.path}.${suffix}.tmp`
  const backup = `${log.path}.${suffix}.bak`
  let committed = false
  let retainBackup = false
  try {
    writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' })
    const current = statSync(log.path, { bigint: true })
    if (current.dev !== revision.dev || current.ino !== revision.ino
      || current.size !== revision.size || current.mtimeNs !== revision.mtimeNs
      || current.ctimeNs !== revision.ctimeNs) {
      throw new Error('DSH 会话日志在编辑期间发生变化；原聊天记录未修改。')
    }
    copyFileSync(log.path, backup)
    renameSync(temporary, log.path)
    committed = true
    const reread = readDshSessionLog(sessionRoot, sessionId)
    if (!reread || reread.events.length !== events.length
      || !reread.events.some((event) => event.seq === selected.seq
        && isRecord(event.data)
        && (role === 'user' ? event.data : event.data.message)?.id === messageId)) {
      throw new Error('编辑后的 DSH 会话无法读取。')
    }
  } catch (error) {
    if (committed && existsSync(backup)) {
      try { renameSync(backup, log.path) } catch (restoreError) {
        retainBackup = true
        throw new Error(`编辑失败，原始会话日志保存在 ${backup}。`, { cause: restoreError })
      }
    }
    throw error
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true })
    if (!retainBackup && existsSync(backup)) rmSync(backup, { force: true })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
