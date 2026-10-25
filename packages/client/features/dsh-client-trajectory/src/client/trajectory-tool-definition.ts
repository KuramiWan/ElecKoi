import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition, StartedToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import type {} from '@deepseek-ai/dsh-tools/types'
import { trajectoryNode } from './trajectory-definition-common.ts'

/* jscpd:ignore-start -- Target-owned Definitions intentionally keep their event
 * state machines independent; see ../../../../../.agents/notes/implemented/
 * architecture/2026-08-09-client-conversation-node-assembly.md. */

type ToolCallBlock = StartedToolCall | ToolResultNode

interface ToolState {
  readonly rootId: string
  readonly calls: ReadonlyMap<string, ToolCallBlock>
  readonly children: ReadonlyMap<string, readonly string[]>
  readonly parents: ReadonlyMap<string, string>
}

interface DispatchData {
  readonly parentCallId: string
  readonly subCallId: string
  readonly name: string
  readonly arguments: unknown
  readonly isError?: boolean
  readonly error?: ToolResultNode['error']
  readonly content?: ToolResultNode['content']
}

function rootCall(match: ConversationMatch): StartedToolCall {
  if (match.event.type !== 'tool/call') {
    throw new DesktopError(ELECKOI_FAILURE_CODES.internal, 'trajectory-tool-call start requires tool/call', { what: '轨迹工具调用的起始事件' })
  }
  return {
    phase: 'start',
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    argsRaw: match.event.data.arguments,
    turn: match.event.data.turn,
    step: match.event.data.step,
    time: match.event.time,
    subCalls: [],
  }
}

function rootResult(
  match: ConversationMatch,
  previous?: StartedToolCall,
): ToolResultNode | undefined {
  if (match.event.type !== 'tool/result') return undefined
  const message = match.event.data.message
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: String(message.source.callId),
    call: previous === undefined ? null : { name: previous.name, argsRaw: previous.argsRaw },
    callTime: previous?.time ?? null,
    content: message.content,
    isError: message.isError === true,
    ...(match.event.data.error === undefined ? {} : { error: match.event.data.error }),
    meta: match.event.data.meta,
    subCalls: [],
  }
}

function locationTurn(match: ConversationMatch): number {
  return match.location.kind === 'step' || match.location.kind === 'turn'
    ? match.location.turn.turn
    : 0
}

function locationStep(match: ConversationMatch): number {
  return match.location.kind === 'step' ? match.location.step.step : 0
}

function childCall(match: ConversationMatch, data: DispatchData): StartedToolCall {
  return {
    phase: 'start',
    callId: data.subCallId,
    parentCallId: data.parentCallId,
    name: data.name,
    argsRaw: JSON.stringify(data.arguments),
    turn: locationTurn(match),
    step: locationStep(match),
    time: match.event.time,
    subCalls: [],
  }
}

function childResult(
  match: ConversationMatch,
  data: DispatchData,
  previous?: ToolCallBlock,
): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: data.subCallId,
    parentCallId: data.parentCallId,
    call: { name: data.name, argsRaw: JSON.stringify(data.arguments) },
    callTime: previous === undefined || 'kind' in previous ? null : previous.time,
    content: data.content ?? [],
    isError: data.isError === true,
    ...(data.error === undefined ? {} : { error: data.error }),
    subCalls: [],
  }
}

function acceptsEdge(state: ToolState, parent: string, child: string): boolean {
  if (parent === child || state.parents.has(child)) return false
  let cursor: string | undefined = parent
  const ancestors = new Set<string>()
  while (cursor !== undefined) {
    if (cursor === child || ancestors.has(cursor)) return false
    ancestors.add(cursor)
    cursor = state.parents.get(cursor)
  }
  const pending = [child]
  const descendants = new Set<string>()
  for (const candidate of pending) {
    if (descendants.has(candidate)) return false
    descendants.add(candidate)
    for (const nested of state.children.get(candidate) ?? []) {
      pending.push(nested)
    }
  }
  return true
}

