import type Database from 'better-sqlite3'

export const migration0005 = {
  fromVersion: 4,
  toVersion: 5,
  name: 'remove-rich-message-height-cache',
  acceptedBaselines: [] as const,
  apply(database: Database.Database): void {
    database.exec('DROP TABLE IF EXISTS roleplay_rich_heights')
  }
} as const
