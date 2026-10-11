import { settingLibraryEntrySchema, settingLibraryEntryUpdateSchema } from './schemas'
import type { SettingLibraryEntry, SettingLibraryEntryUpdate } from './schemas'

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
    if (changed.has(update.id)) throw new Error(`条目编号重复：${update.id}`)
    const current = byId.get(update.id)
    if (!current) throw new Error(`找不到条目：${update.id}`)
    changed.set(update.id, settingLibraryEntrySchema.parse({ ...current, ...update.changes, updatedAt }))
  }
  return { entries: entries.map(entry => changed.get(entry.id) ?? entry), changed: [...changed.values()] }
}
