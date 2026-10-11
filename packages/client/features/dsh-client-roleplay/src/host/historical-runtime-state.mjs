/** Read a saved pre-input state from the active ledger, never from current state. */
export function historicalRuntimeState(archive, sessionId, fromTurn, messageId) {
  const tables = archive.tables
  const conversation = tables.agent_conversations.find(row => row.runtimeThreadId === sessionId)
  if (!conversation) return undefined
  const active = tables.agent_branch_turns
    .filter(row => row.branchId === conversation.activeBranchId)
    .sort((left, right) => left.sequence - right.sequence)
  const activeIds = new Set(active.map(row => row.turnId))
  const exact = tables.agent_turns.find(row => row.id === messageId && row.kind === 'user' && activeIds.has(row.id))
  if (messageId && !exact) return undefined
  const responses = tables.agent_responses.filter(row => row.runtimeThreadId === sessionId
    && row.dshTurn === fromTurn && activeIds.has(row.turnId))
  const owners = new Set(responses.map(row => row.turnId))
  const turn = exact ?? (owners.size === 1
    ? tables.agent_turns.find(row => row.id === responses[0].turnId && row.kind === 'user')
    : undefined)
  if (!turn || typeof turn.variableStateJson !== 'string') return undefined
  let setting = tables.agent_setting_snapshots.find(row => row.ownerType === 'turn' && row.ownerId === turn.id)
  // An unanswered input has no runtime effects. A following pre-input snapshot
  // is valid only if no response occurred anywhere between these two inputs.
  if (!setting) {
    const position = active.findIndex(row => row.turnId === turn.id)
    for (const row of active.slice(position)) {
      setting = tables.agent_setting_snapshots.find(snapshot => snapshot.ownerType === 'turn' && snapshot.ownerId === row.turnId)
      if (setting || tables.agent_responses.some(response => response.turnId === row.turnId)) break
    }
  }
  if (typeof setting?.stateJson !== 'string') return undefined
  const variables = JSON.parse(turn.variableStateJson)
  const settings = JSON.parse(setting.stateJson)
  if (!variables || typeof variables !== 'object' || Array.isArray(variables) || !Array.isArray(settings)) {
    throw new Error('旧聊天保存的运行状态格式不正确，未修改聊天。')
  }
  return { variableStateJson: turn.variableStateJson, settingLibraryStateJson: setting.stateJson }
}
