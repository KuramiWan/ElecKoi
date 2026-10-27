import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { editorLibraryAddressSchema, editorLibrarySaveRequestSchema, scriptVersionContentSchema,
  regexVersionContentSchema, type EditorLibraryAddress, type EditorLibraryVersions, type EditorLibrarySaveRequest, type EditorLibrarySaveResult } from '@shared/contracts/editorVersions/schemas'
import { scriptLibrarySchema } from '@shared/contracts/scripts/schemas'
import { regexRuleEditorCollectionSchema } from '@shared/contracts/regex/schemas'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import type { ScriptLibraryRepository } from '@product-data/domain/scripts'
import { decodeScriptFiles } from '@product-data/domain/scripts'
import type { RegexRuleRepository } from '@product-data/domain/regexRules'
import { EditorLibraryVersionRepository } from './index'

const addressKey = (address: EditorLibraryAddress) => JSON.stringify([address.kind, address.scope, address.ownerId])

export class EditorLibraryVersionsService {
  constructor(private readonly versions: EditorLibraryVersionRepository, private readonly scripts: ScriptLibraryRepository,
    private readonly regex: RegexRuleRepository) {}

  capture(addressInput: EditorLibraryAddress): { content: string; resourceRevision: string } {
    const address = editorLibraryAddressSchema.parse(addressInput)
    if (address.kind === 'scripts') {
      const before = this.scripts.workspace(address.scope, address.ownerId).version
      const portable = this.scripts.portable(address.scope, address.ownerId)
      const after = this.scripts.workspace(address.scope, address.ownerId).version
      if (before !== after) throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, '脚本资源在读取版本期间发生变化，请重新读取。', { what: '脚本资源' })
      return { content: JSON.stringify({ ...portable, files: portable.files ?? [] }), resourceRevision: after }
    }
    return { content: JSON.stringify({ enabled: this.regex.scopeEnabled(address.scope, address.ownerId), rules: this.regex.readScope(address.scope, address.ownerId) }), resourceRevision: '' }
  }

  read(address: EditorLibraryAddress): EditorLibraryVersions {
    const snapshot = this.capture(address)
    return this.versions.read(address, snapshot.content, snapshot.resourceRevision)
  }

  sync(address: EditorLibraryAddress): void {
    const snapshot = this.capture(address)
    this.versions.syncCurrent(address, snapshot.content, snapshot.resourceRevision)
  }

  transaction<T>(operation: () => T): T { return this.versions.transaction(() => this.scripts.transaction(operation)) }

  copyCharacter(sourceId: string, targetId: string, regexIds: Map<string, string>): void {
    for (const kind of ['scripts', 'regex'] as const) {
      const source = this.read({ kind, scope: 'character', ownerId: sourceId });
      const address = { kind, scope: 'character' as const, ownerId: targetId };
      const current = this.capture(address);
      this.versions.save({ ...source, ...address, revision: 0, resourceRevision: current.resourceRevision,
        versions: source.versions.map(version => {
          if (kind === 'scripts') return version;
          const content = regexVersionContentSchema.parse(JSON.parse(version.content));
          return { ...version, content: JSON.stringify({ ...content, rules: content.rules.map(rule => {
            if (!regexIds.has(rule.id)) regexIds.set(rule.id, `regex-${randomUUID()}`);
            return { ...rule, id: regexIds.get(rule.id)! };
          }) }) };
        }),
      }, current.content);
    }
  }

  save(requestInput: EditorLibrarySaveRequest): EditorLibrarySaveResult {
    const request = editorLibrarySaveRequestSchema.parse(requestInput)
    return this.versions.transaction(() => this.scripts.transaction(db => {
      const documents = request.documents.map(content => JSON.parse(content) as unknown)
      const parsed = request.kind === 'scripts' ? documents.map(document => scriptLibrarySchema.parse(document))
        : documents.map(document => regexRuleEditorCollectionSchema.parse(document))
      if (request.kind === 'regex' && parsed.length !== 1) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '正则版本保存必须对应一个明确编辑器。', { field: 'documents' })
      const allowed = new Set<string>()
      if (request.kind === 'regex') {
        const collection = regexRuleEditorCollectionSchema.parse(parsed[0])
        allowed.add(addressKey({ kind: 'regex', scope: 'global', ownerId: '' }))
        allowed.add(addressKey({ kind: 'regex', ...collection.target }))
      } else {
        for (const document of parsed) {
          const address = z.object({ scope: z.enum(['global', 'character', 'preset']), ownerId: z.string() }).parse(document)
          const key = addressKey({ kind: request.kind, ...address })
          if (allowed.has(key)) throw new DesktopError(ELECKOI_FAILURE_CODES.lookupDuplicate, '配置保存归属重复。', { what: '配置保存归属' })
          allowed.add(key)
        }
      }
      const seen = new Set<string>()
      for (const library of request.versions) {
        const key = addressKey(library)
        if (library.kind !== request.kind || !allowed.has(key) || seen.has(key)) throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, '配置版本与本次编辑对象不匹配。', { what: '配置版本与编辑对象' })
        seen.add(key); this.versions.check(library)
        if (library.kind === 'scripts') {
          if (this.scripts.workspace(library.scope, library.ownerId).version !== library.resourceRevision) {
            throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, '脚本资源已在外部更新，未覆盖现有文件。', { what: '脚本资源' })
          }
          for (const version of library.versions) {
            const content = scriptVersionContentSchema.parse(JSON.parse(version.content))
            scriptLibrarySchema.parse({ enabled: content.enabled, trees: content.trees, variables: content.variables,
              scope: library.scope, ownerId: library.ownerId, revision: 0 })
            decodeScriptFiles(content.files)
          }
        }
      }
      const result: string[] = []
      for (const document of parsed) {
        if (request.kind === 'scripts') {
          const library = scriptLibrarySchema.parse(document), current = this.scripts.get(library.scope, library.ownerId)
          if (current.revision !== library.revision) throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, '脚本配置已更新，请重新读取后保存。', { what: '脚本配置' })
          const version = request.versions.find(item => item.scope === library.scope && item.ownerId === library.ownerId)
          if (version) {
            const active = scriptVersionContentSchema.parse(JSON.parse(version.versions.find(item => item.id === version.activeVersionId)!.content))
            if (!isDeepStrictEqual({ enabled: library.enabled, trees: library.trees, variables: library.variables },
              { enabled: active.enabled, trees: active.trees, variables: active.variables })) throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, '当前脚本版本与编辑内容不一致。', { what: '当前脚本版本与编辑内容' })
          }
          const saved = isDeepStrictEqual(current, library) ? current : this.scripts.saveInTransaction(library, db)
          if (version) {
            const active = scriptVersionContentSchema.parse(JSON.parse(version.versions.find(item => item.id === version.activeVersionId)!.content))
            this.scripts.replaceResourcesInTransaction(library.scope, library.ownerId, active.files)
          }
          result.push(JSON.stringify(saved))
        } else {
          const library = regexRuleEditorCollectionSchema.parse(document), current = this.regex.readEditor(library.target)
          if (current.revision !== library.revision || current.ownerRevision !== library.ownerRevision) throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, '正则配置已更新，请重新读取后保存。', { what: '正则配置' })
          for (const version of request.versions) {
            const active = regexVersionContentSchema.parse(JSON.parse(version.versions.find(item => item.id === version.activeVersionId)!.content))
            const rules = version.scope === 'global' ? library.globalRules : version.scope === 'preset' ? library.agentPresetRules : library.characterRules
            const enabled = (version.scope === 'global' ? library.globalEnabled : version.scope === 'preset' ? library.agentPresetEnabled : library.characterEnabled) !== false
            if (!isDeepStrictEqual(active, { enabled, rules })) throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, '当前正则版本与编辑内容不一致。', { what: '当前正则版本与编辑内容' })
          }
          result.push(JSON.stringify(isDeepStrictEqual(current, library) ? current : this.regex.saveEditor(library)))
        }
      }
      const versions = request.versions.map(library => {
        const current = this.capture({ kind: library.kind, scope: library.scope, ownerId: library.ownerId })
        return this.versions.save({ ...library, resourceRevision: current.resourceRevision }, current.content)
      })
      return { documents: result, versions }
    }))
  }
}
