import { settingLibraryEntrySchema, settingLibraryEntryUpdateSchema } from './schemas'
import type { SettingLibraryEntry, SettingLibraryEntryUpdate } from './schemas'
import { ELECKOI_FAILURE_CODES } from '../errors/codes.js'
import { DesktopError } from '../../foundation/DesktopError.js'

/** Applies an explicit batch to the latest content; ownership restrictions remain with the repository. */
export function applySettingLibraryEntryUpdates(
  entries: SettingLibraryEntry[],
  input: SettingLibraryEntryUpdate[],
  updatedAt: string
): { entries: SettingLibraryEntry[]; changed: SettingLibraryEntry[] } {
  const updates = settingLibraryEntryUpdateSchema.array().parse(input)
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const changed = new Map<string, SettingLibraryEntry>()
  for (const update of updates) {
    if (changed.has(update.id)) throw new DesktopError(ELECKOI_FAILURE_CODES.lookupDuplicate, `条目编号重复：${update.id}`, { what: '设定条目' })
    const current = byId.get(update.id)
    if (!current) throw new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound, `找不到条目：${update.id}`, { what: '设定条目' })
    changed.set(update.id, settingLibraryEntrySchema.parse({ ...current, ...update.changes, updatedAt }))
  }
  return { entries: entries.map(entry => changed.get(entry.id) ?? entry), changed: [...changed.values()] }
}
