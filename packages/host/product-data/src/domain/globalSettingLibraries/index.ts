import { asc, eq } from 'drizzle-orm'
import type { AgentSettingLibraryRuntimeContext } from '@shared/contracts/agent/runtime'
import { globalSettingLibraryCollectionSchema, globalSettingLibrarySchema, globalSettingRuntimeId,
  type GlobalSettingLibraryCollection } from '@shared/contracts/settingLibrary/global'
import { DesktopError } from '@shared/foundation/DesktopError'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { validateSettingLibraryTree } from '../settingLibraries'
import type { ElecKoiSqliteStore } from '@product-data/storage/sqlite/SqliteDatabase'
import { globalSettingLibraries, globalSettingLibraryState } from '@product-data/storage/sqlite/schema/common'

export class GlobalSettingLibraryRepository {
  constructor(private readonly store: ElecKoiSqliteStore) {}

  get(): GlobalSettingLibraryCollection {
    return {
      revision: this.store.db.select().from(globalSettingLibraryState).get()?.revision ?? 0,
      libraries: this.store.db.select().from(globalSettingLibraries).orderBy(asc(globalSettingLibraries.sortIndex)).all()
        .map(row => globalSettingLibrarySchema.parse(JSON.parse(row.configurationJson)))
    }
  }

  save(input: GlobalSettingLibraryCollection): GlobalSettingLibraryCollection {
    const value = globalSettingLibraryCollectionSchema.parse(input)
    if (new Set(value.libraries.map(item => item.id)).size !== value.libraries.length) {
      throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '全局设定库编号不能重复。', { field: 'libraries' })
    }
    if (new Set(value.libraries.map(item => item.name.toLocaleLowerCase())).size !== value.libraries.length) {
      throw new DesktopError(ELECKOI_FAILURE_CODES.lookupDuplicate, '全局设定库名称重复，请为各个库使用不同名称。', { what: '全局设定库名称' })
    }
    for (const library of value.libraries) {
      validateSettingLibraryTree(library.groups, library.entries)
      const positions = new Set(library.promptPositions.map(item => item.id))
      if (positions.size !== library.promptPositions.length || library.entries.some(entry => entry.promptPositionId && !positions.has(entry.promptPositionId))) {
        throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '全局设定库的插入位置编号无效。', { field: 'promptPositions' })
      }
    }
    return this.store.withWriteTx(db => {
      const current = this.get()
      if (current.revision !== value.revision) throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision,
        '全局设定库已在其他窗口修改。草稿已保留，请重新读取后再保存。', { what: '全局设定库' })
      const oldRows = db.select().from(globalSettingLibraries).all()
      const retained = new Set(value.libraries.map(item => item.id))
      for (const row of oldRows) if (!retained.has(row.id)) db.delete(globalSettingLibraries).where(eq(globalSettingLibraries.id, row.id)).run()
      const old = new Map(oldRows.map(row => [row.id, row]))
      value.libraries.forEach((library, sortIndex) => {
        const configurationJson = JSON.stringify(library)
        const previous = old.get(library.id)
        if (previous?.configurationJson === configurationJson && previous.sortIndex === sortIndex) return
        db.insert(globalSettingLibraries).values({ id: library.id, sortIndex, configurationJson })
          .onConflictDoUpdate({ target: globalSettingLibraries.id, set: { sortIndex, configurationJson } }).run()
      })
      const revision = current.revision + 1
      db.insert(globalSettingLibraryState).values({ id: 1, revision }).onConflictDoUpdate({ target: globalSettingLibraryState.id, set: { revision } }).run()
      return { revision, libraries: value.libraries }
    })
  }

  merge(character: AgentSettingLibraryRuntimeContext | undefined): AgentSettingLibraryRuntimeContext | undefined {
    const libraries = this.get().libraries.filter(library => library.enabled)
    if (!libraries.length) return character
    const entries = [...(character?.entries ?? [])]
    const groups = [...(character?.groups ?? [])]
    const promptPositions = [...(character?.promptPositions ?? [])]
    const globalRoot = globalSettingRuntimeId('', 'root')
    groups.push({ id: globalRoot, name: '全局设定库', parentId: '', order: groups.length + 1, treeViewOrder: groups.length + 1, createdAt: '', updatedAt: '' })
    for (const library of libraries) {
      const root = globalSettingRuntimeId(library.id, 'root')
      const groupId = (id: string) => id ? globalSettingRuntimeId(library.id, 'group', id) : root
      groups.push({ id: root, name: library.name, parentId: globalRoot, order: groups.length + 1, treeViewOrder: groups.length + 1,
        createdAt: library.createdAt, updatedAt: library.updatedAt }, ...library.groups.map(group => ({ ...group, id: groupId(group.id), parentId: groupId(group.parentId) })))
      entries.push(...library.entries.map(entry => ({ ...entry, id: globalSettingRuntimeId(library.id, 'entry', entry.id), groupId: groupId(entry.groupId),
        promptPositionId: entry.promptPositionId ? globalSettingRuntimeId(library.id, 'position', entry.promptPositionId) : '' })))
      promptPositions.push(...library.promptPositions.map(position => ({ ...position, id: globalSettingRuntimeId(library.id, 'position', position.id) })))
    }
    return { characterId: character?.characterId ?? '', name: character?.name ?? '', entries, groups, promptPositions }
  }
}
