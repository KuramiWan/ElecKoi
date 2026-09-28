import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

type StatsWriter = (path: string, data: string) => Promise<void>

interface PendingWrite {
  latest: string | undefined
  writing: Promise<void> | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  discarded: boolean
}

const WRITE_INTERVAL_MS = 250
const RETRY_INTERVAL_MS = 2_000
const RETRY_DELAYS_MS = [25, 75, 150]

/** A failed statistics checkpoint never changes the outcome of an Agent run. */
export class GenerationStatsPersistence {
  private readonly pending = new Map<string, PendingWrite>()
  private closed = false

  constructor(
    private readonly write: StatsWriter = writeAtomicStats,
    private readonly warn: (message: string) => void = (message) => console.warn(message)
  ) {}

  schedule(path: string, data: string): void {
    if (this.closed) return
    const entry = this.pending.get(path) ?? {
      latest: undefined,
      writing: undefined,
      timer: undefined,
      discarded: false
    }
    if (entry.discarded) return
    entry.latest = data
    this.pending.set(path, entry)
    this.arm(path, entry, WRITE_INTERVAL_MS)
  }

  async flush(path: string): Promise<void> {
    const entry = this.pending.get(path)
    if (entry === undefined || entry.discarded) return
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer)
      entry.timer = undefined
    }
    if (entry.writing !== undefined) await entry.writing
    if (entry.discarded || entry.latest === undefined) return

    const data = entry.latest
    entry.latest = undefined
    const task = this.writeWithRetry(path, data).then((error) => {
      if (entry.discarded) return
      if (error !== undefined) {
        if (entry.latest === undefined) entry.latest = data
        this.warn(`Generation statistics checkpoint could not be saved at ${path}: ${String(error)}`)
      }
      if (entry.latest !== undefined) {
        this.arm(path, entry, error === undefined ? WRITE_INTERVAL_MS : RETRY_INTERVAL_MS)
      } else {
        this.pending.delete(path)
      }
    })
    entry.writing = task
    try {
      await task
    } finally {
      if (entry.writing === task) entry.writing = undefined
    }
  }

  async discard(path: string): Promise<void> {
    const entry = this.pending.get(path)
    if (entry === undefined) return
    entry.discarded = true
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    if (entry.writing !== undefined) await entry.writing
    this.pending.delete(path)
  }

  async discardDirectory(directory: string): Promise<void> {
    await Promise.all([...this.pending.keys()]
      .filter((path) => path.startsWith(`${directory}${sep}`))
      .map((path) => this.discard(path)))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([...this.pending.keys()].map((path) => this.flush(path)))
    for (const entry of this.pending.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
    }
    this.pending.clear()
  }

  private arm(path: string, entry: PendingWrite, delayMs: number): void {
    if (this.closed || entry.discarded || entry.timer !== undefined) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      void this.flush(path)
    }, delayMs)
    entry.timer.unref?.()
  }

  private async writeWithRetry(path: string, data: string): Promise<unknown | undefined> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.write(path, data)
        return undefined
      } catch (error) {
        if (!isTransientFileError(error) || attempt >= RETRY_DELAYS_MS.length) return error
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
      }
    }
  }
}

function isTransientFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

async function writeAtomicStats(path: string, data: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
    if (process.platform !== 'win32') {
      const handle = await open(directory, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
