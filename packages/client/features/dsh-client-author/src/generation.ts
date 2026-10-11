import type { AuthorEventMap, AuthorEventName, AuthorGenerationIdentity, AuthorGenerationStats } from '@eleckoi/author-sdk'
import type { ElecKoiConversations, ConversationGenerationChange, ConversationGenerationEvent, ConversationStatsSnapshot } from '@eleckoi/dsh-client-conversations/client'
import { publicMessage } from './messages.js'

export function nativeGenerationStats(source: ConversationStatsSnapshot['stats']): AuthorGenerationStats | null {
  if (!source || !Object.values(source).some(value => value !== undefined)) return null
  return structuredClone({ ...source.sessionStats,
    ...(source.tokenUsage === undefined ? {} : { tokenUsage: source.tokenUsage }),
    ...(source.contextPressure === undefined ? {} : { contextPressure: source.contextPressure }),
    ...(source.contextBreakdown === undefined ? {} : { contextBreakdown: source.contextBreakdown }),
  })
}

type EndReason = Extract<ConversationGenerationEvent, { type: 'turn/end' }>['data']['reason']
interface Observation {
  identity: AuthorGenerationIdentity
  startSeq: number
  assistantSeq?: number
  ended?: EndReason
  finishing: boolean
  messageId: string
  content: string
  sequence: number
  state: 'starting' | 'streaming'
  process: Map<string, string>
  statsKey: string
}

/** Observes current official events; it neither owns a transcript nor writes generation history. */
export class NativeGenerationEvents {
  private readonly observations = new Map<number, Observation>()
  private readonly stops: Array<() => void> = []
  private owner = ''
  private closed = false

  constructor(private readonly conversations: ElecKoiConversations,
    private readonly createId: () => string,
    private readonly emit: <T extends AuthorEventName>(name: T, payload: AuthorEventMap[T]) => void,
    private readonly report: (error: unknown) => void) {}

  start(): void {
    this.stops.push(this.conversations.subscribeGeneration(change => this.accept(change)),
      this.conversations.subscribeStream(() => this.reconcile()),
      this.conversations.subscribeDetails(() => this.reconcile()),
      this.conversations.subscribeStats(() => this.publishStats()))
  }

  identity(): (Pick<AuthorGenerationIdentity, 'generationId' | 'turn'> & { sequence: number }) | null {
    const stream = this.conversations.getStreamSnapshot(), record = this.observations.get(stream.dshTurn!)
    return record && !record.ended && record.identity.conversationId === stream.id && record.identity.runId === stream.runId
      ? { generationId: record.identity.generationId, turn: record.identity.turn, sequence: record.sequence } : null
  }

  private accept(change: ConversationGenerationChange): void {
    if (this.closed) return
    const owner = JSON.stringify([change.conversationId, change.runtimeSessionId])
    if (change.kind === 'released') {
      if (owner === this.owner) { this.observations.clear(); this.owner = '' }
      return
    }
    if (owner !== this.owner) { this.observations.clear(); this.owner = owner }
    if (change.kind === 'baseline') {
      const starts = change.events.filter(event => event.type === 'turn/start')
      for (const [turn, record] of this.observations) {
        if (!starts.some(event => event.data.turn === turn && event.seq === record.startSeq)) this.observations.delete(turn)
      }
      // A loaded completed turn is never replayed as a new run. One currently
      // running, formally open turn may be observed when attaching mid-run.
      const ended = new Set(change.events.filter(event => event.type === 'turn/end').map(event => event.data.turn))
      const open = starts.filter(event => !ended.has(event.data.turn))
      if (change.running && open.length === 1 && !this.observations.has(open[0]!.data.turn)) this.begin(change, open[0]!)
    }
    for (const event of change.events) {
      if (event.type === 'turn/start') {
        if (change.kind === 'live') this.begin(change, event)
        continue
      }
      const record = this.observations.get(event.data.turn)
      if (!record) continue
      if (event.type === 'assistant/message') record.assistantSeq = event.seq
      else if (!record.ended) {
        record.ended = event.data.reason
        this.complete(record)
      }
    }
    this.reconcile()
  }

  private begin(change: ConversationGenerationChange, event: Extract<ConversationGenerationEvent, { type: 'turn/start' }>): void {
    if (this.observations.get(event.data.turn)?.startSeq === event.seq) return
    const baseline = this.conversations.getStatsSnapshot()
    const stats = baseline.id === change.conversationId ? nativeGenerationStats(baseline.stats) : null
    const record: Observation = { identity: { conversationId: change.conversationId, runId: change.runtimeSessionId,
      generationId: this.createId(), turn: event.data.turn }, startSeq: event.seq, finishing: false,
      messageId: '', content: '', sequence: 0, state: 'starting', process: new Map(), statsKey: stats ? JSON.stringify(stats) : '' }
    this.observations.set(event.data.turn, record)
    this.emit('agent.state.changed', { ...record.identity, state: 'starting' })
  }

  private current(record: Observation): boolean {
    const selected = this.conversations.getDetailsSnapshot()
    return !this.closed && this.observations.get(record.identity.turn) === record
      && selected.id === record.identity.conversationId && selected.details?.runtimeSessionId === record.identity.runId
  }

