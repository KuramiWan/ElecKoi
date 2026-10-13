import { resolveFailure } from "./failureText.js";

/**
 * 边界⑤ 的宿主失败通知 → notice 载荷（`useNotices` 的 `notify` 三个实参）。
 *
 * 判据来源：ADR 0002 决定 4/8（用户可见文案**只有一个解析点**，在渲染层；宿主侧不拼用户可见句子）、
 * spec 决定 8、票 EH-11 的 G 项。
 *
 * 宿主（`apps/desktop/src/main/platform/electron/mainWindowPlugin.ts`）送过来的是**失败对象**：
 * `{ isDSHRemoteError: true, code, message, details, stack?, logPath? }`。所以：
 *
 * - `failure` 原样交给 notice——`AppErrorDialog` 要用它显示失败码、参数化详情与诊断尾部；
 * - `message` **只能**由这个解析点给（`resolveFailure(failure).text`），它同时是对话框给不出说法时的
 *   兜底文案。宿主那句固定中文（“插件服务意外退出，请重新打开插件中心。”）已经删掉——它既不
 *   属于契约，也是宿主在拼用户可见句子。
 *
 * @param failure - 宿主送来的失败对象（任何抛出值都行，解析点永不抛）。
 * @returns `{ type, message, failure }`，直接喂 `notify(type, message, failure)`。
 */
export function hostFailureNotice(failure) {
  return { type: "error", message: resolveFailure(failure).text, failure };
}
