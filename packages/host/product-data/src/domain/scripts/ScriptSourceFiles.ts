import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { scriptFilePathSchema } from '@shared/contracts/scripts/schemas'
import type { ElecKoiSqliteStore } from '@product-data/storage/sqlite/SqliteDatabase'

const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable()
const journalSchema = z.strictObject({
  version: z.literal(1),
  rows: z.array(z.strictObject({ scope: z.string(), ownerId: z.string(), before: rowSchema, after: rowSchema })),
  owners: z.array(z.strictObject({ scope: z.enum(['character', 'preset']), ownerId: z.string(), before: z.boolean(), after: z.boolean() })),
  files: z.array(z.strictObject({ path: z.string(), beforeHash: z.string().nullable(), afterHash: z.string().nullable() })),
})
type Journal = z.infer<typeof journalSchema>
type Row = z.infer<typeof rowSchema>
interface Change { path: string; beforeHash: string | null; content: Uint8Array | null }
export const sourceHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

/** Source files and their SQL ownership index commit together, including interrupted writes. */
export class ScriptSourceFiles {
  private changes = new Map<string, Change>()
  private rows = new Map<string, { scope: string; ownerId: string; before: Row; after: Row }>()
  private owners = new Map<string, Journal['owners'][number]>()
  private active = false
  private pending: string | undefined
  private watchError: Error | undefined
  constructor(readonly root: string, private readonly store: ElecKoiSqliteStore,
    private readonly ownerExists: (scope: 'character' | 'preset', ownerId: string) => boolean) {
    if (!isAbsolute(root)) throw new Error('脚本源码需要明确的本地目录。')
    this.recover()
  }

  path(name: string): string {
    scriptFilePathSchema.parse(name)
    const path = resolve(this.root, name)
    if (!path.startsWith(resolve(this.root) + sep)) throw new Error('脚本文件不能位于脚本目录之外。')
    return path
  }

  directory(name: string): string {
    const path = this.path(name)
    mkdirSync(path, { recursive: true })
    this.contained(path, this.root)
    return path
  }

  bytes(directory: string, name: string): Uint8Array {
    const parent = this.directory(directory), path = this.path(`${directory}/${name}`)
    this.contained(path, parent)
    if (!statSync(path).isFile()) throw new Error('脚本资源不是普通文件。')
    return readFileSync(path)
  }

  names(directory: string): string[] {
    if (!this.active) this.recover()
    const parent = this.path(directory), files = new Set<string>()
    if (existsSync(parent)) this.contained(parent, this.root)
    const visit = (relative: string) => {
      for (const entry of readdirSync(this.path(relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const name = `${relative}/${entry.name}`, path = this.path(name)
        this.contained(path, parent)
        const stat = statSync(path)
        if (entry.isSymbolicLink()) throw new Error(`脚本目录不支持链接文件：${name}`)
        if (stat.isDirectory()) visit(name)
        else if (stat.isFile()) files.add(name.slice(directory.length + 1))
        else throw new Error(`脚本资源不是普通文件：${name}`)
      }
    }
    if (existsSync(parent)) visit(directory)
    for (const [name, change] of this.changes) if (name.startsWith(`${directory}/`)) {
      const relative = name.slice(directory.length + 1)
      if (change.content === null) files.delete(relative)
      else files.add(relative)
    }
    return [...files].sort((a, b) => a.localeCompare(b, 'en'))
  }

  version(directory: string): string {
    if (this.watchError) throw this.watchError
    return sourceHash(JSON.stringify(this.names(directory).map(name => [name, sourceHash(this.readBytes(`${directory}/${name}`))])))
  }

  watch(changed: () => void): () => void {
    mkdirSync(this.root, { recursive: true })
    this.watchError = undefined
    let timer: ReturnType<typeof setTimeout> | undefined, closed = false
    const notify = () => {
      if (closed) return
      clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; if (!closed) changed() }, 120)
    }
    const watcher = watch(this.root, { recursive: true, persistent: false }, (_event, name) => {
      if (name && String(name).split(/[\\/]/)[0] === '.transactions') return
      notify()
    })
    watcher.on('error', error => { this.watchError = error; notify() })
    return () => { closed = true; clearTimeout(timer); watcher.close() }
  }

  private contained(path: string, parent: string): void {
    const target = realpathSync(path), root = realpathSync(parent)
    if (target !== root && !target.startsWith(root + sep)) throw new Error('脚本资源不能位于所属目录之外。')
  }

