import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import { installSchema } from './installSchema'
import { recoverInterruptedState } from './recoverInterruptedState'
import { schema, type DatabaseSchema } from './schema'
import { closeSync, existsSync, openSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export type ElecKoiDatabase = BetterSQLite3Database<DatabaseSchema>

/**
 * Small database surface used by domain repositories. The DSH Host implements
 * the same surface while a domain is moved out of Electron Main.
 */
export interface ElecKoiSqliteStore {
  readonly db: ElecKoiDatabase
  readonly native: Database.Database
  withWriteTx<TResult>(operation: (db: ElecKoiDatabase) => TResult): TResult
}

export class SqliteDatabase implements ElecKoiSqliteStore {
  private sqlite: Database.Database | undefined
  private drizzleDatabase: ElecKoiDatabase | undefined

  constructor(private readonly path: string) {}

  get db(): ElecKoiDatabase {
    if (this.drizzleDatabase === undefined) throw new DesktopError(ELECKOI_FAILURE_CODES.lifecycleNotReady, '数据库尚未初始化。', { what: '数据库' })
    return this.drizzleDatabase
  }

  get native(): Database.Database {
    if (this.sqlite === undefined) throw new DesktopError(ELECKOI_FAILURE_CODES.lifecycleNotReady, '数据库尚未初始化。', { what: '数据库' })
    return this.sqlite
  }

  open(): void {
    if (this.sqlite !== undefined) return
    const connection = new Database(this.path)
    try {
      connection.pragma('foreign_keys = ON')
      connection.pragma('busy_timeout = 5000')
      installSchema(connection)
      connection.pragma('journal_mode = WAL')
      connection.pragma('secure_delete = FAST')
      recoverInterruptedState(connection)
      this.drizzleDatabase = drizzle(connection, { schema })
      this.sqlite = connection
    } catch (error) {
      connection.close()
      throw error
    }
  }

  withWriteTx<TResult>(operation: (db: ElecKoiDatabase) => TResult): TResult {
    const transaction = this.native.transaction(() => operation(this.db))
    return transaction.immediate()
  }

  close(): void {
    if (this.sqlite === undefined) return
    this.sqlite.pragma('wal_checkpoint(TRUNCATE)')
    this.sqlite.close()
    this.sqlite = undefined
    this.drizzleDatabase = undefined
  }

  /** Consistent database-only snapshot, including WAL; this is not an Android v3 backup archive. */
  async backupTo(path: string): Promise<void> {
    if (resolve(path) === resolve(this.path) || existsSync(path)) throw new DesktopError(ELECKOI_FAILURE_CODES.lookupDuplicate, '备份目标必须是新的文件。', { what: '备份目标文件', path })
    const target = resolve(path)
    closeSync(openSync(target, 'wx'))
    try {
      await this.native.backup(target)
    } catch (error) {
      rmSync(target, { force: true })
      throw error
    }
  }

}
