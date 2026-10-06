/** 修改同一个官方 Session 的消息和回退位置，保留 Session 编号。 */
export interface ElecKoiSessionEditor {
  /**
   * 修改一条消息并刷新官方投影。
   * @param sessionId - 官方 Session 编号。
   * @param eventSeq - 消息事件序号。
   * @param role - 消息角色。
   * @param content - 新的完整消息文本。
   * @returns 消息修改和投影刷新完成。
   */
  editMessage(sessionId: string, eventSeq: number, role: 'user' | 'assistant', content: string): Promise<void>
  /**
   * 从指定轮次和可选事件位置回退，并刷新官方投影。
   * @param sessionId - 官方 Session 编号。
   * @param fromTurn - 首个需要撤销的轮次。
   * @param fromEventSeq - 可选消息事件边界。
   * @param retainInput - 保留该边界的直接用户事件并闭合其开放轮次。
   * @returns 移除的事件数；无法回退时返回 undefined。
   */
  rewind(sessionId: string, fromTurn: number, fromEventSeq?: number, retainInput?: boolean): Promise<number | undefined>
  /** @internal 产品保存失败时恢复 Session 日志的内部操作，不是跨数据域事务。 */
  transaction<T>(sessionId: string, operation: () => Promise<T>): Promise<T>
  /** @internal 产品删除流程使用的内部操作。 */
  deleteSession(sessionId: string): Promise<void>
}
