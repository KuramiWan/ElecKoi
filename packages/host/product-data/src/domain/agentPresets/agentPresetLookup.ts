import { eq } from 'drizzle-orm'
import type { ElecKoiDatabase } from '@product-data/storage/sqlite/SqliteDatabase'
import { agentPresets } from '@product-data/storage/sqlite/schema/common'

export function agentPresetExists(db: ElecKoiDatabase, id: string): boolean {
  return Boolean(db.select({ id: agentPresets.id }).from(agentPresets).where(eq(agentPresets.id, id)).get())
}
