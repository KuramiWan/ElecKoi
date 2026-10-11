import { AuthorApiError, type AuthorAgentTrajectory, type AuthorTrajectoryLocation } from '@eleckoi/author-sdk'
import type { AuthorVariableBinding } from '@eleckoi/author-sdk/browser'
import type { ElecKoiConversations } from '@eleckoi/dsh-client-conversations/client'

/** Copies the registered trajectory target; hierarchy readers never enter author realms. */
export function createNativeTrajectoryBinding(conversations: ElecKoiConversations, conversationId: string,
  assertActive: () => void): AuthorVariableBinding {
  return async (params, { signal }): Promise<AuthorAgentTrajectory> => {
    const check = () => { signal.throwIfAborted(); assertActive() }
    check()
    const current = () => {
      const value = conversations.getDetailsSnapshot().details
      if (!value || value.conversation.id !== conversationId) throw new AuthorApiError('CHAT_NOT_READY', '聊天轨迹尚未就绪。')
      return value
    }
    const source = current(), runtimeSessionId = source.runtimeSessionId
    if (!runtimeSessionId) throw new AuthorApiError('SESSION_NOT_READY', '当前聊天还没有正式 Session。')
    if (Object.keys(params).some(key => key !== 'beforeSequence')) throw new AuthorApiError('INVALID_PARAMS', '轨迹分页使用正式历史游标 beforeSequence。')
    if (params.beforeSequence !== undefined) {
      if (!source.hasMore || !Number.isSafeInteger(params.beforeSequence) || params.beforeSequence !== source.beforeSequence) {
        throw new AuthorApiError('STALE_HISTORY_CURSOR', '历史游标已变化或没有更早记录，请重新读取轨迹。')
      }
      const result = await conversations.pageOlder(conversationId, params.beforeSequence as number)
      check()
      if (!result) throw new AuthorApiError('HISTORY_NOT_AVAILABLE', '当前历史分页没有返回记录。')
    }
    const trajectory = await conversations.readTrajectory(conversationId)
    check()
    const latest = current()
    if (latest.runtimeSessionId !== runtimeSessionId) throw new AuthorApiError('SESSION_CHANGED', '聊天 Session 在读取期间发生变化。')
    const locations = new Map<number, AuthorTrajectoryLocation>()
    for (const [seq, value] of trajectory.eventLocations) {
      locations.set(seq, value.kind === 'step'
        ? { kind: value.kind, turn: value.turn.turn, step: value.step.step, turnStatus: value.turn.status, stepStatus: value.step.status }
        : value.kind === 'turn' ? { kind: value.kind, turn: value.turn.turn, turnStatus: value.turn.status }
          : { kind: value.kind })
    }
    return structuredClone({ conversationId, runtimeSessionId,
      history: { hasMore: latest.hasMore, beforeSequence: latest.beforeSequence }, snapshot: {
        events: trajectory.eventNodes, requests: trajectory.requests, toolSchemas: trajectory.callSchemas, locations,
        ...(trajectory.systemPrompts === undefined ? {} : { systemPrompts: trajectory.systemPrompts }),
        partial: trajectory.partial, runningTools: trajectory.runningCalls,
      } }) as AuthorAgentTrajectory
  }
}
