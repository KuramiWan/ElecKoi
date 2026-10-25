import { AuthorApiError } from './errors'

/** Validate before serialization so unsupported authored values cannot disappear silently. */
export function serializeAuthorJsonValue(state: unknown, framePrototypes: unknown[], code = 'INVALID_PARAMS'): string {
  const prototypes = new Set([Object.prototype, null, ...framePrototypes]), ancestors = new Set<object>()
  const check = (value: unknown) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return
    if (!value || typeof value !== 'object' || ancestors.has(value)
      || !Array.isArray(value) && !prototypes.has(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) {
      throw new AuthorApiError(code, '数据包含无法保存为 JSON 的值')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(descriptors, String(i))) throw new AuthorApiError(code, '数据包含稀疏数组')
    }
    ancestors.add(value)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
        || Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        throw new AuthorApiError(code, '数据包含无法保存的属性')
      }
      check(descriptor.value)
    }
    ancestors.delete(value)
  }
  check(state); return JSON.stringify(state)
}

export function serializeAuthorJsonObject(state: unknown, framePrototypes: unknown[], code = 'INVALID_RULE_STATE'): string {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new AuthorApiError(code, '数据必须是 JSON 对象')
  return serializeAuthorJsonValue(state, framePrototypes, code)
}
