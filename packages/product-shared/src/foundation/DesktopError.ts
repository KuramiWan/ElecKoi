import type { EleckoiFailureCode } from '../contracts/errors/codes.js'

/**
 * 6 个 legacy 码。**公开面，保留不动**（ADR 0002 决定 7 / spec 决定 1）。
 * 新代码不许再用它们——领域侧用 `../contracts/errors/codes.ts` 的契约码，
 * 残留的 legacy 码在边界上由 `./failure.ts` 的防御映射接住。
 */
export const DESKTOP_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  INTERNAL: 'INTERNAL'
} as const

export type DesktopErrorCode = typeof DESKTOP_ERROR_CODES[keyof typeof DESKTOP_ERROR_CODES]

export class DesktopError extends Error {
  constructor(
    // 放宽为「legacy 码或契约码」：EH-3 之前抛出点仍写 legacy 码、之后写契约码，
    // 两类都要能构造，否则迁移期得在两套类型之间来回转（ADR 0002 决定 14）。
    readonly code: DesktopErrorCode | EleckoiFailureCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'DesktopError'
  }
}
