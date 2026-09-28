import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { readDshSessionLog } from './trajectory'

export class DshSessionRewindUnavailableError extends Error {}

/**
 * Rewrite a closed root Session up to (but excluding) the requested turn.
 * The caller must first dispose every active DSH handle for this Session.
 */
export function rewindDshSession(sessionRoot: string, sessionId: string, fromTurn: number): number {
  if (!Number.isSafeInteger(fromTurn) || fromTurn < 1) throw new Error('DSH 回退轮次必须是正整数。')
  const log = readDshSessionLog(sessionRoot, sessionId)
  if (log === undefined) throw new DshSessionRewindUnavailableError('找不到要回退的 DSH 会话。')
  if (log.header.isSeeded || log.inheritedEventCount !== 0) {
    throw new DshSessionRewindUnavailableError('不能直接回退继承了父会话事件的 DSH 子会话。')
  }
  if (log.header.version !== sessionFormatCatalog.currentVersion
    || basename(log.path) !== `session.v${sessionFormatCatalog.currentVersion}.jsonl`) {
    throw new DshSessionRewindUnavailableError('DSH 会话必须先由官方格式迁移到当前版本，才能回退。')
  }
  const turnStart = log.events.findIndex((event) => event.type === 'turn/start'
    && isRecord(event.data) && event.data.turn === fromTurn)
  if (turnStart < 0) {
    const lastStarted = log.events.reduce((last, event) => event.type === 'turn/start'
      && isRecord(event.data) && typeof event.data.turn === 'number'
      && Number.isSafeInteger(event.data.turn) ? Math.max(last, event.data.turn) : last, 0)
    if (fromTurn !== lastStarted + 1) throw new Error(`DSH 会话没有第 ${fromTurn} 轮。`)
  }
  // DSH queues a user prompt before turn/start. Keeping those interstitial
  // inbox events would replay the discarded prompt after regeneration.
  let previousTurnEnd = -1
  if (fromTurn > 1) {
    for (let index = (turnStart < 0 ? log.events.length : turnStart) - 1; index >= 0; index -= 1) {
      const event = log.events[index]
      if (event?.type === 'turn/end' && isRecord(event.data) && event.data.turn === fromTurn - 1) {
        previousTurnEnd = index
        break
      }
    }
  }
  if (fromTurn > 1 && previousTurnEnd < 0) {
    throw new Error(`DSH 会话第 ${fromTurn - 1} 轮尚未结束，不能回退。`)
  }
  const cut = previousTurnEnd + 1
  const retained = log.events.slice(0, cut)
  if (retained.at(-1)?.type === 'turn/start' || retained.at(-1)?.type === 'step/start') {
    throw new Error('DSH 会话上一轮尚未结束，不能回退。')
  }
  const rows = [
    sessionFormatCatalog.encodeCurrentHeader(log.header, log.inheritedEventCount),
    ...retained.map((event) => sessionFormatCatalog.encodeCurrentEvent(event))
  ]
  const serialized = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  verifyEncodedLog(serialized, sessionId, retained.length)

  const revision = statSync(log.path, { bigint: true })
  const suffix = randomUUID()
  const temporary = `${log.path}.${suffix}.tmp`
  const backup = `${log.path}.${suffix}.bak`
  let replaced = false
  let retainBackup = false
  try {
    writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' })
    const current = statSync(log.path, { bigint: true })
    if (current.dev !== revision.dev || current.ino !== revision.ino
      || current.size !== revision.size || current.mtimeNs !== revision.mtimeNs
      || current.ctimeNs !== revision.ctimeNs) {
      throw new Error('DSH 会话日志在回退准备期间发生变化。')
    }
    copyFileSync(log.path, backup)
    renameSync(temporary, log.path)
    replaced = true
    const restored = readDshSessionLog(sessionRoot, sessionId)
    if (restored === undefined || restored.events.length !== retained.length
      || restored.header.id !== sessionId) {
      throw new Error('回退后的 DSH 会话验证失败。')
    }
  } catch (error) {
    if (replaced && existsSync(backup)) {
      try { renameSync(backup, log.path) } catch (restoreError) {
        retainBackup = true
        throw new Error(`DSH 会话回退失败，原始日志保存在 ${backup}。`, { cause: restoreError })
      }
    }
    throw error
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true })
    if (!retainBackup && existsSync(backup)) rmSync(backup, { force: true })
  }
  return cut
}

function verifyEncodedLog(source: string, sessionId: string, eventCount: number): void {
  const lines = source.trimEnd().split('\n')
  const restore = sessionFormatCatalog.createRestore(JSON.parse(lines[0] ?? ''), {
    recovery: 'strict', validation: 'current'
  })
  for (const line of lines.slice(1)) restore.decodeRow(JSON.parse(line))
  const result = restore.finish()
  if (result.header.id !== sessionId || result.events.length !== eventCount) {
    throw new Error('DSH 回退生成了无效的会话日志。')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
