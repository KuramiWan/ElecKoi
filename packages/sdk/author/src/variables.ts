import { AuthorApiError } from './errors'

export type AuthorVariableState = Record<string, unknown>
export type AuthorVariablePatch =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }

function object(value: unknown, message: string): AuthorVariableState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthorApiError('INVALID_PARAMS', message)
  }
  return value as AuthorVariableState
}

export function mergeAuthorVariableState(current: AuthorVariableState, patch: unknown): AuthorVariableState {
  const result = structuredClone(object(current, '变量状态必须是一个对象'))
  for (const [key, value] of Object.entries(object(patch, '合并的变量必须是一个对象'))) {
    const previous = Object.hasOwn(result, key) ? result[key] : undefined
    const merged = previous && typeof previous === 'object' && !Array.isArray(previous)
      && value && typeof value === 'object' && !Array.isArray(value)
      ? mergeAuthorVariableState(previous as AuthorVariableState, value)
      : structuredClone(value)
    Object.defineProperty(result, key, { value: merged, enumerable: true, writable: true, configurable: true })
  }
  return result
}

function pointerParts(path: unknown): string[] {
  if (typeof path !== 'string' || (path !== '' && !path.startsWith('/')) || /~(?:[^01]|$)/.test(path)) {
    throw new AuthorApiError('INVALID_PARAMS', '变量补丁路径必须是 JSON Pointer')
  }
  return path === '' ? [] : path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function arrayIndex(part: string, length: number, allowEnd: boolean): number {
  if (allowEnd && part === '-') return length
  if (!/^(0|[1-9]\d*)$/.test(part)) throw new AuthorApiError('INVALID_PARAMS', `无效的数组位置：${part}`)
  const index = Number(part)
  if (!Number.isSafeInteger(index) || index > length || (!allowEnd && index === length)) {
    throw new AuthorApiError('INVALID_PARAMS', `数组位置超出范围：${part}`)
  }
  return index
}

export function applyAuthorVariablePatch(current: AuthorVariableState, rawPatch: unknown): AuthorVariableState {
  if (!Array.isArray(rawPatch)) throw new AuthorApiError('INVALID_PARAMS', '变量补丁必须是操作数组')
  let root: unknown = structuredClone(object(current, '变量状态必须是一个对象'))
  for (const item of rawPatch) {
    const operation = object(item, '变量补丁操作必须是对象')
    const op = operation.op
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw new AuthorApiError('INVALID_PARAMS', `不支持的变量补丁操作：${String(op)}`)
    }
    if (op !== 'remove' && !Object.hasOwn(operation, 'value')) {
      throw new AuthorApiError('INVALID_PARAMS', `${op} 操作必须提供 value`)
    }
    const parts = pointerParts(operation.path)
    if (parts.length === 0) {
      root = op === 'remove' ? {} : structuredClone(operation.value)
      continue
    }
    let parent = root
    for (const part of parts.slice(0, -1)) {
      if (Array.isArray(parent)) parent = parent[arrayIndex(part, parent.length, false)]
      else if (parent && typeof parent === 'object' && Object.hasOwn(parent, part)) {
        parent = (parent as AuthorVariableState)[part]
      } else throw new AuthorApiError('INVALID_PARAMS', `变量补丁找不到路径：${String(operation.path)}`)
    }
    const key = parts.at(-1)!
    if (Array.isArray(parent)) {
      const index = arrayIndex(key, parent.length, op === 'add')
      if (op === 'add') parent.splice(index, 0, structuredClone(operation.value))
      else if (op === 'replace') parent[index] = structuredClone(operation.value)
      else parent.splice(index, 1)
    } else if (parent && typeof parent === 'object') {
      if (op !== 'add' && !Object.hasOwn(parent, key)) {
        throw new AuthorApiError('INVALID_PARAMS', `变量补丁找不到路径：${String(operation.path)}`)
      }
      if (op === 'remove') delete (parent as AuthorVariableState)[key]
      else Object.defineProperty(parent, key, { value: structuredClone(operation.value), enumerable: true, writable: true, configurable: true })
    } else throw new AuthorApiError('INVALID_PARAMS', `变量补丁找不到路径：${String(operation.path)}`)
  }
  return object(root, '变量补丁的最终结果必须是一个对象')
}