  private reconcile(): void {
    const stream = this.conversations.getStreamSnapshot()
    for (const record of this.observations.values()) {
      if (!this.current(record)) continue
      if (stream.id === record.identity.conversationId && stream.runId === record.identity.runId && stream.dshTurn === record.identity.turn) {
        record.messageId = stream.messageId
        if (!record.ended && stream.status === 'error') {
          this.emit('agent.run.failed', { ...record.identity, messageId: record.messageId, code: 'GENERATION_FAILED', message: stream.error })
          this.retire(record, 'error', stream.error); continue
        }
        if (!record.ended && stream.status === 'running') {
          if (record.state !== 'streaming') {
            record.state = 'streaming'; this.emit('agent.state.changed', { ...record.identity, state: 'streaming' })
          }
          if (stream.content !== record.content) {
            const operation = stream.content.startsWith(record.content) ? 'append' : 'replace'
            const delta = operation === 'append' ? stream.content.slice(record.content.length) : stream.content
            record.content = stream.content; record.sequence++
            this.emit('agent.output.delta', { ...record.identity, messageId: record.messageId,
              sequence: record.sequence, operation, delta, accumulated: record.content })
          }
          for (const item of stream.process) {
            const key = JSON.stringify(item)
            if (record.process.get(item.id) === key) continue
            record.process.set(item.id, key)
            this.emit('agent.process.updated', { ...record.identity, messageId: record.messageId, item })
          }
        }
      }
      if (record.ended) this.complete(record)
    }
    this.publishStats()
  }

  private publishStats(): void {
    const snapshot = this.conversations.getStatsSnapshot(), stats = nativeGenerationStats(snapshot.stats)
    if (!stats) return
    const stream = this.conversations.getStreamSnapshot(), record = this.observations.get(stream.dshTurn!)
    if (!record || record.ended || !this.current(record) || snapshot.id !== record.identity.conversationId
      || stream.id !== snapshot.id || stream.runId !== record.identity.runId) return
    const key = JSON.stringify(stats)
    if (record.statsKey === key) return
    record.statsKey = key; this.emit('agent.generation.stats', { ...record.identity, stats })
  }

  private retire(record: Observation, state: 'idle' | 'error', detail?: string): void {
    this.observations.delete(record.identity.turn)
    if (![...this.observations.values()].some(item => !item.ended)) this.emit('agent.state.changed', {
      ...record.identity, state, ...(detail === undefined ? {} : { detail }),
    })
  }

  private complete(record: Observation): void {
    if (!record.ended || record.finishing || !this.current(record)) return
    const reason = record.ended
    if (reason.kind === 'aborted' || reason.kind === 'interrupted' || reason.kind === 'forked') {
      this.emit('agent.run.cancelled', { ...record.identity, messageId: record.messageId,
        reason: reason.kind === 'aborted' ? 'cancelled' : 'interrupted' })
      this.retire(record, 'idle'); return
    }
    if (reason.kind === 'error') {
      this.emit('agent.run.failed', { ...record.identity, messageId: record.messageId, code: reason.error.code, message: reason.error.message })
      this.retire(record, 'error', reason.error.message); return
    }
    if (!['completed', 'max-tokens', 'blocked'].includes(reason.kind)) {
      const message = `不支持的生成结束原因：${reason.kind}`
      this.emit('agent.run.failed', { ...record.identity, messageId: record.messageId, code: 'UNSUPPORTED_GENERATION_OUTCOME', message })
      this.retire(record, 'error', message); return
    }
    const outcome = reason.kind === 'max-tokens' ? 'output-limit' : reason.kind === 'blocked' ? 'blocked' : 'completed'
    if (record.assistantSeq === undefined) {
      this.emit('agent.run.finished', { ...record.identity, reason: outcome, message: null })
      this.retire(record, 'idle'); return
    }
    const reply = this.conversations.getGenerationReply(record.identity.runId, record.identity.turn, record.assistantSeq)
    if (reply.status === 'pending') return
    if (reply.status === 'unavailable') {
      this.emit('agent.run.failed', { ...record.identity, messageId: record.messageId, code: 'GENERATION_MESSAGE_UNAVAILABLE', message: reply.reason })
      this.retire(record, 'error', reply.reason); return
    }
    if (!reply.message) {
      this.emit('agent.run.finished', { ...record.identity, reason: outcome, message: null })
      this.retire(record, 'idle'); return
    }
    record.finishing = true
    void publicMessage(this.conversations, record.identity.conversationId, reply.message).then(message => {
      if (!this.current(record)) return
      this.emit('agent.run.finished', { ...record.identity, reason: outcome, message })
      this.retire(record, 'idle')
    }).catch(error => {
      if (!this.current(record)) return
      this.report(error)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('agent.run.failed', { ...record.identity, messageId: record.messageId, code: 'GENERATION_MESSAGE_UNAVAILABLE', message })
      this.retire(record, 'error', message)
    })
  }

  dispose(): void {
    this.closed = true; this.stops.splice(0).forEach(stop => stop()); this.observations.clear()
  }
}
