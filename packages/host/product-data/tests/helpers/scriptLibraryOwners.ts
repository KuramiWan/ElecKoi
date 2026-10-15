import { ScriptLibraryRepository } from '../../src/domain/scripts'
import { characterExists } from '../../src/domain/personas'
import { agentPresetExists } from '../../src/domain/agentPresets'
import type { ElecKoiSqliteStore } from '../../src/storage/sqlite/SqliteDatabase'

export function createScriptLibraryRepository(store: ElecKoiSqliteStore): ScriptLibraryRepository {
  return new ScriptLibraryRepository(store, { character: characterExists, preset: agentPresetExists })
}
