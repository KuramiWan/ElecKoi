/**
 * 渲染层的「这个失败我确实不处理」三个具名声明。
 *
 * 实现只有一份：`packages/shared/src/foundation/swallowedFailure.ts`（纯函数、无依赖）。
 * 这里只转发，方便 `apps/web` 里的文件按本地相对路径引入。
 */
export {
  bestEffort,
  failureAlreadyPublished,
  rejectionIsAwaitedElsewhere,
} from "@shared/foundation/swallowedFailure";
