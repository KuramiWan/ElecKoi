/**
 * 渲染层的动作日志：一行一个动作阶段，经 `console` 由主进程的 console-message 桥落盘。
 *
 * 设计判据：关键路径的日志带语义操作名（动作语义键见 `packages/shared/src/contracts/logActions.ts`）。
 *
 * 为什么走 `console` 而不是新开 IPC：WP13 已经用这条路把渲染层的未处理失败转进主进程日志
 * （`reportFailure` 只 `console.error`，`mainWindowPlugin` 的 console-message 桥转发），
 * 本包沿用同一个出口，不新增通道。代价是主进程能收到任意页面脚本的 console 行，所以只收
 * 固定前缀 `eleckoi-action ` + 动作键白名单校验过的行（见 `parseActionLogMessage`）。
 *
 * 键表与一句话的形状都在 `@shared`（与主进程同一份）：渲染层写不出主进程不认识的键。
 */
import { LOG_ACTIONS } from "@shared/contracts/logActions";
import { describeAction, formatActionLogMessage } from "@shared/foundation/actionLog";

export { LOG_ACTIONS };

/**
 * 写一行动作日志（开始 / 成功 / 失败各调一次）。
 *
 * @param action - `LOG_ACTIONS` 里的语义键。
 * @param phase - `"start"` / `"success"` / `"failure"`。
 * @param failure - 失败阶段的抛出值（任意形态，内部折成契约码 + 详情）；其余阶段忽略。
 */
export function logAction(action, phase, failure) {
  try {
    const line = formatActionLogMessage(describeAction(action, phase, failure));
    if (phase === "failure") console.error(line);
    else console.info(line);
  } catch (error) {
    // 日志永远不能成为操作失败的原因（例如失败对象不可序列化）。
    console.error("[eleckoi-action-log-failed]", error);
  }
}

/**
 * 跑一段操作为一次动作：开始一行、成功一行或失败一行；失败原样抛出，调用点原有错误处理不变。
 *
 * @param action - `LOG_ACTIONS` 里的语义键。
 * @param operation - 真正做事的零参函数（同步或异步）。
 * @returns `operation` 的返回值。
 */
export async function runLoggedAction(action, operation) {
  logAction(action, "start");
  try {
    const result = await operation();
    logAction(action, "success");
    return result;
  } catch (error) {
    logAction(action, "failure", error);
    throw error;
  }
}
