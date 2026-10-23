import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { z } from 'zod'
import { editorLibraryAddressSchema, editorLibraryVersionsSchema, type EditorLibraryAddress, type EditorLibraryVersions } from '@shared/contracts/editorVersions/schemas'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import type { ElecKoiSqliteStore } from '@product-data/storage/sqlite/SqliteDatabase'

const archiveSchema = z.strictObject({ archive: z.string().regex(/^[a-f0-9]{64}$/) })
interface VersionRow { revision: number; stateJson: string }

/** Named script snapshots live in immutable files; SQL contains only names, ownership and references. */
export class EditorLibraryVersionRepository {
  private transactionDepth = 0
  constructor(private readonly store: ElecKoiSqliteStore, private readonly root: string,
    private readonly requireOwner: (address: EditorLibraryAddress) => void) { this.collectArchives() }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth) return operation()
    this.collectArchives()
    this.transactionDepth++
    try { return operation() }
    finally { this.transactionDepth-- }
  }

  private row(address: EditorLibraryAddress): VersionRow | undefined {
    return this.store.native.prepare('SELECT revision, stateJson FROM editor_library_versions WHERE kind=? AND scope=? AND ownerId=?')
      .get(address.kind, address.scope, address.ownerId) as VersionRow | undefined
  }

  read(addressInput: EditorLibraryAddress, currentContent: string, resourceRevision = ''): EditorLibraryVersions {
    const address = editorLibraryAddressSchema.parse(addressInput)
    this.requireOwner(address)
    const row = this.row(address)
    if (!row) return editorLibraryVersionsSchema.parse({ ...address, revision: 0, resourceRevision, activeVersionId: 'default',
      versions: [{ id: 'default', name: '默认版本', content: currentContent }] })
    const stored = JSON.parse(row.stateJson) as EditorLibraryVersions
    if (stored.kind !== address.kind || stored.scope !== address.scope || stored.ownerId !== address.ownerId || stored.revision !== row.revision) {
      throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, '配置版本归属或修改版本与存储记录不一致。', { what: '配置版本归属或修改版本' })
    }
    const versions = stored.versions.map(version => ({ ...version, content: address.kind === 'scripts'
      ? this.readArchive(archiveSchema.parse(JSON.parse(version.content)).archive) : version.content }))
    const result = editorLibraryVersionsSchema.parse({ ...stored, ...address, revision: row.revision, resourceRevision, versions })
    return { ...result, versions: result.versions.map(version => version.id === result.activeVersionId
      ? { ...version, content: currentContent } : version) }
  }

  check(input: EditorLibraryVersions): EditorLibraryVersions {
    const value = editorLibraryVersionsSchema.parse(input)
    this.requireOwner(value)
    if ((this.row(value)?.revision ?? 0) !== value.revision) {
      throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, '配置版本已在其他窗口更新，请重新读取后保存。', { what: '配置版本' })
    }
    return value
  }

  save(input: EditorLibraryVersions, currentContent: string): EditorLibraryVersions {
    if (!this.transactionDepth) return this.transaction(() => this.store.withWriteTx(() => this.save(input, currentContent)))
    const value = this.check(input)
    const next = editorLibraryVersionsSchema.parse({ ...value, revision: value.revision + 1,
      versions: value.versions.map(version => version.id === value.activeVersionId ? { ...version, content: currentContent } : version) })
    const stored = { ...next, versions: next.versions.map(version => ({ ...version,
      content: next.kind === 'scripts' ? JSON.stringify({ archive: this.writeArchive(version.content) }) : version.content })) }
    this.store.native.prepare('INSERT INTO editor_library_versions (kind,scope,ownerId,characterId,presetId,revision,stateJson) VALUES (?,?,?,?,?,?,?) ON CONFLICT(kind,scope,ownerId) DO UPDATE SET revision=excluded.revision,stateJson=excluded.stateJson')
      .run(next.kind, next.scope, next.ownerId, next.scope === 'character' ? next.ownerId : null,
        next.scope === 'preset' ? next.ownerId : null, next.revision, JSON.stringify(stored))
    return next
  }

  syncCurrent(address: EditorLibraryAddress, content: string, resourceRevision = ''): void {
    if (!this.row(address)) return
    const state = this.read(address, content, resourceRevision)
    this.save(state, content)
  }

  private archivePath(hash: string): string {
    archiveSchema.parse({ archive: hash })
    return join(this.root, `${hash}.json`)
  }

  private readArchive(hash: string): string {
    const path = this.archivePath(hash)
    if (lstatSync(this.root).isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new DesktopError(ELECKOI_FAILURE_CODES.securityDenied, '脚本版本归档不能使用链接目录或文件。', { what: '脚本版本归档的链接目录或文件' })
    const root = realpathSync(this.root), actual = realpathSync(path)
    if (!actual.startsWith(root + sep)) throw new DesktopError(ELECKOI_FAILURE_CODES.securityDenied, '脚本版本归档文件超出所属目录。', { what: '脚本版本归档文件超出所属目录' })
    const bytes = readFileSync(path)
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '脚本版本归档内容已损坏。', { what: '脚本版本归档内容' })
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }

  private writeArchive(content: string): string {
    const hash = createHash('sha256').update(content).digest('hex'), path = this.archivePath(hash)
    mkdirSync(this.root, { recursive: true })
    if (existsSync(path)) { if (this.readArchive(hash) !== content) throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '脚本版本归档摘要冲突。', { what: '脚本版本归档摘要' }); return hash }
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
    return hash
  }

  collectArchives(): void {
    if (this.transactionDepth || !existsSync(this.root)) return
    const referenced = new Set<string>()
    const rows = this.store.native.prepare("SELECT stateJson FROM editor_library_versions WHERE kind='scripts'").all() as Array<{ stateJson: string }>
    for (const row of rows) {
      const state = JSON.parse(row.stateJson) as EditorLibraryVersions
      for (const version of state.versions) referenced.add(archiveSchema.parse(JSON.parse(version.content)).archive)
    }
    if (lstatSync(this.root).isSymbolicLink()) throw new DesktopError(ELECKOI_FAILURE_CODES.securityDenied, '脚本版本归档目录不能是链接目录。', { what: '脚本版本归档目录的符号链接' })
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '脚本版本归档目录包含未知条目，未清理文件。', { what: '脚本版本归档目录', path: entry.name })
      if (!referenced.has(entry.name.slice(0, -5))) rmSync(this.archivePath(entry.name.slice(0, -5)))
    }
  }
}

export { EditorLibraryVersionsService } from './EditorLibraryVersionsService'
