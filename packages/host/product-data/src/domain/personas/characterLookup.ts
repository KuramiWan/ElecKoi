import { eq } from 'drizzle-orm'
import type { ElecKoiDatabase } from '@product-data/storage/sqlite/SqliteDatabase'
import { characters } from '@product-data/storage/sqlite/schema/common'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

export function characterExists(db: ElecKoiDatabase, id: string): boolean {
  return Boolean(db.select({ id: characters.id }).from(characters).where(eq(characters.id, id)).get())
}

export function requireCharacter(db: ElecKoiDatabase, id: string) {
  const row = db.select().from(characters).where(eq(characters.id, id)).get()
  if (!row) throw new DesktopError(ELECKOI_FAILURE_CODES.characterNotFound, '找不到对应的角色卡。', { what: '角色卡' })
  return row
}
