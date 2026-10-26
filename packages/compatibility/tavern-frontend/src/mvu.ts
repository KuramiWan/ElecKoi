import { copy, fields, freeze, record, unsupported } from './common'

type State = Record<string, unknown>
type Options = { type?: string; message_id?: string | number }

export const frontendMvuEvents = Object.freeze({ VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended' })

/** Native JSON snapshots are complete states, including removed fields. */
function sameJson(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]]
  while (pending.length) {
    const [a, b] = pending.pop()!
    if (a === b) continue
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false
      pending.push([(a as State)[key], (b as State)[key]])
    }
  }
  return true
}

/** The display envelope is detached; native storage keeps its single variable tree. */
export function createMvuProjection(runtime: {
  available(): void
  chat(): State
  historical(id: string | number): State
  publish(event: string, after: unknown, before: unknown): void
}) {
  const envelope = (state: State) => ({ stat_data: copy(state) })
  const getMvuData = (options: Options = {}) => {
    runtime.available(); fields(record(options, '变量读取选项'), ['type', 'message_id'], '变量读取选项')
    const type = options.type ?? 'chat'
    if (type === 'message') return envelope(runtime.historical(options.message_id === 'latest' ? -1 : options.message_id ?? -1))
    if (type !== 'chat') unsupported(`${type} 变量读取`)
    if (options.message_id !== undefined) unsupported('聊天变量的 message_id')
    return envelope(runtime.chat())
  }
  const api = Object.freeze({ events: frontendMvuEvents, getMvuData })
  return {
    api,
    getAllVariables(...args: unknown[]) {
      runtime.available()
      if (args.length) unsupported('getAllVariables 的参数')
      return envelope(runtime.chat())
    },
    changed(before: State, after: State) {
      if (!sameJson(before, after)) runtime.publish(frontendMvuEvents.VARIABLE_UPDATE_ENDED,
        freeze(envelope(after)), freeze(envelope(before)))
    },
  }
}

/** Document-local readiness and diagnostics never publish a cross-page service. */
export function createFrontendUtilities(runtime: {
  available(): void
  mvu(): unknown
  report(error: unknown): void
}) {
  return {
    async waitGlobalInitialized(name: string) {
      runtime.available()
      if (name !== 'Mvu') unsupported(`全局接口 ${String(name)}`)
      return runtime.mvu()
    },
    errorCatched<T extends unknown[], U>(fn: (...args: T) => U): (...args: T) => U {
      runtime.available()
      if (typeof fn !== 'function') throw new TypeError('错误包装器需要一个函数。')
      return function (this: unknown, ...args: T): U {
        runtime.available()
        try {
          const value = fn.apply(this, args)
          if (value && typeof (value as unknown as PromiseLike<unknown>).then === 'function') {
            return Promise.resolve(value).catch(error => { runtime.report(error); throw error }) as U
          }
          return value
        } catch (error) { runtime.report(error); throw error }
      }
    },
  }
}
