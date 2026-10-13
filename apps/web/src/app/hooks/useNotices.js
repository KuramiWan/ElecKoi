import { useCallback, useRef, useState } from "react";

/**
 * 窗口级 notice 队列（每个窗口自己的 React state，ADR 0002 决定 12）。
 *
 * 判据来源：`notes/eh-explore-renderer.md` §4.2/§4.3（原单槽实现的逐行机制）与
 * tickets/EH-8-error-surface.md §2（三个缺陷）。原实现是 `useChatClient.js` 里的一个 `useState`
 * 单槽，有三个缺陷，这里逐条修掉：
 *
 * 1. **连续两条错误只显示后一条**：原来是 `setNotice({ id, type, message })` 无条件覆盖。
 *    这里改成**追加到队列**（`[...current, notice]`），所以前一条不会被顶掉。
 * 2. **错误后接一条非错误会被自动消失的定时器丢掉**：原来定时器回调只比 `current?.id === id`，
 *    `id` 又是 `Date.now()`，撞号时会把**别的** notice（含 error）清掉。这里定时器按 id
 *    **只删自己那一条**（`filter`），而 id 见第 3 条唯一，所以它在结构上碰不到别的 notice。
 *    非 error 的 3200 ms 与「error 永不自动消失」两条**沿用原语义，没有新增**——全仓 21 处
 *    `notify` 调用全部传 `"error"`，非 error 分支今天没有生产者（不存在的语义不去发明）。
 * 3. **`id: Date.now()` 同毫秒撞号**：改成单调计数器（每个窗口一个 ref），同毫秒的两条 notice
 *    也各有各的 id。id 同时是 `AppErrorDialog` 的 React key 与 effect 依赖，所以撞号会让
 *    对话框的第二条错误不重置复制状态。
 *
 * `notify(type, message, failure?)`：`failure` 是**失败实例本身**（`RemoteError` 形状 / `Error` /
 * 任何抛出值），由 `AppErrorDialog` 交给 `apps/web/src/utils/failureText.js` 这个唯一解析点
 * 解析成用户可见文案与码/详情/诊断（ADR 决定 4/8）。只有消息、拿不到失败实例的调用点可以省掉
 * 它，那时对话框按兜底码显示消息。
 */
const NOTICE_TIMEOUT_MS = 3200;

export function useNotices() {
  const [notices, setNotices] = useState([]);
  const nextIdRef = useRef(0);

  const notify = useCallback((type, message, failure) => {
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setNotices((current) => [...current, { id, type, message, failure }]);
    if (type === "error") return;
    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, NOTICE_TIMEOUT_MS);
  }, []);

  const dismissNotice = useCallback(() => setNotices([]), []);

  return { notices, notify, dismissNotice };
}
