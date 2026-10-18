/**
 * 边界⑤（主进程 ↔ 渲染层）的失败**线上形状**。
 *
 * 判据来源：ADR 0002 决定 2（边界闭集 ⑤）、`contracts/errors/boundaries.ts` 的 ⑤ 行
 * （「结构化克隆的失败对象」）、票 EH-5 第 2 节。
 *
 * **为什么失败要以「返回的对象」过边界，而不是「抛出的 Error」**：`ipcMain.handle` 的 handler 抛出时
 * 跨进程只带得走 message——contextBridge 的官方类型表写明 Error 的自定义属性**会丢**
 * （https://www.electronjs.org/docs/latest/api/context-bridge 的 Error 行，electron/electron#25596）。
 * 所以码与详情只能作为**结构化克隆得到的普通对象**移动。
 *
 * **这不是第二套业务信封**（ADR 0017 决定 7）：成功的调用原样返回载荷，这个对象只在失败时出现；
 * 而且判别标记复用契约里已有的失败结构标记 `isDSHRemoteError`——`foundation/failure.ts` 的规则 3
 * 认的就是它，所以渲染层那个唯一解析点不需要第二种失败方言。
 *
 * ⚠️ **复用这个标记是有代价的，故意接受**：DSH 官方的 `remoteErrorOf` 只校验
 * `isDSHRemoteError === true && typeof code === 'string'`，所以任何拿到 IPC 失败对象的 DSH 代码
 * 都会把它当 RemoteError；而我们的契约码不在协议的封闭枚举里，类型上要靠
 * `RemoteErrorDetailsMap` 的声明合并兜住。换来的是渲染层只认一种失败方言、只写一处按码映射。
 * 如果哪天 DSH 加强了 `remoteErrorOf` 的校验，这条边界要改回独立标记——那时只改本文件与
 * `foundation/failure.ts` 的识别规则。
 *
 * ⚠️ 反过来读这条形状：标记与详情必须在**可克隆的自有属性**上。类实例的原型、Error 的自定义属性、
 * 函数、`undefined` 都过不了这条边界。
 */
import type { EleckoiFailureCode } from './codes.js'
import type { EleckoiFailureDetails } from './details.js'

/** 边界⑤ 上一次失败的线上形状（主进程返回它，preload 把它变成拒绝）。 */
export interface DesktopIpcFailure {
  /** 结构标记；与官方 `RemoteError` 同一个（跨 realm / bundle 的识别从不靠 instanceof）。 */
  readonly isDSHRemoteError: true
  readonly code: EleckoiFailureCode
  /** 开发者诊断文案；用户可见文案的解析点在渲染层（ADR 决定 4/8）。 */
  readonly message: string
  /** 参数化详情，顶层是扁平 JSON 对象。 */
  readonly details: EleckoiFailureDetails
}

/**
 * 边界⑤ 的**宿主失败通知**载荷（主进程 → 渲染层的 `dsh-desktop:host-failure` 推送）。
 *
 * 这条通道送的是**失败对象**，不是拼好的用户可见句子：用户可见文案只有一个解析点
 * （渲染层，ADR 决定 4/8）。形状就是 {@link DesktopIpcFailure}，再加两个**诊断指针**：
 * 子进程给的 `stack`，和宿主收到 fatal 帧后自己记录的本机 `logPath`
 * （ADR 决定 10：诊断用指针承载，不把整段日志塞进消息）。
 *
 * 指针是**可选**的，而且拿不到时整个属性都不出现：`undefined` 不是可结构化克隆的值，
 * 放进去会在跨 world 复制时被丢掉或报错。
 */
export interface DesktopHostFailureNotice extends DesktopIpcFailure {
  /** 子进程侧的 stack（有就用它，诊断以子进程为准）。 */
  readonly stack?: string
  /** 宿主本机日志文件指针（宿主收到 fatal 帧后自己记录；子进程不填）。 */
  readonly logPath?: string
}
