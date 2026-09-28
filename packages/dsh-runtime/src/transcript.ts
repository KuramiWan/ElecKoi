import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveTurnTokenUsage, type TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { DshProcessProjector, finalReplyText } from './notifications'
import { readDshSessionLog, type DshSessionEventRecord } from './trajectory'
import type { DshFileAttachmentRef, DshImageAttachmentRef, DshProcessItem } from './types'

export interface DshTranscriptTurn {
  turn: number
  startSeq: number
  userSeq: number | null
  userMessageId: string | null
  userText: string
  userImages: DshImageAttachmentRef[]
  userFiles: DshFileAttachmentRef[]
  assistantSeq: number | null
  assistantMessageId: string | null
  assistantText: string
  process: DshProcessItem[]
  completed: boolean
  turnUsage?: TurnTokenUsage
}

/** The persisted message and process projection of one DSH Session. */
export function readDshTranscript(sessionRoot: string, sessionId: string): DshTranscriptTurn[] | undefined {
  const log = readDshSessionLog(sessionRoot, sessionId)
  return log === undefined ? undefined : projectDshTranscript(log.events, sessionId)
}

export function projectDshTranscript(events: readonly DshSessionEventRecord[], sessionId = ''): DshTranscriptTurn[] {
  const turns = new Map<number, DshTranscriptTurn>()
  const turnEvents = new Map<number, DshSessionEventRecord[]>()
  const processProjector = new DshProcessProjector(sessionId)
  let activeTurn = 0
  for (const event of events) {
    const data = record(event.data)
    const declaredTurn = positiveInteger(data.turn)
    if (event.type === 'turn/start') activeTurn = declaredTurn ?? 0
    const turnNumber = declaredTurn ?? activeTurn
    if (turnNumber === 0) continue
    let turn: DshTranscriptTurn | undefined = turns.get(turnNumber)
    if (event.type === 'turn/start') {
      turnEvents.set(turnNumber, [event])
      const started: DshTranscriptTurn = {
        turn: turnNumber, startSeq: nonnegativeInteger(event.seq) ?? 0, userSeq: null, userMessageId: null, userText: '', userImages: [], userFiles: [],
        assistantSeq: null, assistantMessageId: null, assistantText: '', process: [], completed: false
      }
      turn = started
      turns.set(turnNumber, started)
    }
    if (turn === undefined) continue
    if (event.type !== 'turn/start') turnEvents.get(turnNumber)?.push(event)
    if (event.type === 'user/message' && event.surfaceOp === 'append') {
      const message = data.message && typeof data.message === 'object' ? record(data.message) : data
      const source = record(message.source)
      if (source.kind === 'user') {
        turn.userSeq = nonnegativeInteger(event.seq) ?? null
        turn.userMessageId = typeof message.id === 'string' && message.id ? message.id : null
        turn.userText = textContent(message.content)
        turn.userImages = imageContent(message.content)
        turn.userFiles = fileContent(message.content)
      }
    } else if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
      const message = record(data.message)
      const blocks = Array.isArray(message.content) ? message.content : []
      if (!blocks.some((block) => record(block).type === 'tool-call')) {
        turn.assistantSeq = nonnegativeInteger(event.seq) ?? null
        turn.assistantMessageId = typeof message.id === 'string' && message.id ? message.id : null
        turn.assistantText = finalReplyText(textContent(blocks))
      }
    } else if (event.type === 'turn/end') {
      turn.completed = true
      const usage = deriveTurnTokenUsage(turnEvents.get(turnNumber) as SessionEvent[])
      if (usage) turn.turnUsage = usage
      turnEvents.delete(turnNumber)
      activeTurn = 0
    }
    const projected = processProjector.project({
      method: 'session.event',
      params: { sessionId, event }
    } as HarnessNotification)
    if (projected !== undefined) {
      const index = turn.process.findIndex((item) => item.id === projected.id)
      if (index < 0) turn.process.push(projected)
      else turn.process[index] = projected
    }
  }
  return [...turns.values()]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.filter((part) => record(part).type === 'text')
    .map((part) => String(record(part).text ?? '')).join('')
}

function imageContent(value: unknown): DshImageAttachmentRef[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((part) => {
    const block = record(part)
    if (block.type !== 'image') return []
    const attachment = record(block.attachment)
    if (typeof attachment.attachmentId !== 'string' || !attachment.attachmentId
      || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(attachment.mediaType))
      || !Number.isSafeInteger(attachment.bytes) || Number(attachment.bytes) <= 0
      || !Number.isSafeInteger(attachment.width) || Number(attachment.width) <= 0
      || !Number.isSafeInteger(attachment.height) || Number(attachment.height) <= 0) return []
    return [attachment as unknown as DshImageAttachmentRef]
  })
}

function fileContent(value: unknown): DshFileAttachmentRef[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((part) => {
    const block = record(part)
    if (block.type !== 'file') return []
    const attachment = record(block.attachment)
    if (typeof attachment.attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(attachment.attachmentId)
      || typeof attachment.name !== 'string' || !attachment.name
      || !Number.isSafeInteger(attachment.bytes) || Number(attachment.bytes) < 0) return []
    return [attachment as unknown as DshFileAttachmentRef]
  })
}
