export type ParentHostMessage =
  | { type: 'update-tasks'; id: string; action: 'inspect' | 'lock' | 'unlock' }
  | { type: 'shutdown' }

export type ChildHostMessage =
  | { type: 'ready'; url: string; healthUrl: string; injections: readonly unknown[] }
  | { type: 'fatal'; message: string }
  | { type: 'shutdown-complete' }
  | { type: 'update-tasks-complete'; id: string; active: boolean; message?: string }

export const HOST_CONTROL_PROTOCOL_VERSION = 1
export const HOST_CONTROL_STDOUT_PREFIX = 'ELECKOI_HOST\t'

/** JSONL carries Android Host lifecycle controls, independently of product Remote calls. */
export function isParentHostMessage(value: unknown): value is ParentHostMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('type' in value)) return false
  const message = value as Record<string, unknown>
  const keys = Object.keys(message)
  if (message.type === 'shutdown') return keys.length === 1
  return message.type === 'update-tasks' && keys.length === 3 && keys.every(key => ['type', 'id', 'action'].includes(key))
    && typeof message.id === 'string' && message.id.length > 0 && typeof message.action === 'string'
    && ['inspect', 'lock', 'unlock'].includes(message.action)
}
