import { FrontendCompatibilityError } from './common'

type Listener = (...args: any[]) => unknown
type Subscription = { listener: Listener; once: boolean }

/** Each document owns its subscriptions and never removes another document's listeners. */
export class FrontendEvents {
  private readonly subscriptions = new Map<string, Subscription[]>()
  private closed = false
  constructor(private readonly report: (error: unknown) => void) {}
  on(event: string, listener: Listener, once = false, first = false): { stop(): void } {
    if (this.closed) throw new FrontendCompatibilityError('FRAME_CLOSED', '兼容页面已关闭。')
    if (typeof event !== 'string' || !event || typeof listener !== 'function') throw new TypeError('事件需要有效名称与回调。')
    const entries = this.subscriptions.get(event) || []
    if (!entries.some(entry => entry.listener === listener)) {
      const entry = { listener, once }; first ? entries.unshift(entry) : entries.push(entry)
      this.subscriptions.set(event, entries)
    }
    return { stop: () => this.off(event, listener) }
  }
  off(event: string, listener: Listener): void {
    const entries = (this.subscriptions.get(event) || []).filter(entry => entry.listener !== listener)
    if (entries.length) this.subscriptions.set(event, entries); else this.subscriptions.delete(event)
  }
  move(event: string, listener: Listener, first: boolean): { stop(): void } {
    const existing = this.subscriptions.get(event)?.find(entry => entry.listener === listener)
    this.off(event, listener)
    return this.on(event, listener, existing?.once, first)
  }
  async emit(event: string, args: unknown[], serial = false): Promise<void> {
    if (this.closed) return
    const calls: Promise<unknown>[] = []
    for (const entry of [...(this.subscriptions.get(event) || [])]) {
      if (this.closed || !this.subscriptions.get(event)?.includes(entry)) continue
      if (entry.once) this.off(event, entry.listener)
      if (serial) await entry.listener(...args)
      else { try { calls.push(Promise.resolve(entry.listener(...args))) } catch (error) { calls.push(Promise.reject(error)) } }
    }
    await Promise.all(calls)
  }
  publish(event: string, ...args: unknown[]): void { void this.emit(event, args).catch(this.report) }
  clearEvent(event: string): void { this.subscriptions.delete(event) }
  clearListener(listener: Listener): void { for (const event of this.subscriptions.keys()) this.off(event, listener) }
  clearAll(): void { this.subscriptions.clear() }
  close(): void { this.closed = true; this.clearAll() }
}

export const tavernEvents = Object.freeze({ CHAT_CHANGED: 'chat_id_changed', MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received', MESSAGE_UPDATED: 'message_updated', MESSAGE_EDITED: 'message_edited',
  MESSAGE_DELETED: 'message_deleted', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped', STREAM_TOKEN_RECEIVED: 'stream_token_received' })
