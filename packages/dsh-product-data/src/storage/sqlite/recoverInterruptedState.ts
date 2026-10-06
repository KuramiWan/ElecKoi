import type Database from 'better-sqlite3'

/** 当前运行期启动恢复：每次异常退出后关闭未完成响应，随现有响应状态合同维护。 */
export function recoverInterruptedState(database: Database.Database): number {
  return database.transaction(() => {
    const result = database.prepare(`UPDATE agent_responses SET status = 'error'
      WHERE status IN ('streaming', 'running', 'pending')`).run()
    return result.changes
  }).immediate()
}
