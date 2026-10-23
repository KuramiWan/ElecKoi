/**
 * 「这个失败我确实不处理」的三个**具名声明**。
 *
 * 判据来源：错误处理设计 §五（把 `.catch(() => {})` 换成有名字的回调，让代码自己说出理由）。
 *
 * 为什么需要名字：`.catch(() => {})` 与空 `catch {}` 在 review 里几乎不可见，而它们可能表示
 * 三种完全不同的决定。三个名字把决定写出来，`check:error-contract` 的规则 3 只认这三个标识符。
 *
 * | 名字 | 含义 | 典型位置 |
 * | --- | --- | --- |
 * | `failureAlreadyPublished` | 被调方已经把失败发进快照/流，订阅者拿得到 | 刷新、重载、订阅重建 |
 * | `rejectionIsAwaitedElsewhere` | 同一个 promise 在别处被 `await`，这里只是消除重复拒绝 | 提前接住的同一个 promise |
 * | `bestEffort` | 尽力而为的清理/预热/窗口显示/事件队列，失败不影响结果 | `dispose`、预热、UI 副作用 |
 *
 * ⚠️ **这是声明，不是证明**。闸只能看见名字，看不见"被调方到底有没有发布失败"；
 * 名字在 review 里比 `() => {}` 显眼得多，这就是它相对现状的全部收益。
 *
 * ⚠️ 客户端 bundle 那一侧有同名的另一份实现（`packages/host/product-api/src/client/swallowedFailure.ts`）：
 * 那 14 个 bundle 是运行时独立加载的，取不到本包。两份都只是三行空函数，语义必须一致。
 */

/** 被调方已经把失败发进快照/流；这里只是不重复处理。 */
export const failureAlreadyPublished = (): void => {}

/** 同一个 promise 在别处被 `await`；这里只消除重复的未处理拒绝。 */
export const rejectionIsAwaitedElsewhere = (): void => {}

/** 尽力而为的清理 / 预热 / 窗口显示 / 事件队列；失败不影响结果。 */
export const bestEffort = (): void => {}