  read(name: string): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(this.readBytes(name))
  }

  readBytes(name: string): Uint8Array {
    if (!this.active) this.recover()
    const staged = this.changes.get(name)
    if (staged) {
      if (staged.content === null) throw new Error(`脚本文件已删除：${name}`)
      return staged.content
    }
    const path = this.path(name)
    this.contained(path, this.root)
    return readFileSync(path)
  }

  stage(name: string, content: string | Uint8Array | null): void {
    if (!this.active) throw new Error('脚本文件修改必须进入所属事务。')
    const previous = this.changes.get(name)
    const beforeHash = previous ? previous.beforeHash : this.hash(name)
    if (beforeHash === (content === null ? null : sourceHash(content))) { this.changes.delete(name); return }
    this.changes.set(name, { path: name, content: content === null ? null : typeof content === 'string'
      ? Buffer.from(content, 'utf8') : Buffer.from(content), beforeHash })
  }

  mark(scope: string, ownerId: string, before: Row, after: Row): void {
    if (!this.active) return
    const key = JSON.stringify([scope, ownerId]), previous = this.rows.get(key)
    this.rows.set(key, { scope, ownerId, before: previous ? previous.before : before, after })
  }

  markOwnerDeletion(scope: 'character' | 'preset', ownerId: string): void {
    if (!this.active) throw new Error('脚本所属对象的删除必须进入所属事务。')
    const key = JSON.stringify([scope, ownerId]), previous = this.owners.get(key)
    this.owners.set(key, { scope, ownerId, before: previous ? previous.before : this.ownerExists(scope, ownerId), after: false })
  }

  transaction<T>(operation: () => T): T {
    if (this.active) {
      const changes = new Map(this.changes), rows = new Map(this.rows), owners = new Map(this.owners)
      try { return this.store.withWriteTx(operation) }
      catch (error) { this.changes = changes; this.rows = rows; this.owners = owners; throw error }
    }
    this.recover()
    this.active = true
    let committed = false
    try {
      const result = this.store.withWriteTx(() => {
        const result = operation()
        this.publish()
        return result
      })
      committed = true
      if (this.pending) this.cleanup(this.pending)
      return result
    } catch (error) {
      if (!committed && this.pending) this.rollback(this.pending, this.journal(this.pending))
      throw error
    } finally {
      this.active = false
      this.pending = undefined
      this.changes.clear()
      this.rows.clear()
      this.owners.clear()
    }
  }

  private hash(name: string): string | null {
    const path = this.path(name)
    return existsSync(path) ? sourceHash(readFileSync(path)) : null
  }

  private publish(): void {
    if (!this.changes.size) return
    const directory = this.path(`.transactions/${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    const journal: Journal = { version: 1, rows: [...this.rows.values()], owners: [...this.owners.values()], files: [] }
    try {
      for (const [index, change] of [...this.changes.values()].entries()) {
        journal.files.push({ path: change.path, beforeHash: change.beforeHash,
          afterHash: change.content === null ? null : sourceHash(change.content) })
        if (change.content !== null) writeFileSync(join(directory, `${index}.new`), change.content)
      }
      writeFileSync(join(directory, 'journal.json'), JSON.stringify(journal), 'utf8')
    } catch (error) { this.cleanup(directory); throw error }
    this.pending = directory
    for (const [index, file] of journal.files.entries()) {
      if (this.hash(file.path) !== file.beforeHash) throw new Error(`脚本文件已被外部修改，未覆盖：${file.path}`)
      const target = this.path(file.path)
      mkdirSync(dirname(target), { recursive: true })
      if (file.beforeHash !== null) renameSync(target, join(directory, `${index}.old`))
      if (file.afterHash !== null) renameSync(join(directory, `${index}.new`), target)
    }
  }

  private journal(directory: string): Journal {
    const value = journalSchema.parse(JSON.parse(readFileSync(join(directory, 'journal.json'), 'utf8')))
    value.files.forEach(file => this.path(file.path))
    return value
  }

  private rollback(directory: string, journal: Journal): void {
    for (const [index, file] of [...journal.files.entries()].reverse()) {
      const backup = join(directory, `${index}.old`), target = this.path(file.path)
      if (existsSync(backup)) {
        const current = this.hash(file.path)
        if (current !== null && current !== file.afterHash) throw new Error(`脚本回滚遇到外部修改，已保留原文件：${file.path}`)
        if (current !== null) rmSync(target)
        renameSync(backup, target)
      } else if (file.beforeHash === null && file.afterHash !== null && !existsSync(join(directory, `${index}.new`))) {
        const current = this.hash(file.path)
        if (current !== null && current !== file.afterHash) throw new Error(`脚本回滚遇到外部修改，已保留文件：${file.path}`)
        if (current !== null) rmSync(target)
      }
    }
    this.cleanup(directory)
  }

  private cleanup(directory: string): void {
    if (!resolve(directory).startsWith(this.path('.transactions') + sep)) throw new Error('脚本事务目录无效。')
    rmSync(directory, { recursive: true, force: true })
  }

  private recover(): void {
    const parent = this.path('.transactions')
    if (!existsSync(parent)) return
    for (const name of readdirSync(parent)) {
      if (!/^[0-9a-f-]{36}$/.test(name)) throw new Error('脚本事务目录包含未知文件，未修改数据。')
      const directory = join(parent, name)
      if (!existsSync(join(directory, 'journal.json'))) { this.cleanup(directory); continue }
      const journal = this.journal(directory)
      const current = journal.rows.map(row => this.store.native.prepare(
        'SELECT * FROM script_libraries WHERE scope=? AND ownerId=?',
      ).get(row.scope, row.ownerId) ?? null)
      const owners = journal.owners.map(owner => this.ownerExists(owner.scope, owner.ownerId))
      if (journal.rows.every((row, index) => isDeepStrictEqual(current[index], row.after))
        && journal.owners.every((owner, index) => owners[index] === owner.after)) this.cleanup(directory)
      else if (journal.rows.every((row, index) => isDeepStrictEqual(current[index], row.before))
        && journal.owners.every((owner, index) => owners[index] === owner.before)) this.rollback(directory, journal)
      else throw new Error('脚本事务与所属记录不匹配，已保留文件，请检查存储状态。')
    }
  }
}
