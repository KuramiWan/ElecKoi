import { ScriptLibraryRepository } from '../../packages/host/product-data/src/domain/scripts'
import { characterExists } from '../../packages/host/product-data/src/domain/personas'
import { agentPresetExists } from '../../packages/host/product-data/src/domain/agentPresets'
import type { ElecKoiSqliteStore } from '../../packages/host/product-data/src/storage/sqlite/SqliteDatabase'

export function createScriptLibraryRepository(store: ElecKoiSqliteStore): ScriptLibraryRepository {
  return new ScriptLibraryRepository(store, { character: characterExists, preset: agentPresetExists })
}
