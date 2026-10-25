import { AuthorApiError, type AuthorScriptCaller, type AuthorScriptEndpoint, type AuthorScriptIdentity } from '@eleckoi/author-sdk'
import type { AuthorHostAdapter } from '@eleckoi/author-sdk/browser'
import type { NativeAuthorScript } from '@eleckoi/dsh-product-api/types'

type Handler = Parameters<NonNullable<AuthorHostAdapter['registerScriptHandler']>>[1]
interface Owner {
  script: NativeAuthorScript
  abort: AbortController
  actions: Map<string, { handler: Handler; abort: AbortController }>
}

/** Request handlers and pending calls belong to one Client chat and catalog generation. */
export class NativeScriptRequests {
  private readonly owners = new Map<string, Owner>()

  createOwner(script: NativeAuthorScript): { register: NonNullable<AuthorHostAdapter['registerScriptHandler']>; dispose(): void } {
    const identity = { scope: script.scope, ownerId: script.ownerId, scriptId: script.id }, key = identityKey(identity)
    if (this.owners.has(key)) throw new AuthorApiError('SCRIPT_ID_CONFLICT', '运行脚本身份重复')
    const owner: Owner = { script, abort: new AbortController(), actions: new Map() }
    this.owners.set(key, owner)
    return {
      register: (action, handler) => {
        owner.abort.signal.throwIfAborted()
        if (owner.actions.has(action)) throw new AuthorApiError('SCRIPT_ACTION_CONFLICT', `同一脚本的操作名重复：${action}`)
        const entry = { handler, abort: new AbortController() }
        owner.actions.set(action, entry)
        return () => {
          if (owner.actions.get(action) !== entry) return
          owner.actions.delete(action)
          entry.abort.abort(new AuthorApiError('SCRIPT_ACTION_CLOSED', '脚本操作已撤回'))
        }
      },
      dispose: () => {
        if (this.owners.get(key) !== owner) return
        this.owners.delete(key)
        owner.abort.abort(new AuthorApiError('SCRIPT_CLOSED', '目标脚本已停用或替换'))
        owner.actions.clear()
      }
    }
  }

  list(): { items: AuthorScriptEndpoint[] } {
    return { items: [...this.owners.values()].map(({ script, actions }) => ({
      identity: { scope: script.scope, ownerId: script.ownerId, scriptId: script.id }, name: script.name, actions: [...actions.keys()]
    })) }
  }

  async request(target: unknown, action: unknown, dataJson: unknown, caller: AuthorScriptCaller, callerSignal: AbortSignal): Promise<unknown> {
    const key = identityKey(target)
    if (typeof action !== 'string' || !action.trim() || typeof dataJson !== 'string') {
      throw new AuthorApiError('INVALID_PARAMS', '脚本请求需要操作名和 JSON 数据')
    }
    const owner = this.owners.get(key)
    if (!owner) throw new AuthorApiError('SCRIPT_UNAVAILABLE', '当前聊天没有运行该身份的脚本')
    const entry = owner.actions.get(action)
    if (!entry) throw new AuthorApiError('SCRIPT_ACTION_UNAVAILABLE', `目标脚本未登记操作：${action}`)
    const abort = new AbortController(), signal = abort.signal
    const sources = [callerSignal, owner.abort.signal, entry.abort.signal]
    const stops = sources.map(source => {
      const cancel = () => abort.abort(source.reason)
      source.addEventListener('abort', cancel, { once: true })
      if (source.aborted) cancel()
      return () => source.removeEventListener('abort', cancel)
    })
    let cancel = () => {}
    try {
      signal.throwIfAborted()
      return await new Promise((resolve, reject) => {
        cancel = () => reject(signal.reason)
        signal.addEventListener('abort', cancel, { once: true })
        Promise.resolve().then(() => {
          signal.throwIfAborted()
          return entry.handler({ dataJson, caller: structuredClone(caller), signal })
        }).then(result => {
          signal.throwIfAborted()
          resolve(JSON.parse(result))
        }).catch(error => {
          if (signal.aborted) reject(signal.reason)
          else reject(new AuthorApiError(typeof error?.code === 'string' ? error.code : 'SCRIPT_HANDLER_FAILED',
            typeof error?.message === 'string' ? error.message : String(error)))
        })
      })
    } finally {
      signal.removeEventListener('abort', cancel)
      for (const stop of stops) stop()
      abort.abort(new AuthorApiError('SCRIPT_REQUEST_FINISHED', '本次脚本操作已经结束'))
    }
  }

  close(): void {
    const owners = [...this.owners.values()]
    this.owners.clear()
    for (const owner of owners) {
      owner.abort.abort(new AuthorApiError('SCRIPT_CLOSED', '脚本运行环境已关闭或替换'))
      owner.actions.clear()
    }
  }
}

function identityKey(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthorApiError('INVALID_PARAMS', '脚本目标必须包含 scope、ownerId 和 scriptId')
  const target = value as AuthorScriptIdentity
  if (Object.keys(target).length !== 3 || !['scope', 'ownerId', 'scriptId'].every(key => Object.hasOwn(target, key))
    || !['global', 'character', 'preset'].includes(target.scope) || typeof target.ownerId !== 'string'
    || (target.scope === 'global' ? target.ownerId !== '' : !target.ownerId.trim())
    || typeof target.scriptId !== 'string' || !target.scriptId.trim()) {
    throw new AuthorApiError('INVALID_PARAMS', '脚本目标需要完整且明确的 scope、ownerId 和 scriptId')
  }
  return JSON.stringify([target.scope, target.ownerId, target.scriptId])
}
