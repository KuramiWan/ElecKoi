export class FrontendCompatibilityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'FrontendCompatibilityError' }
}

export const copy = <T>(value: T): T => structuredClone(value)
export function unsupported(feature: string): never {
  throw new FrontendCompatibilityError('COMPATIBILITY_UNSUPPORTED', `前端兼容层不支持 ${feature}；请使用 ElecKoi SDK 已公开的能力。`)
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 必须是对象。`)
  return value as Record<string, unknown>
}
export function fields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) unsupported(`${label}.${key}`)
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
