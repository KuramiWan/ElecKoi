/**
 * 边界③（宿主 ↔ DSH 子进程）的折帧：子进程的 fatal 帧 → 父进程侧的契约失败。
 *
 * 判据来源：`contracts/errors/boundaries.ts` 的第 3 条边界；帧形状见
 * `apps/desktop-host/src/hostSessionProtocol.ts` 的 `ChildHostMessage`。
 *
 * **不重新猜语义**：帧里带契约码就原样搬（码 + 参数化详情 + 子进程栈）；不带码（老版本子进程，
 * 或子进程自己也没折出来）就折成兜底码，并把原样信息留在 `details.what` 里。
 * 父进程看不懂 DSH 的异常，所以它这里只做搬运——折码是子进程的事（`foldFailure`）。
 *
 * 纯函数、不碰进程：`DshDesktopPluginHost` 在 `child.on('message')` 里调它，
 * 用例直接喂帧就能验（`apps/desktop-host/tests/child-host-failure.test.ts`）。
 */
import { ELECKOI_FAILURE_CODES, isEleckoiFailureCode } from '@shared/contracts/errors/codes'
import { DesktopError, type AnyProductFailureCode } from '@shared/foundation/DesktopError'
import type { ChildHostMessage } from './hostSessionProtocol'

/** fatal 帧（已通过形状校验的那一支）。 */
export type ChildHostFatalFrame = Extract<ChildHostMessage, { type: 'fatal' }>

/**
 * fatal 帧 → 父进程侧的产品失败。
 *
 * @param frame - 已通过 {@link isChildFatalFrame} 校验的 fatal 帧。
 * @returns 带契约码的产品失败（`onFailure` 的载荷，也是宿主失败通知的来源）。
 */
export function pluginHostFailureOf(frame: ChildHostFatalFrame): DesktopError {
  const coded = frame.code !== undefined && isEleckoiFailureCode(frame.code)
  const code: AnyProductFailureCode = coded ? frame.code as AnyProductFailureCode : ELECKOI_FAILURE_CODES.internal
  // 认不出的码不猜语义：折兜底，原码进 what（与 `foldFailure` 同一套规矩）。
  const details = coded
    ? (frame.details ?? {})
    : { ...(frame.details ?? {}), what: frame.code ?? '子进程未提供失败码' }
  const failure = new DesktopError(code, frame.message, details)
  // 诊断以子进程为准：父进程只是搬运它的栈。
  if (frame.stack !== undefined) failure.stack = frame.stack
  return failure
}

/**
 * 判断一个值是不是形状合法的 fatal 帧。
 *
 * 只要求 `message` 是字符串；`code` / `stack` 是字符串或缺失，`details` 是扁平对象或缺失。
 * `logPath` 不是帧字段（宿主收到 fatal 帧后自己记录本机日志路径），帧上出现也按未知字段忽略。
 * **不校验码在不在码表里**：认不出的码由 {@link pluginHostFailureOf} 折兜底并把原码记进详情——
 * 绝不能让「码不认识」把一次失败变成静默成功。
 *
 * @param value - 子进程消息的任意字段值。
 * @returns 是不是合法 fatal 帧。
 */
export function isChildFatalFrame(value: unknown): value is ChildHostFatalFrame {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Record<string, unknown>
  if (frame.type !== 'fatal') return false
  if (typeof frame.message !== 'string') return false
  if (frame.code !== undefined && typeof frame.code !== 'string') return false
  if (frame.stack !== undefined && typeof frame.stack !== 'string') return false
  if (frame.details === undefined) return true
  return typeof frame.details === 'object' && frame.details !== null && !Array.isArray(frame.details)
}
