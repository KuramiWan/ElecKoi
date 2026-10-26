import { copy, fields, record, unsupported } from './common'
import { mergeAuthorVariableState } from '@eleckoi/author-sdk'

type Options = { type?: string; message_id?: string | number }
type State = Record<string, unknown>
type Updater = (value: State) => State | void | Promise<State | void>

/** Synchronous callers see their pending edits; only the native SDK commits them. */
export function createVariableFunctions(runtime: {
  available(): void; state(): State; historical(id: string | number): State
  ownerCheck(): () => Promise<void>
  stage(value: State): Promise<void>; track(operation: Promise<unknown>): void
}) {
  const scope = (options: Options = {}, writing = false): Options => {
    runtime.available(); fields(record(options, '变量选项'), ['type', 'message_id'], '变量选项')
    if ((options.type ?? 'chat') === 'chat') {
      if (options.message_id !== undefined) unsupported('聊天变量的 message_id')
    } else if (options.type !== 'message' || writing) unsupported(`${options.type} 变量${writing ? '写入' : '读取'}`)
    return options
  }
  const getVariables = (options: Options = {}): State => {
    scope(options)
    if (options.type === 'message') return runtime.historical(options.message_id === 'latest' ? -1 : options.message_id ?? -1)
    return copy(runtime.state())
  }
  const save = (value: unknown, options: Options): State => {
    scope(options, true)
    const next = copy(record(value, '变量状态')); runtime.track(runtime.stage(next)); return copy(next)
  }
  const updateVariablesWith = (updater: Updater, options: Options = {}): State | Promise<State> => {
    scope(options, true)
    if (typeof updater !== 'function') throw new TypeError('变量修改器必须是函数。')
    const current = getVariables(options), checkOwner = runtime.ownerCheck(), next = updater(current)
    return next && typeof (next as Promise<unknown>).then === 'function'
      ? Promise.resolve(next).then(async value => { await checkOwner(); return save(value === undefined ? current : value, options) })
      : save(next === undefined ? current : next, options)
  }
  return {
    getVariables,
    replaceVariables(value: State, options: Options = {}): void { save(value, options) },
    updateVariablesWith,
    insertOrAssignVariables(value: State, options: Options = {}): State {
      scope(options, true); record(value, '合并变量')
      return save(mergeAuthorVariableState(getVariables(options), value), options)
    },
    insertVariables(value: State, options: Options = {}): State {
      scope(options, true); record(value, '新增变量')
      return save(mergeAuthorVariableState(value, getVariables(options)), options)
    },
    deleteVariable(path: string | Array<string | number>, options: Options = {}) {
      scope(options, true)
      const parts = Array.isArray(path) ? path : typeof path === 'string' && path.length ? path.split('.') : []
      if (!parts.length || parts.some(part => typeof part !== 'string' && !Number.isSafeInteger(part)
        || String(part).length === 0 || ['__proto__', 'prototype', 'constructor'].includes(String(part)))) throw new TypeError('变量路径无效。')
      if (!Array.isArray(path) && /[\[\]\\]/.test(path)) unsupported('此种变量路径语法；请传入明确的路径数组')
      const state = getVariables(options)
      let target: any = state
      for (const part of parts.slice(0, -1)) {
        if (!target || typeof target !== 'object' || !Object.hasOwn(target, part)) return { variables: state, delete_occurred: false }
        target = target[part]
      }
      const key = parts[parts.length - 1]
      if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) return { variables: state, delete_occurred: false }
      if (Array.isArray(target)) unsupported('通过 deleteVariable 删除数组槽位；请通过原生变量接口明确修改数组')
      delete target[key]
      return { variables: save(state, options), delete_occurred: true }
    },
  }
}
