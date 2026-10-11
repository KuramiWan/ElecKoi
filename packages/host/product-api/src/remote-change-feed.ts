interface RemoteChangeSubscriber<T> {
  readonly queue: T[]
  closed: boolean
  waiter: (() => void) | undefined
}

/**
 * Host-owned notification feed for product projection changes.
 *
 * It carries no message history and has no replay state. Each Remote stream
 * starts with a snapshot marker so a reconnecting Client can refresh its
 * authoritative DSH Session/product projections before accepting deltas.
 */
export class RemoteChangeFeed<T> {
  private readonly subscribers = new Set<RemoteChangeSubscriber<T>>()

  constructor(private readonly snapshot: T) {}

  stream(signal: AbortSignal): AsyncIterable<T> {
    const subscriber: RemoteChangeSubscriber<T> = {
      queue: [this.snapshot],
      closed: false,
      waiter: undefined
    }
    this.subscribers.add(subscriber)
    const close = (): void => {
      if (subscriber.closed) return
      subscriber.closed = true
      this.subscribers.delete(subscriber)
      subscriber.waiter?.()
      subscriber.waiter = undefined
    }
    const abort = (): void => close()
    if (signal.aborted) close()
    else signal.addEventListener('abort', abort, { once: true })

    return (async function* (): AsyncIterable<T> {
      try {
        while (!subscriber.closed) {
          if (subscriber.queue.length > 0) {
            yield subscriber.queue.shift() as T
            continue
          }
          await new Promise<void>((resolve) => { subscriber.waiter = resolve })
          subscriber.waiter = undefined
        }
      } finally {
        signal.removeEventListener('abort', abort)
        close()
      }
    })()
  }

  publish(change: T): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.closed) continue
      subscriber.queue.push(change)
      subscriber.waiter?.()
      subscriber.waiter = undefined
    }
  }

  close(): void {
    for (const subscriber of this.subscribers) subscriber.closed = true
    for (const subscriber of this.subscribers) subscriber.waiter?.()
    this.subscribers.clear()
  }
}
