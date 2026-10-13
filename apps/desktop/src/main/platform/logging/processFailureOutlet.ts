import type { Logger } from 'pino'
import { foldFailure } from '@shared/foundation/failure'

/** 落点覆盖的两个进程事件。 */
export type ProcessFailureEvent = 'unhandledRejection' | 'uncaughtExceptionMonitor'

/**
 * 装落点需要的 `process` 那一小片。两个事件都是两个参数
 * （`unhandledRejection` 是 `(reason, promise)`，`uncaughtExceptionMonitor` 是 `(error, origin)`），
 * 所以一个签名够用。注入是为了让用例能在不注册真实进程事件的条件下断言
 * （与上游 `installFailLoud` 的注入是同一个理由）。
 */
export interface ProcessFailureTarget {
  on(event: ProcessFailureEvent, listener: (reason: unknown, detail: unknown) => void): unknown
  off(event: ProcessFailureEvent, listener: (reason: unknown, detail: unknown) => void): unknown
}

/**
 * 主进程的进程级失败落点（ADR 0002 决定 12 最后一条的主进程侧 / spec 决定 10）。
 *
 * 勘查事实（`notes/eh-explore-observability.md` §6）：全仓源码对四个进程事件的命中是 **0**，
 * 入口 `main.ts` 的 `void startDesktop()` 也没有 `.catch()` ⇒ 未被 catch 的拒绝与异常
 * 只能无声蒸发。这里把它们记进**同一个日志出口**（`AppLog` 的文件输出，见同目录 `AppLog.ts`），
 * 并折成契约的同一个可记录对象（⑦：任何边界都产出同一个 `{ code, message, details }`）。
 *
 * 三条边界上的取舍，写在这里免得后来者以为是漏了：
 *
 * 1. **未捕获异常用 `uncaughtExceptionMonitor` 而不是 `uncaughtException`。** 后者一旦装了就
 *    **取消** 进程的默认致命行为（只有抛出点知道哪些状态还完整，一个更新到一半的注册表会把
 *    错的结果留在身后），而本票要的只是「记进日志」，不是改崩溃策略。monitor 是纯观测：
 *    默认行为照旧，落点照样有记录。
 * 2. **未处理的拒绝只能装 `unhandledRejection`。** Node 没有 monitor 版本；Electron 主进程里
 *    一致性优先（渲染层那条落点同样是只报告、不 `preventDefault`，见
 *    `apps/web/src/utils/failureText.js` 的 `installUnhandledFailureReporting`）。
 * 3. **不在这里 `app.exit()` / `process.exit()`。** 退出码与收尾归 `main.ts` 的启动失败路径
 *    （`process.exitCode = 1` + `app.quit()`），落点只负责「记下来」。
 *
 * @param logger - 日志出口；`main.ts` 给 bootstrap logger（启动阶段的失败也走它）。
 * @param target - 进程事件来源；默认真实 `process`，用例注入假的。
 * @returns 卸载函数（撤掉两个监听者）。
 */
export function installProcessFailureOutlet(logger: Logger, target: ProcessFailureTarget = process): () => void {
  const onRejection = (reason: unknown): void => {
    logger.error(
      { event: 'unhandledRejection', ...failureFieldsOf(reason) },
      '主进程出现未处理的 Promise 拒绝'
    )
  }
  const onException = (error: unknown, origin: unknown): void => {
    logger.error(
      { event: 'uncaughtExceptionMonitor', origin: String(origin), ...failureFieldsOf(error) },
      '主进程出现未捕获异常'
    )
  }
  target.on('unhandledRejection', onRejection)
  target.on('uncaughtExceptionMonitor', onException)
  return () => {
    target.off('unhandledRejection', onRejection)
    target.off('uncaughtExceptionMonitor', onException)
  }
}

/**
 * 抛出值 → 契约的同一个可记录对象，再摊成 pino 的字段。
 *
 * `err` 只在真的是 `Error` 时才给：pino 的默认 `err` 序列化器能拿到 stack；非 `Error` 的抛出
 * （字符串 / 普通对象）靠 `message` 带出来，不塞进 `err` 免得序列化出 `[object Object]`。
 */
function failureFieldsOf(value: unknown): Record<string, unknown> {
  const failure = foldFailure(value)
  return {
    ...(value instanceof Error ? { err: value } : {}),
    code: failure.code,
    message: failure.message,
    details: failure.details
  }
}
