import type Database from 'better-sqlite3'

function cleanRule(input: unknown): { value: unknown; changed: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('旧正则规则格式无效。')
  const rule = input as Record<string, unknown>
  if (!Array.isArray(rule.targets)) throw new Error('旧正则目标格式无效。')
  const targets = rule.targets.filter(target => target !== 'SlashCommand')
  return targets.length === rule.targets.length ? { value: input, changed: false }
    : { value: { ...rule, targets, ...(targets.length ? {} : { enabled: false }) }, changed: true }
}

function cleanRules(raw: string): { json: string; changed: boolean } {
  const input: unknown = JSON.parse(raw)
  if (!Array.isArray(input)) throw new Error('旧正则列表格式无效。')
  let changed = false
  const value = input.map(rule => { const result = cleanRule(rule); changed ||= result.changed; return result.value })
  return { json: changed ? JSON.stringify(value) : raw, changed }
}

/** 仅移除废弃目标；无目标的规则停用并保留完整文本，不重新解释为其他目标。 */
export function removeCommandRegexTarget(database: Database.Database): void {
    for (const table of ['global_regex_rules', 'character_regex_rules']) {
      const rows = database.prepare(`SELECT rowid,targetsJson FROM ${table}`).all() as Array<{ rowid: number; targetsJson: string }>
      const update = database.prepare(`UPDATE ${table} SET targetsJson=?,enabled=CASE WHEN ?=0 THEN 0 ELSE enabled END WHERE rowid=?`)
      for (const row of rows) {
        const targets: unknown = JSON.parse(row.targetsJson)
        if (!Array.isArray(targets)) throw new Error('旧正则目标格式无效。')
        const current = targets.filter(target => target !== 'SlashCommand')
        if (current.length !== targets.length) update.run(JSON.stringify(current), current.length, row.rowid)
      }
    }
    for (const table of ['agent_preset_contents', 'agent_preset_version_contents']) {
      const rows = database.prepare(`SELECT rowid,content FROM ${table} WHERE kind='regex_rules'`).all() as Array<{ rowid: number; content: string }>
      const update = database.prepare(`UPDATE ${table} SET content=? WHERE rowid=?`)
      for (const row of rows) { const result = cleanRules(row.content); if (result.changed) update.run(result.json, row.rowid) }
    }
}
