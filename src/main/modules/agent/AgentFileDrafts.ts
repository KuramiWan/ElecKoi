import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { AgentInputFile } from '@shared/contracts/agent/runtime'

interface Draft extends AgentInputFile {
  written: number
  complete: boolean
}

/** Bounded Gateway intake; the file-upload plugin consumes these paths on send. */
export class AgentFileDrafts {
  private readonly drafts = new Map<string, Draft>()

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true })
    for (const entry of readdirSync(root)) {
      if (/^[0-9a-f-]{36}$/.test(entry)) {
        try { unlinkSync(join(root, entry)) } catch { /* A prior run may still own this file. */ }
      }
    }
  }

  begin(name: string, bytes: number): { id: string } {
    const leaf = basename(name.replaceAll('\\', '/')).trim()
    if (!leaf || leaf === '.' || leaf === '..') throw new Error('文件名无效。')
    const id = randomUUID()
    const path = join(this.root, id)
    const handle = openSync(path, 'wx')
    closeSync(handle)
    this.drafts.set(id, { id, path, name: leaf, bytes, written: 0, complete: false })
    return { id }
  }

  chunk(id: string, offset: number, data: string): { written: number } {
    const draft = this.drafts.get(id)
    if (!draft || draft.complete) throw new Error('待发送文件已失效。')
    if (offset !== draft.written) throw new Error('文件分片顺序不正确。')
    const buffer = Buffer.from(data, 'base64')
    if (!buffer.length || buffer.length > 256 * 1024 || draft.written + buffer.length > draft.bytes) {
      throw new Error('文件分片大小不正确。')
    }
    const handle = openSync(draft.path, 'r+')
    try { writeSync(handle, buffer, 0, buffer.length, offset) } finally { closeSync(handle) }
    draft.written += buffer.length
    return { written: draft.written }
  }

  finish(id: string): { id: string; name: string; bytes: number } {
    const draft = this.drafts.get(id)
    if (!draft || draft.written !== draft.bytes || statSync(draft.path).size !== draft.bytes) {
      throw new Error('文件尚未完整上传。')
    }
    draft.complete = true
    return { id, name: draft.name, bytes: draft.bytes }
  }

  resolve(ids: readonly string[]): AgentInputFile[] {
    return ids.map((id) => {
      const draft = this.drafts.get(id)
      if (!draft?.complete || !existsSync(draft.path)) throw new Error('所选文件已失效，请重新添加。')
      return { id: draft.id, path: draft.path, name: draft.name, bytes: draft.bytes }
    })
  }

  discard(ids: readonly string[]): void {
    for (const id of ids) {
      const draft = this.drafts.get(id)
      if (!draft) continue
      this.drafts.delete(id)
      try { unlinkSync(draft.path) } catch { /* Already removed during shutdown. */ }
    }
  }

  close(): void { this.discard([...this.drafts.keys()]) }
}