function updateDispatch(state: ToolState, match: ConversationMatch): ToolState {
  const event = match.event
  if (event.type !== 'tool/ptc-dispatch-start' && event.type !== 'tool/ptc-dispatch') return state
  const data = event.data
  const parentId = String(data.parentCallId)
  const childId = String(data.subCallId)
  const siblings = state.children.get(parentId) ?? []
  const index = siblings.indexOf(childId)
  if (index < 0 && !acceptsEdge(state, parentId, childId)) return state
  if (event.type === 'tool/ptc-dispatch-start' && index >= 0) return state

  const calls = new Map(state.calls)
  calls.set(childId, event.type === 'tool/ptc-dispatch-start'
    ? childCall(match, data)
    : childResult(match, data, calls.get(childId)))
  if (index >= 0) return { ...state, calls }
  const children = new Map(state.children)
  children.set(parentId, [...siblings, childId])
  const parents = new Map(state.parents)
  parents.set(childId, parentId)
  return { ...state, calls, children, parents }
}

function interruption(
  context: ConversationNodeContext<ToolState>,
): { seq: number; time: number } | undefined {
  const location = context.start?.location
  if (location?.kind === 'step' && location.step.status === 'closed') return location.step.end
  if ((location?.kind === 'step' || location?.kind === 'turn')
    && location.turn.status === 'closed') return location.turn.end
  return undefined
}

function projectCall(
  state: ToolState,
  callId: string,
  interruptedAt: { seq: number; time: number } | undefined,
): ToolCallBlock | undefined {
  const projected = new Map<string, ToolCallBlock>()
  const pending = [{ id: callId, complete: false }]
  const visited = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    const block = state.calls.get(current.id)
    if (block === undefined) continue
    if (!current.complete) {
      if (visited.has(current.id)) continue
      visited.add(current.id)
      pending.push({ id: current.id, complete: true })
      for (const id of [...state.children.get(current.id) ?? []].reverse()) pending.push({ id, complete: false })
      continue
    }
    const subCalls = (state.children.get(current.id) ?? []).flatMap(id => {
      const child = projected.get(id)
      return child === undefined ? [] : [child]
    })
    projected.set(current.id, 'kind' in block || interruptedAt === undefined ? { ...block, subCalls } : {
      kind: 'tool-result', seq: interruptedAt.seq - 0.8, time: interruptedAt.time,
      callId: block.callId,
      ...block.parentCallId === undefined ? {} : { parentCallId: block.parentCallId },
      call: { name: block.name, argsRaw: block.argsRaw }, callTime: block.time,
      content: [], isError: true, error: { name: 'Interrupted', code: 'interrupted' }, subCalls,
    })
  }
  return projected.get(callId)
}

function fallbackState(context: ConversationNodeContext<ToolState>): ToolState | undefined {
  const resultMatch = context.matches.find(match => match.event.type === 'tool/result')
  const root = resultMatch === undefined ? undefined : rootResult(resultMatch)
  if (root === undefined) return undefined
  let state: ToolState = {
    rootId: root.callId,
    calls: new Map([[root.callId, root]]),
    children: new Map(),
    parents: new Map(),
  }
  for (const match of context.matches) state = updateDispatch(state, match)
  return state
}

/** Trajectory-owned root Tool lifecycle with nested PTC dispatch calls. */
const trajectoryToolDefinition: ConversationNodeDefinition<ToolState> = {
  kind: 'trajectory-tool-call',
  target: 'trajectory',
  match: (event) => {
    if (event.type === 'tool/call') return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result') {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    if (event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch') {
      const rootCallId: unknown = event.data.rootCallId
      return typeof rootCallId === 'string' && rootCallId !== ''
        ? { id: rootCallId, role: 'update' }
        : null
    }
    return null
  },
  start: (_context, match) => {
    const root = rootCall(match)
    return {
      rootId: root.callId,
      calls: new Map([[root.callId, root]]),
      children: new Map(),
      parents: new Map(),
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return updateDispatch(context.state, match)
    const previous = context.state.calls.get(context.state.rootId)
    const running = previous !== undefined && !('kind' in previous) ? previous : undefined
    const result = rootResult(match, running)
    if (result === undefined) return context.state
    const calls = new Map(context.state.calls)
    calls.set(context.state.rootId, result)
    return { ...context.state, calls }
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    const root = projectCall(state, state.rootId, interruption(context))
    if (root === undefined) return null
    const anchorSeq = context.start?.event.seq
      ?? ('kind' in root ? root.seq : context.matches[0]?.event.seq ?? 0)
    return trajectoryNode(context, anchorSeq, { kind: 'tool', root })
  },
}
/* jscpd:ignore-end */

/**
 * Register the Trajectory Tool lifecycle with raw native and PTC error details.
 *
 * @param ctx - Plugin context receiving the Definition.
 */
export function registerTrajectoryToolDefinition(ctx: Context): void {
  ctx.uiConversation.events.register(trajectoryToolDefinition)
}
