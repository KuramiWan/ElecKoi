/**
 * 宿主 ↔ DSH 子进程的消息协议（错误契约边界③的规范形态）。
 *
 * 判据来源：ADR 0002 决定 10 与订正 a、spec 决定 9。三条一起读：
 *
 * 1. **版本住在这个文件里。** `HOST_SESSION_PROTOCOL_VERSION` 是子进程协议的版本，两端同仓、
 *    同一次构建发布（不存版本偏斜的兼容层）。`ready` 帧带着它，消费侧用**同一个常量**断言。
 *    `ElecKoiHostStatus.protocolVersion` 是另一件事（宿主 ↔ 客户端的 Remote 状态，`dsh-remote`），
 *    它保持 1 不动——ADR 0002 订正 a 把这两件事分开了。
 * 2. **诊断用指针不用正文。** `fatal` 只带 `stack` 与 `logPath` 指针，不把整段日志塞进 `message`
 *    （ADR 决定 10）。
 * 3. **字段是另一个进程送来的 JSON。** `fatal.code` 的合同值是契约码（EH-1 的 13 条之一，
 *    **不许**用 legacy 6 码），但线上只保证是字符串：跨进程没有类型，能守的只有运行期判定，
 *    所以消费侧不假设它在码表里（不在表里折兜底码、原码进 `details.what`，见 `desktopPluginHost.ts`）。
 */

/** 子进程协议版本。生产侧（`ready` 帧）与消费侧（断言）都读这一个常量。 */
export const HOST_SESSION_PROTOCOL_VERSION = 2

export type ParentHostMessage =
  | { type: 'update-tasks'; id: string; action: 'inspect' | 'lock' | 'unlock' }
  | { type: 'shutdown' }

/** 子进程就绪：带上协议版本、Web 前端地址与注入项。 */
export interface ChildHostReadyMessage {
  readonly type: 'ready'
  readonly protocolVersion: number
  readonly url: string
  readonly injections: readonly unknown[]
}

/**
 * 子进程致命失败。诊断以 `stack` 与 `logPath` 指针承载（ADR 决定 10：不把整段日志塞进消息）；
 * `code` 的合同值是契约码，线上形态见本文件头第 3 条。
 */
export interface ChildHostFatalMessage {
  readonly type: 'fatal'
  readonly code?: string
  readonly message: string
  readonly stack?: string
  readonly logPath?: string
}

export type ChildHostMessage =
  | ChildHostReadyMessage
  | ChildHostFatalMessage
  | { type: 'shutdown-complete' }
  | { type: 'update-tasks-complete'; id: string; active: boolean; message?: string }

/**
 * 组装 `ready` 帧。子进程入口用它发帧（覆盖代理用例断言入口确实调它），
 * 所以「生产侧与消费侧读到的是同一个常量」有行为证据：版本只从
 * {@link HOST_SESSION_PROTOCOL_VERSION} 来，不在这里另写一个字面量。
 */
export function readyChildMessage(url: string, injections: readonly unknown[]): ChildHostReadyMessage {
  return { type: 'ready', protocolVersion: HOST_SESSION_PROTOCOL_VERSION, url, injections }
}
