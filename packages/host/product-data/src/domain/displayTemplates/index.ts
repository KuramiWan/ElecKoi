import { displayTemplateLibrarySchema, type DisplayTemplateLibrary, type DisplayTemplateScope, type PortableDisplayTemplates } from '@shared/contracts/displayTemplates/schemas'
import type { ElecKoiSqliteStore, ElecKoiDatabase } from '@product-data/storage/sqlite/SqliteDatabase'
import { DESKTOP_ERROR_CODES, DesktopError } from '@shared/foundation/DesktopError'

export class DisplayTemplateRepository {
  constructor(private readonly store: ElecKoiSqliteStore, private readonly owners: Record<Exclude<DisplayTemplateScope, 'global'>, (db: ElecKoiDatabase, id: string) => boolean>) {}

  get(scope: DisplayTemplateScope, ownerId: string): DisplayTemplateLibrary {
    const empty = displayTemplateLibrarySchema.parse({ scope, ownerId, enabled: false, revision: 0, templates: [] })
    if (scope !== 'global' && !this.owners[scope](this.store.db, ownerId)) throw new Error('显示模板的所属角色或预设不存在。')
    const row = this.store.native.prepare('SELECT enabled, revision, templatesJson FROM display_template_libraries WHERE scope = ? AND ownerId = ?').get(scope, ownerId) as { enabled: number; revision: number; templatesJson: string } | undefined
    return row ? displayTemplateLibrarySchema.parse({ ...empty, enabled: row.enabled === 1, revision: row.revision, templates: JSON.parse(row.templatesJson) }) : empty
  }

  save(input: DisplayTemplateLibrary): DisplayTemplateLibrary {
    const library = displayTemplateLibrarySchema.parse(input)
    return this.store.native.transaction(() => {
      const current = this.get(library.scope, library.ownerId)
      if (current.revision !== library.revision) throw new DesktopError(DESKTOP_ERROR_CODES.CONFLICT, '显示模板已被修改，请重新读取后保存。')
      const next = { ...library, revision: current.revision + 1 }
      this.store.native.prepare('INSERT INTO display_template_libraries (scope, ownerId, characterId, presetId, enabled, revision, templatesJson) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope, ownerId) DO UPDATE SET enabled = excluded.enabled, revision = excluded.revision, templatesJson = excluded.templatesJson').run(
        next.scope, next.ownerId, next.scope === 'character' ? next.ownerId : null, next.scope === 'preset' ? next.ownerId : null,
        next.enabled ? 1 : 0, next.revision, JSON.stringify(next.templates))
      return next
    }).immediate()
  }

  portable(scope: DisplayTemplateScope, ownerId: string): PortableDisplayTemplates {
    if (scope === 'global') throw new Error('共享全局模板不属于角色卡或预设的导出内容。')
    const { enabled, templates } = this.get(scope, ownerId)
    return { enabled, templates }
  }

  import(scope: DisplayTemplateScope, ownerId: string, value: PortableDisplayTemplates): DisplayTemplateLibrary {
    if (scope === 'global') throw new Error('角色卡或预设导入不能替换共享全局模板。')
    const current = this.get(scope, ownerId)
    return this.save({ ...current, ...value, scope, ownerId, enabled: false })
  }

  saveAll(libraries: DisplayTemplateLibrary[]): DisplayTemplateLibrary[] {
    if (new Set(libraries.map(library => JSON.stringify([library.scope, library.ownerId]))).size !== libraries.length) throw new Error('显示模板保存归属重复。')
    return this.store.native.transaction(() => libraries.map(library => this.save(library))).immediate()
  }
}
