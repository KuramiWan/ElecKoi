/**
 * 客户端 bundle 侧的「这个失败我确实不处理」三个具名声明。
 *
 * 与 `packages/shared/src/foundation/swallowedFailure.ts` **同名同义**：那 14 个
 * `dsh-client-*` bundle 是运行时经 `window.__ModuleLoader__` 独立加载的，取不到契约包源码，
 * 只能从本包（`@eleckoi/dsh-product-api` 的 client 面，它们 `inject` 了它）拿到这三个名字。
 *
 * 三个名字的含义见契约包那份文件的表；这里只是三行空函数，**不要在这里加逻辑**。
 */

/** 被调方已经把失败发进快照/流；这里只是不重复处理。 */
export const failureAlreadyPublished = (): void => {}

/** 同一个 promise 在别处被 `await`；这里只消除重复的未处理拒绝。 */
export const rejectionIsAwaitedElsewhere = (): void => {}

/** 尽力而为的清理 / 预热 / 窗口显示 / 事件队列；失败不影响结果。 */
export const bestEffort = (): void => {}
