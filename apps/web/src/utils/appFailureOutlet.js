/**
 * 应用级失败的出口（模块级订阅）。
 *
 * 判据来源：ADR 0040 决定 4/8（用户可见文案只有一个解析点）与 `failureText.js` 的通道设计。
 * 码表里有五条码默认走**应用级**通道（`APP_LEVEL_CODES`：插件装载失败、库结构不符、存储损坏、
 * 调用来源不可信、服务已关闭）：它们不属于某个窗口或面板，就地显示会让人以为只有某个功能坏了。
 *
 * 功能内失败面（`FailureAlert`）命中这些码时**不就地渲染**，改为交给这里。每个宿主窗口
 * （带 `AppToast` 的 MainWindow / ChatWindow / MobileWindow）在挂载时订阅，把失败接到窗口级的
 * `notify("error", resolved.text, resolved)` → `AppErrorDialog`：对话框里码与参数化详情仍然可见。
 *
 * 为什么是模块级订阅，而不是给 `FailureAlert` 逐层传 `onEscalate`：失败面在 23 个文件里用了
 * 38 次，一路传回调会把「升级」变成每个调用点都得记得写的东西，漏一处就把应用级失败留在角落；
 * 订阅让失败面自己送出去，既有与新增调用点都自动生效。**不新增 IPC 通道**：失败对象本来就在
 * 渲染层，应用级通道只是呈现位置的搬运。
 *
 * 没有订阅者时（单测、SSR、窗口还没挂载）`hasAppFailureListener()` 为 false，`FailureAlert`
 * 退回就地渲染——宁可显示在角落，也不能让失败消失。
 */
import { reportFailure } from "./failureText.js";

/** 正在接收应用级失败的窗口回调。 */
const listeners = new Set();

/**
 * 订阅应用级失败。窗口在挂载时调用，返回值直接当 `useEffect` 的清理函数。
 *
 * @param listener - 收到 `resolveFailure` 结果的回调（典型写法见文件头）。
 * @returns 退订函数；`listener` 不是函数时返回空操作。
 */
export function subscribeAppFailure(listener) {
  if (typeof listener !== "function") return noopUnsubscribe;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 有没有窗口在接收应用级失败。
 * 失败面用它决定「升级」还是「就地渲染」：没有出口时留在原地比整个隐藏好。
 *
 * @returns 至少有一个订阅者时为 true。
 */
export function hasAppFailureListener() {
  return listeners.size > 0;
}

/**
 * 把一条解析好的应用级失败交给订阅者。
 *
 * @param resolved - `resolveFailure` 的产物（`code` / `details` / `text` / `diagnostic`）。
 * @returns 至少有一个订阅者收到时为 true；没有订阅者时为 false（调用方据此退回就地呈现）。
 */
export function reportAppFailure(resolved) {
  if (!resolved) return false;
  let delivered = false;
  for (const listener of [...listeners]) {
    try {
      listener(resolved);
      delivered = true;
    } catch (error) {
      // 一个窗口的提示失败不该挡住其它窗口收到这条应用级失败；诊断仍要落到日志里。
      reportFailure(error, "应用级失败出口的订阅者抛错");
    }
  }
  return delivered;
}

/** 给非法入参的退订函数：窗口拿它当清理函数不会出错。 */
function noopUnsubscribe() {}
