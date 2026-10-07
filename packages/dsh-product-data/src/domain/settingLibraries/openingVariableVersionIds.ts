import { and, eq } from 'drizzle-orm'
import type { ElecKoiDatabase } from '@product-data/storage/sqlite/SqliteDatabase'
import { settingEntryContents, settingLibraryVersionEntryLinks } from '@product-data/storage/sqlite/schema/common'
import { readEntry } from './settingLibraryCodec'

/** 只读取仍被设定库版本引用的开场，已废弃的内容修订不阻止变量版本删除。 */
export function openingVariableVersionIds(characterId: string, db: ElecKoiDatabase): string[] {
  const entries = db.select({ payloadJson: settingEntryContents.payloadJson })
    .from(settingLibraryVersionEntryLinks).innerJoin(settingEntryContents, and(
      eq(settingEntryContents.characterId, settingLibraryVersionEntryLinks.characterId),
      eq(settingEntryContents.entryId, settingLibraryVersionEntryLinks.entryId),
      eq(settingEntryContents.revisionId, settingLibraryVersionEntryLinks.revisionId)
    )).where(eq(settingLibraryVersionEntryLinks.characterId, characterId)).all()
  return [...new Set(entries.flatMap((row) => readEntry(row.payloadJson).openingMessages
    .map((opening) => opening.variableVersionId || '').filter(Boolean)))]
}
