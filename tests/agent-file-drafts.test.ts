import { isAbsolute, join, relative } from 'node:path'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AgentFileDrafts } from '../src/main/modules/agent/AgentFileDrafts'

describe('agent file draft intake', () => {
  it('assembles ordered chunks and removes the staged file on discard', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-file-draft-'))
    try {
      const drafts = new AgentFileDrafts(directory)
      const { id } = drafts.begin('notes.md', 5)
      expect(() => drafts.chunk(id, 1, Buffer.from('he').toString('base64'))).toThrow()
      drafts.chunk(id, 0, Buffer.from('he').toString('base64'))
      drafts.chunk(id, 2, Buffer.from('llo').toString('base64'))
      expect(drafts.finish(id)).toEqual({ id, name: 'notes.md', bytes: 5 })
      const [file] = drafts.resolve([id])
      expect(readFileSync(file!.path, 'utf8')).toBe('hello')
      drafts.discard([id])
      expect(() => drafts.resolve([id])).toThrow()
    } finally {
      const child = relative(tmpdir(), directory)
      if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected cleanup path')
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
