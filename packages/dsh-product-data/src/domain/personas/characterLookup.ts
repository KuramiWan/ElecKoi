import { eq } from 'drizzle-orm'
import type { ElecKoiDatabase } from '@product-data/storage/sqlite/SqliteDatabase'
import { characters } from '@product-data/storage/sqlite/schema/common'
import { contractFailure } from '@product-data/contractFailure'

/**
 * 按 id 取角色行，取不到就抛**带契约码**的失败。
 *
 * 判据来源：ADR 0002 决定 13（三个域的 not-found 拆码，因为恢复动作不同：回角色列表）
 * 与实现订正 b（这条码在这之前**零生产者**——这里抛的是裸 `Error`）；
 * `notes/eh-explore-sites.md` §1.4 第 1 行。
 */
export function requireCharacter(db: ElecKoiDatabase, id: string) {
  const row = db.select().from(characters).where(eq(characters.id, id)).get()
  if (!row) {
    throw contractFailure(
      'eleckoi/character/not-found',
      `读取角色失败：characters 表里没有 id 为 ${id} 的行。`,
      { what: id }
    )
  }
  return row
}
