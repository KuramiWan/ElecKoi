import { AuthorApiError } from './errors'

type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string; readonly code?: string } }

/** Structural face of the generated native Remote, without a DSH runtime dependency. */
export interface AuthorVariablesRemote {
  getState(conversationId: string): Promise<Result<string>>
  getConfig(conversationId: string): Promise<Result<unknown>>
  setState(conversationId: string, stateJson: string, signal?: AbortSignal): Promise<Result<string>>
  merge(conversationId: string, stateJson: string, signal?: AbortSignal): Promise<Result<string>>
  applyPatch(conversationId: string, patchJson: string, signal?: AbortSignal): Promise<Result<string>>
  reset(conversationId: string, signal?: AbortSignal): Promise<Result<string>>
}

export interface AuthorRequestOptions {
  signal: AbortSignal
  /** Called only when a validated navigation is handed to the conversation owner. */
  commitContextChange?(): void
}

export type AuthorVariableBinding = (params: Record<string, unknown>, options: AuthorRequestOptions) => Promise<unknown>

function unwrap<T>(result: Result<T>): T {
  if (!result || typeof result.ok !== 'boolean') throw new TypeError('原生变量服务没有返回 Remote 结果。')
  // 直接抛失败对象：码与详情逐字保留；折叠按结构标记识别，不需要 Error 实例。
  if (!result.ok) throw result.error
  return result.value
}

function stateResult(result: Result<string>): Record<string, unknown> {
  const state: unknown = JSON.parse(unwrap(result))
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('原生变量服务没有返回 JSON 对象。')
  return state as Record<string, unknown>
}

/** Binds only current conversation state; historical state belongs to its explicit message service. */
export function createAuthorVariableBindings(
  remote: AuthorVariablesRemote,
  getConversationId: () => string
): Record<string, AuthorVariableBinding> {
  const conversation = (params: Record<string, unknown>, signal: AbortSignal) => {
    signal.throwIfAborted()
    const id = params.conversationId === undefined ? getConversationId() : params.conversationId
    if (typeof id !== 'string' || !id) throw new AuthorApiError('CHAT_NOT_READY', '作者页面尚未绑定聊天。')
    if (params.messageId !== undefined) throw new AuthorApiError('METHOD_NOT_AVAILABLE', '当前变量服务不提供历史消息变量。')
    return id
  }
  return {
    'variables.getState': async (params, { signal }) => stateResult(await remote.getState(conversation(params, signal))),
    'variables.getConfig': async (params, { signal }) => unwrap(await remote.getConfig(conversation(params, signal))),
    'variables.setState': async (params, { signal }) => stateResult(await remote.setState(conversation(params, signal), JSON.stringify(params.state), signal)),
    'variables.merge': async (params, { signal }) => stateResult(await remote.merge(conversation(params, signal), JSON.stringify(params.state), signal)),
    'variables.applyPatch': async (params, { signal }) => stateResult(await remote.applyPatch(conversation(params, signal), JSON.stringify(params.patch), signal)),
    'variables.reset': async (params, { signal }) => stateResult(await remote.reset(conversation(params, signal), signal)),
  }
}
